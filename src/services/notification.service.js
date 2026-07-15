const { Notification, User, Vendor } = require('../models');
const { getMessaging } = require('../config/firebase');
const { getRedisClient } = require('../config/redis');
const { addJob } = require('../jobs');
const { eventEmitter } = require('../events');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const webpush = require('web-push');
const PushNotifications = require('node-pushnotifications');

// FCM registration-token errors that mean the token will NEVER be valid again.
// These tokens must be removed from the user so we stop sending to them.
const PERMANENT_FCM_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/mismatched-credential',
]);

function isPermanentFcmError(code) {
  return PERMANENT_FCM_ERRORS.has(code);
}

// FCM `data` payload values must be strings.
function stringifyData(data = {}) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}

const FCM_MAX_TOKENS_PER_MULTICAST = 500;

class NotificationService {
  constructor() {
    this.redisClient = getRedisClient();
    this.fcm = getMessaging();
    this.defaultTTL = 300; // 5 minutes
    
    // Configure web push for browser notifications
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:support@rentease.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
    }

    // Configure push notification service
    this.push = new PushNotifications({
      gcm: {
        id: process.env.FIREBASE_SERVER_KEY
      },
      apn: {
        token: {
          key: process.env.APN_KEY,
          keyId: process.env.APN_KEY_ID,
          teamId: process.env.APN_TEAM_ID
        },
        production: process.env.NODE_ENV === 'production'
      },
      web: {
        vapidDetails: {
          subject: process.env.VAPID_SUBJECT || 'mailto:support@rentease.com',
          publicKey: process.env.VAPID_PUBLIC_KEY,
          privateKey: process.env.VAPID_PRIVATE_KEY
        },
        gcmAPIKey: process.env.GCM_API_KEY,
        TTL: 2419200,
        contentEncoding: 'aes128gcm',
        headers: {}
      }
    });
  }

  /**
   * Generate unique notification number
   */
  generateNotificationNumber() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `NOT${timestamp}${random}`;
  }

  /**
   * Create notification
   */
  async createNotification(data) {
    try {
      const {
        userId,
        type = 'in_app',
        category = 'transactional',
        title,
        content,
        data: metaData,
        actions,
        priority = 'medium',
        scheduledFor,
        expiresAt,
        template,
        channelDetails
      } = data;

      // Check if user has opted out
      if (type !== 'in_app') {
        const user = await User.findById(userId);
        if (user?.preferences?.notifications && 
            user.preferences.notifications[type] === false) {
          logger.info(`User ${userId} has opted out of ${type} notifications`);
          return null;
        }
      }

      const notificationNumber = this.generateNotificationNumber();
      
      const notification = await Notification.create({
        notificationNumber,
        user: userId,
        type,
        category,
        title,
        content: typeof content === 'string' ? { text: content } : content,
        data: metaData,
        actions,
        priority,
        status: scheduledFor ? 'scheduled' : 'pending',
        schedule: scheduledFor ? {
          scheduledFor: new Date(scheduledFor),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        } : undefined,
        expiryDate: expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        template,
        channelDetails
      });

      // Process immediately if not scheduled
      if (!scheduledFor) {
        await this.processNotification(notification);
      } else {
        // Schedule for later
        await addJob('notification', 'send-scheduled', {
          notificationId: notification._id,
          scheduledAt: scheduledFor
        });
      }

      return notification;
    } catch (error) {
      logger.error('Error in createNotification:', error);
      throw error;
    }
  }

  /**
   * Create bulk notifications
   */
  async createBulkNotifications(userIds, data) {
    try {
      const notifications = [];
      const results = {
        successful: 0,
        failed: 0,
        errors: []
      };

      for (const userId of userIds) {
        try {
          const notification = await this.createNotification({
            userId,
            ...data
          });
          if (notification) {
            notifications.push(notification);
            results.successful++;
          }
        } catch (error) {
          results.failed++;
          results.errors.push({ userId, error: error.message });
        }
      }

      return {
        notifications,
        results
      };
    } catch (error) {
      logger.error('Error in createBulkNotifications:', error);
      throw error;
    }
  }

  /**
   * Process notification
   */
  async processNotification(notification) {
    try {
      notification.status = 'processing';
      await notification.save();

      let result;

      switch (notification.type) {
        case 'in_app':
          result = await this.sendInAppNotification(notification);
          break;
        case 'email':
          result = await this.sendEmailNotification(notification);
          break;
        case 'sms':
          result = await this.sendSMSNotification(notification);
          break;
        case 'push':
          result = await this.sendPushNotification(notification);
          break;
        case 'whatsapp':
          result = await this.sendWhatsAppNotification(notification);
          break;
        default:
          throw new Error(`Unknown notification type: ${notification.type}`);
      }

      notification.status = 'sent';
      notification.tracking = {
        ...notification.tracking,
        sentAt: new Date(),
        ...result
      };

      await notification.save();

      // Emit real-time event for in-app notifications
      if (notification.type === 'in_app') {
        eventEmitter.emit('notification:sent', {
          userId: notification.user,
          notification: notification.toObject()
        });
      }

      return notification;
    } catch (error) {
      logger.error('Error processing notification:', error);
      
      notification.status = 'failed';
      notification.tracking = {
        ...notification.tracking,
        failedAt: new Date(),
        failureReason: error.message,
        retryCount: (notification.tracking?.retryCount || 0) + 1
      };
      
      await notification.save();

      // Schedule retry if under max retries
      if ((notification.tracking?.retryCount || 0) < 3) {
        await this.scheduleRetry(notification);
      }

      throw error;
    }
  }

  /**
   * Send in-app notification
   */
  async sendInAppNotification(notification) {
    // In-app notifications are stored in DB and delivered via socket
    return {
      deliveredAt: new Date(),
      method: 'database'
    };
  }

  /**
   * Send email notification
   */
  async sendEmailNotification(notification) {
    try {
      const user = await User.findById(notification.user);
      
      if (!user?.email) {
        throw new Error('User email not found');
      }

      await addJob('email', 'send', {
        to: user.email,
        subject: notification.title,
        html: notification.content.html || notification.content.text,
        template: notification.template,
        data: notification.data
      });

      return {
        deliveredAt: new Date(),
        method: 'email',
        recipient: user.email
      };
    } catch (error) {
      logger.error('Error sending email notification:', error);
      throw error;
    }
  }

  /**
   * Send SMS notification
   */
  async sendSMSNotification(notification) {
    try {
      const user = await User.findById(notification.user);
      
      if (!user?.phone) {
        throw new Error('User phone number not found');
      }

      await addJob('sms', 'send', {
        to: user.phone,
        message: notification.content.text || notification.title
      });

      return {
        deliveredAt: new Date(),
        method: 'sms',
        recipient: user.phone
      };
    } catch (error) {
      logger.error('Error sending SMS notification:', error);
      throw error;
    }
  }

  /**
   * Remove invalid/unknown FCM tokens from a user's records.
   */
  async removeTokens(userId, tokens) {
    if (!tokens || tokens.length === 0) return;
    try {
      await User.updateOne(
        { _id: userId },
        {
          $pull: {
            pushTokens: { $in: tokens },
            deviceTokens: { token: { $in: tokens } }
          }
        }
      );
      logger.info(`Removed ${tokens.length} invalid push token(s) for user ${userId}`);
    } catch (err) {
      logger.error('Error removing invalid push tokens:', err.message);
    }
  }

  /**
   * Send push notification (Firebase Cloud Messaging).
   *
   * Handles: missing config (graceful skip), no tokens (skip, not error),
   * 500-token chunking, transient vs permanent FCM errors (only permanent
   * errors prune the token), and safe payload shaping for Android/APNS/WebPush.
   */
  async sendPushNotification(notification) {
    const fcm = this.fcm;
    if (!fcm) {
      // Firebase disabled — in-app delivery already happened; just no-op.
      logger.warn(`Messaging unavailable; skipping push for ${notification._id}`);
      return { skipped: true, reason: 'fcm_unavailable' };
    }

    const userId = notification.user?._id || notification.user;
    const user = await User.findById(userId).select('pushTokens deviceTokens');
    const tokens = (user?.pushTokens || []).filter(Boolean);

    if (tokens.length === 0) {
      return { deliveredAt: new Date(), method: 'fcm', skipped: true, reason: 'no_tokens' };
    }

    const title = notification.title;
    const body = notification.content?.text || notification.title;
    const imageUrl = notification.data?.imageUrl;
    const isHighPriority = notification.priority === 'high' || notification.priority === 'urgent';
    const primaryActionUrl = notification.actions?.[0]?.url;

    const baseMessage = {
      notification: {
        title,
        body,
        ...(imageUrl ? { image: imageUrl } : {})
      },
      data: {
        ...stringifyData(notification.data),
        notificationId: notification._id.toString(),
        type: notification.category,
        click_action: 'FLUTTER_NOTIFICATION_CLICK'
      },
      android: {
        priority: isHighPriority ? 'high' : 'normal',
        ttl: 86400000,
        notification: {
          channelId: 'rentease_notifications',
          clickAction: 'OPEN_ACTIVITY',
          ...(imageUrl ? { imageUrl } : {})
        }
      },
      apns: {
        headers: { 'apns-priority': isHighPriority ? '10' : '5' },
        payload: {
          aps: {
            alert: { title, body },
            badge: await this.getUnreadCount(userId),
            sound: 'default',
            category: notification.category,
            'mutable-content': 1
          }
        }
      },
      webpush: {
        headers: { TTL: '86400' },
        notification: {
          title,
          body,
          icon: '/logo.png',
          badge: '/badge.png',
          ...(imageUrl ? { image: imageUrl } : {}),
          ...(notification.actions?.length
            ? {
                actions: notification.actions.map((a) => ({
                  action: a.type || 'default',
                  title: a.label
                }))
              }
            : {}),
          ...(primaryActionUrl ? { data: { url: primaryActionUrl } } : {})
        },
        fcmOptions: {
          ...(primaryActionUrl ? { link: primaryActionUrl } : {})
        }
      }
    };

    let successTotal = 0;
    let failedTotal = 0;
    const invalidTokens = new Set();

    for (let i = 0; i < tokens.length; i += FCM_MAX_TOKENS_PER_MULTICAST) {
      const slice = tokens.slice(i, i + FCM_MAX_TOKENS_PER_MULTICAST);
      let response;
      try {
        response = await fcm.sendEachForMulticast({ ...baseMessage, tokens: slice });
      } catch (err) {
        // Whole-multicast failure (auth/quota/network). Tokens stay valid; let retry handle it.
        logger.error('FCM sendEachForMulticast failed:', err.message);
        throw err;
      }

      successTotal += response.successCount;
      failedTotal += response.failureCount;

      response.responses.forEach((resp, idx) => {
        if (resp.success) return;
        const code = resp.error?.errorInfo?.code || '';
        if (isPermanentFcmError(code)) {
          invalidTokens.add(slice[idx]);
        }
        // Transient errors (quota/timeout/unavailable) keep the token; the
        // notification will be retried via the job queue.
      });
    }

    if (invalidTokens.size > 0) {
      await this.removeTokens(userId, Array.from(invalidTokens));
    }

    return {
      deliveredAt: new Date(),
      method: 'fcm',
      success: successTotal,
      failed: failedTotal,
      removed: invalidTokens.size
    };
  }

  /**
   * Send WhatsApp notification
   */
  async sendWhatsAppNotification(notification) {
    try {
      const user = await User.findById(notification.user);
      
      if (!user?.phone) {
        throw new Error('User phone number not found');
      }

      // This would integrate with WhatsApp Business API
      // Placeholder for WhatsApp integration
      logger.info(`WhatsApp notification would be sent to ${user.phone}`);

      return {
        deliveredAt: new Date(),
        method: 'whatsapp',
        recipient: user.phone
      };
    } catch (error) {
      logger.error('Error sending WhatsApp notification:', error);
      throw error;
    }
  }

  /**
   * Register (or refresh) a push token for a user.
   * Dedupes the flat token list and upserts a rich device record.
   */
  async registerPushToken(userId, token, platform = 'web', meta = {}) {
    try {
      if (!token) {
        throw new Error('Token is required');
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      if (!user.pushTokens.includes(token)) {
        user.pushTokens.push(token);
      }

      const existing = user.deviceTokens.find((d) => d.token === token);
      if (existing) {
        existing.isActive = true;
        existing.platform = platform;
        existing.lastUsedAt = new Date();
        if (meta.deviceId) existing.deviceId = meta.deviceId;
        if (meta.appVersion) existing.appVersion = meta.appVersion;
      } else {
        user.deviceTokens.push({
          token,
          platform,
          deviceId: meta.deviceId,
          appVersion: meta.appVersion,
          isActive: true,
          lastUsedAt: new Date()
        });
      }

      await user.save();
      return { message: 'Push token registered successfully', token, platform };
    } catch (error) {
      logger.error('Error registering push token:', error);
      throw error;
    }
  }

  /**
   * Unregister a push token (logout / permission revoked).
   */
  async unregisterPushToken(userId, token) {
    try {
      if (!token) {
        throw new Error('Token is required');
      }

      await User.updateOne(
        { _id: userId },
        {
          $pull: {
            pushTokens: token,
            deviceTokens: { token }
          }
        }
      );

      return { message: 'Push token unregistered successfully' };
    } catch (error) {
      logger.error('Error unregistering push token:', error);
      throw error;
    }
  }

  /**
   * Get user notifications
   */
  async getUserNotifications(userId, page = 1, limit = 20, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = { user: userId };
      
      if (filters.type) {
        query.type = filters.type;
      }

      if (filters.category) {
        query.category = filters.category;
      }

      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.unreadOnly) {
        query.readAt = { $exists: false };
      }

      const [notifications, total, unreadCount] = await Promise.all([
        Notification.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Notification.countDocuments(query),
        Notification.countDocuments({ 
          user: userId, 
          readAt: { $exists: false },
          type: 'in_app'
        })
      ]);

      return {
        notifications,
        unreadCount,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getUserNotifications:', error);
      throw error;
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId, userId) {
    try {
      const notification = await Notification.findOne({
        _id: notificationId,
        user: userId
      });

      if (!notification) {
        throw new Error('Notification not found');
      }

      notification.readAt = new Date();
      notification.status = 'read';
      await notification.save();

      return notification;
    } catch (error) {
      logger.error('Error marking notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(userId) {
    try {
      await Notification.updateMany(
        { 
          user: userId, 
          readAt: { $exists: false },
          type: 'in_app'
        },
        { 
          $set: { 
            readAt: new Date(),
            status: 'read'
          } 
        }
      );

      return { message: 'All notifications marked as read' };
    } catch (error) {
      logger.error('Error marking all as read:', error);
      throw error;
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId, userId) {
    try {
      const notification = await Notification.findOneAndDelete({
        _id: notificationId,
        user: userId
      });

      if (!notification) {
        throw new Error('Notification not found');
      }

      return { message: 'Notification deleted successfully' };
    } catch (error) {
      logger.error('Error deleting notification:', error);
      throw error;
    }
  }

  /**
   * Clear all notifications
   */
  async clearAllNotifications(userId) {
    try {
      await Notification.deleteMany({ 
        user: userId,
        type: 'in_app'
      });

      return { message: 'All notifications cleared' };
    } catch (error) {
      logger.error('Error clearing notifications:', error);
      throw error;
    }
  }

  /**
   * Get unread count
   */
  async getUnreadCount(userId) {
    try {
      const cacheKey = `notifications:unread:${userId}`;
      
      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return parseInt(cached);
        }
      }

      const count = await Notification.countDocuments({
        user: userId,
        readAt: { $exists: false },
        type: 'in_app'
      });

      // Cache for 1 minute
      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, 60, count.toString());
      }

      return count;
    } catch (error) {
      logger.error('Error getting unread count:', error);
      return 0;
    }
  }

  /**
   * Schedule a durable retry via the job queue (survives process restarts).
   * Retry count is already incremented in processNotification's catch block.
   */
  async scheduleRetry(notification) {
    const retryCount = notification.tracking?.retryCount || 0;
    const maxRetries = notification.tracking?.maxRetries || 3;
    if (retryCount >= maxRetries) return;

    const delaysMin = [1, 5, 15]; // incremental backoff
    const delayMin = delaysMin[retryCount] ?? 30;

    try {
      await addJob(
        'notification',
        'retry',
        { notificationId: notification._id.toString(), attempt: retryCount + 1 },
        { delay: delayMin * 60 * 1000 }
      );
      logger.info(`Scheduled retry #${retryCount + 1} for notification ${notification._id} in ${delayMin}m`);
    } catch (err) {
      logger.error('Failed to enqueue notification retry:', err.message);
    }
  }

  /**
   * Send test notification
   */
  async sendTestNotification(userId, type = 'in_app') {
    return this.createNotification({
      userId,
      type,
      category: 'test',
      title: 'Test Notification',
      content: {
        text: 'This is a test notification from RentEase',
        html: '<p>This is a test notification from <strong>RentEase</strong></p>'
      },
      data: {
        test: true,
        timestamp: new Date().toISOString()
      },
      priority: 'low'
    });
  }

  /**
   * Get notification statistics
   */
  async getNotificationStats(userId = null) {
    try {
      const match = userId ? { user: userId } : {};

      const stats = await Notification.aggregate([
        { $match: match },
        {
          $facet: {
            overview: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  sent: {
                    $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] }
                  },
                  failed: {
                    $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
                  },
                  read: {
                    $sum: { $cond: [{ $ne: ['$readAt', null] }, 1, 0] }
                  }
                }
              }
            ],
            byType: [
              {
                $group: {
                  _id: '$type',
                  count: { $sum: 1 }
                }
              }
            ],
            byCategory: [
              {
                $group: {
                  _id: '$category',
                  count: { $sum: 1 }
                }
              }
            ],
            daily: [
              {
                $group: {
                  _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' },
                    day: { $dayOfMonth: '$createdAt' }
                  },
                  count: { $sum: 1 }
                }
              },
              { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
            ]
          }
        }
      ]);

      return stats[0] || {};
    } catch (error) {
      logger.error('Error in getNotificationStats:', error);
      throw error;
    }
  }

  /**
   * Clean up old notifications
   */
  async cleanupOldNotifications(days = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const result = await Notification.deleteMany({
        createdAt: { $lt: cutoffDate },
        status: { $in: ['sent', 'read'] },
        type: { $ne: 'email' } // Keep email notifications longer
      });

      logger.info(`Cleaned up ${result.deletedCount} old notifications`);
      return result;
    } catch (error) {
      logger.error('Error cleaning up old notifications:', error);
      throw error;
    }
  }

  /**
   * Send welcome notification
   */
  async sendWelcomeNotification(userId) {
    return this.createNotification({
      userId,
      type: 'in_app',
      category: 'welcome',
      title: 'Welcome to RentEase! 🎉',
      content: {
        text: 'Thank you for joining RentEase. Start exploring our products!',
        html: '<p>Thank you for joining <strong>RentEase</strong>. Start exploring our products!</p>'
      },
      data: {
        action: 'explore_products',
        url: '/products'
      },
      actions: [
        {
          type: 'link',
          label: 'Explore Products',
          url: '/products'
        }
      ]
    });
  }

  /**
   * Send rental confirmation notification
   */
  async sendRentalConfirmation(userId, rental) {
    return this.createNotification({
      userId,
      type: 'in_app',
      category: 'rental',
      title: 'Rental Confirmed! ✅',
      content: {
        text: `Your rental #${rental.rentalNumber} has been confirmed.`,
        html: `<p>Your rental <strong>#${rental.rentalNumber}</strong> has been confirmed.</p>`
      },
      data: {
        rentalId: rental._id,
        rentalNumber: rental.rentalNumber,
        action: 'view_rental',
        url: `/rentals/${rental._id}`
      },
      actions: [
        {
          type: 'link',
          label: 'View Rental',
          url: `/rentals/${rental._id}`
        }
      ],
      priority: 'high'
    });
  }

  /**
   * Send payment success notification
   */
  async sendPaymentSuccess(userId, payment, rental) {
    return this.createNotification({
      userId,
      type: 'in_app',
      category: 'payment',
      title: 'Payment Successful! 💰',
      content: {
        text: `Payment of ₹${payment.amount} for rental #${rental.rentalNumber} was successful.`,
        html: `<p>Payment of <strong>₹${payment.amount}</strong> for rental <strong>#${rental.rentalNumber}</strong> was successful.</p>`
      },
      data: {
        paymentId: payment._id,
        rentalId: rental._id,
        amount: payment.amount,
        action: 'view_receipt',
        url: `/payments/${payment._id}/receipt`
      },
      actions: [
        {
          type: 'link',
          label: 'View Receipt',
          url: `/payments/${payment._id}/receipt`
        }
      ],
      priority: 'high'
    });
  }

  /**
   * Send delivery update notification
   */
  async sendDeliveryUpdate(userId, delivery) {
    const statusMessages = {
      'out_for_delivery': 'Your order is out for delivery! 🚚',
      'delivered': 'Your order has been delivered! 📦',
      'failed': 'Delivery attempt failed. We will try again. ⚠️'
    };

    return this.createNotification({
      userId,
      type: 'in_app',
      category: 'delivery',
      title: 'Delivery Update',
      content: {
        text: statusMessages[delivery.status] || `Delivery status updated to ${delivery.status}`,
        html: `<p>${statusMessages[delivery.status] || `Delivery status updated to ${delivery.status}`}</p>`
      },
      data: {
        deliveryId: delivery._id,
        deliveryNumber: delivery.deliveryNumber,
        status: delivery.status,
        action: 'track_delivery',
        url: `/deliveries/track/${delivery.deliveryNumber}`
      },
      actions: [
        {
          type: 'link',
          label: 'Track Delivery',
          url: `/deliveries/track/${delivery.deliveryNumber}`
        }
      ],
      priority: delivery.status === 'delivered' ? 'high' : 'medium'
    });
  }

  /**
   * Send maintenance update notification
   */
  async sendMaintenanceUpdate(userId, maintenance) {
    return this.createNotification({
      userId,
      type: 'in_app',
      category: 'maintenance',
      title: 'Maintenance Update 🔧',
      content: {
        text: `Your maintenance request #${maintenance.requestNumber} status: ${maintenance.status}`,
        html: `<p>Your maintenance request <strong>#${maintenance.requestNumber}</strong> status: <strong>${maintenance.status}</strong></p>`
      },
      data: {
        maintenanceId: maintenance._id,
        requestNumber: maintenance.requestNumber,
        status: maintenance.status,
        action: 'view_maintenance',
        url: `/maintenance/${maintenance._id}`
      },
      actions: [
        {
          type: 'link',
          label: 'View Details',
          url: `/maintenance/${maintenance._id}`
        }
      ]
    });
  }

  /**
   * Send vendor approval notification
   */
  async sendVendorApproval(userId, vendor) {
    return this.createNotification({
      userId,
      type: 'in_app',
      category: 'vendor',
      title: 'Vendor Account Approved! 🎉',
      content: {
        text: 'Congratulations! Your vendor account has been approved.',
        html: '<p>Congratulations! Your vendor account has been approved.</p>'
      },
      data: {
        vendorId: vendor._id,
        action: 'go_to_dashboard',
        url: '/vendor/dashboard'
      },
      actions: [
        {
          type: 'link',
          label: 'Go to Dashboard',
          url: '/vendor/dashboard'
        }
      ],
      priority: 'high'
    });
  }

  /**
   * Send review response notification
   */
  async sendReviewResponse(userId, review, response) {
    return this.createNotification({
      userId,
      type: 'in_app',
      category: 'review',
      title: 'Vendor Responded to Your Review 💬',
      content: {
        text: `Vendor responded: "${response.content.substring(0, 100)}${response.content.length > 100 ? '...' : ''}"`,
        html: `<p>Vendor responded: "${response.content.substring(0, 100)}${response.content.length > 100 ? '...' : ''}"</p>`
      },
      data: {
        reviewId: review._id,
        productId: review.product,
        action: 'view_review',
        url: `/products/${review.product}?review=${review._id}`
      },
      actions: [
        {
          type: 'link',
          label: 'View Review',
          url: `/products/${review.product}?review=${review._id}`
        }
      ]
    });
  }

  /**
   * Send low stock alert to vendor
   */
  async sendLowStockAlert(vendorId, product, quantity) {
    return this.createNotification({
      userId: vendorId,
      type: 'in_app',
      category: 'inventory',
      title: '⚠️ Low Stock Alert',
      content: {
        text: `Product "${product.basicInfo.name}" is running low. Only ${quantity} left.`,
        html: `<p>Product <strong>"${product.basicInfo.name}"</strong> is running low. Only <strong>${quantity}</strong> left.</p>`
      },
      data: {
        productId: product._id,
        productName: product.basicInfo.name,
        quantity,
        action: 'restock',
        url: `/vendor/products/${product._id}/inventory`
      },
      actions: [
        {
          type: 'link',
          label: 'Restock Now',
          url: `/vendor/products/${product._id}/inventory`
        }
      ],
      priority: quantity <= 2 ? 'high' : 'medium'
    });
  }

  /**
   * Send scheduled notifications (cron job)
   */
  async processScheduledNotifications() {
    try {
      const now = new Date();
      
      const scheduled = await Notification.find({
        status: 'scheduled',
        'schedule.scheduledFor': { $lte: now },
        expiryDate: { $gt: now }
      });

      for (const notification of scheduled) {
        notification.status = 'pending';
        await notification.save();
        await this.processNotification(notification);
      }

      return scheduled.length;
    } catch (error) {
      logger.error('Error processing scheduled notifications:', error);
      throw error;
    }
  }

  /**
   * Send admin broadcast notification
   */
  async sendAdminBroadcast(data) {
    const {
      title,
      content,
      type = 'push',
      category = 'announcement',
      target = 'all', // 'all', 'users', 'vendors', 'specific'
      userIds = [],
      priority = 'medium',
      scheduledFor
    } = data;

    let recipients = [];

    if (target === 'all') {
      const users = await User.find({ 'status.isActive': true }).distinct('_id');
      recipients = users;
    } else if (target === 'users') {
      const users = await User.find({ role: 'user', 'status.isActive': true }).distinct('_id');
      recipients = users;
    } else if (target === 'vendors') {
      const vendors = await Vendor.find({ 'status.isActive': true }).distinct('user');
      recipients = vendors;
    } else if (target === 'specific') {
      recipients = userIds;
    }

    const results = await this.createBulkNotifications(recipients, {
      type,
      category,
      title,
      content,
      priority,
      scheduledFor,
      data: {
        broadcast: true,
        sentBy: data.sentBy
      }
    });

    return results;
  }
}

module.exports = new NotificationService();