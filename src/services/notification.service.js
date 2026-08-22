const { Notification, User, Vendor, Cart } = require('../models');
const { getMessaging } = require('../config/firebase');
const { getRedisClient } = require('../config/redis');
const { addJob } = require('../jobs');
const eventEmitter = require('../events/eventEmitter');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const crypto = require('crypto');
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
    // crypto random with a 2^48 space (was Math.random * 10000 — only 4 digits,
    // which collided on the unique index when a broadcast created many docs in
    // the same millisecond). Matches the model's pre-save generator.
    const timestamp = Date.now().toString().slice(-8);
    const random = crypto.randomBytes(6).toString('hex').toUpperCase();
    return `NOT${timestamp}${random}`;
  }

  /**
   * Create notification
   */
  async createNotification(data) {
    try {
      const {
        userId,
        type = 'push',
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
        // The model stores `template` as a string slug; broadcast payloads may
        // carry an object { slug, variables } — normalize to the slug here.
        template: typeof template === 'string' ? template : template?.slug || undefined,
        channelDetails
      });

      // Process immediately if not scheduled
      if (!scheduledFor) {
        await this.processNotification(notification);
      } else {
        // Schedule for later: hold the job in the queue until scheduledFor via a
        // BullMQ `delay`. Without the delay the worker would run it immediately,
        // defeating the schedule. A non-positive delay (past date) runs ASAP.
        const delay = Math.max(0, new Date(scheduledFor).getTime() - Date.now());
        await addJob(
          'notification',
          'send-scheduled',
          {
            notificationId: notification._id,
            scheduledAt: scheduledFor
          },
          { delay }
        );
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
  async createBulkNotifications(userIds, data, options = {}) {
    const { concurrency = 25 } = options;
    try {
      const notifications = [];
      const results = {
        successful: 0,
        failed: 0,
        errors: []
      };

      // Process in bounded-concurrency batches instead of strictly one-at-a-time.
      // Keeps large broadcasts fast without opening an unbounded number of
      // simultaneous DB/network operations. Each recipient is isolated so one
      // failure never aborts the rest of the batch.
      for (let i = 0; i < userIds.length; i += concurrency) {
        const batch = userIds.slice(i, i + concurrency);
        const settled = await Promise.allSettled(
          batch.map((userId) => this.createNotification({ userId, ...data }))
        );

        settled.forEach((outcome, idx) => {
          if (outcome.status === 'fulfilled') {
            // A null result means the user opted out — neither success nor error.
            if (outcome.value) {
              notifications.push(outcome.value);
              results.successful++;
            }
          } else {
            results.failed++;
            results.errors.push({
              userId: batch[idx],
              error: outcome.reason?.message || String(outcome.reason)
            });
          }
        });
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
        // A new unread in-app notification changes the badge count — drop the
        // cached value so the next getUnreadCount() reflects it immediately.
        await this.invalidateUnreadCache(notification.user);
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
    // console.log("fcm-->", fcm)
    if (!fcm) {
      // Firebase disabled — in-app delivery already happened; just no-op.
      logger.warn(`Messaging unavailable; skipping push for ${notification._id}`);
      return { skipped: true, reason: 'fcm_unavailable' };
    }

    const userId = notification.user?._id || notification.user;
    const user = await User.findById(userId).select('pushTokens deviceTokens');
    const tokens = (user?.pushTokens || []).filter(Boolean);
    console.log("tokens-->", tokens)
    if (tokens.length > 0) {
      logger.info(`Push tokens for user ${userId}: ${tokens.length} (prefixes: ${tokens.map((t) => t.slice(0, 12)).join(', ')})`);
    }

    if (tokens.length === 0) {
      return { deliveredAt: new Date(), method: 'fcm', skipped: true, reason: 'no_tokens' };
    }

    const title = notification.title;
    const body = notification.content?.text || notification.title;
    // Hero image, falling back to the first carousel image so a push with only
    // carousel images still shows an image (web/Android support a single image).
    const imageUrl = notification.data?.imageUrl || notification.data?.images?.[0] || '';
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
          sound: 'default',
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

    // console.log("baseMessage-->", baseMessage)

    let successTotal = 0;
    let failedTotal = 0;
    const invalidTokens = new Set();
    const failureCodes = new Map(); // FCM error code -> how many tokens failed with it

    console.log('invalidTokens-->', invalidTokens)
    console.log('failureCodes-->', failureCodes)

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

      // Diagnostic: always log the FCM verdict so delivery issues are visible
      // (successCount > 0 but nothing on device = client-side delivery problem)
      logger.info(
        `FCM multicast result: ${slice.length} token(s) -> ${response.successCount} success, ${response.failureCount} failed`,
        {
          errorCodes: response.responses
            .map((r) => r.error?.errorInfo?.code)
            .filter(Boolean),
        }
      );

      response.responses.forEach((resp, idx) => {
        if (resp.success) return;
        const err = resp.error;
        const code = err?.errorInfo?.code || 'unknown';
        const message = err?.errorInfo?.message || err?.message || String(err);

        failureCodes.set(code, (failureCodes.get(code) || 0) + 1);
        // Log the REAL code + message — plain console.log only showed "[FirebaseMessagingError]"
        logger.warn(`FCM token failed (${idx}): [${code}] ${message}`, {
          tokenPrefix: slice[idx]?.slice(0, 12),
        });

        if (isPermanentFcmError(code)) {
          invalidTokens.add(slice[idx]);
        }
        // Transient errors (quota/timeout/unavailable) keep the token; the
        // notification will be retried via the job queue.
      });
    }

    if (invalidTokens.size > 0) {
      // Safety guard: if EVERY token failed with the SAME config-level error
      // (e.g. mismatched-credential — the server service account and the app's
      // google-services.json belong to different Firebase projects), pruning
      // tokens fixes nothing and just deletes valid tokens. Log loudly instead.
      const configLevelErrors = new Set([
        'messaging/mismatched-credential',
        'messaging/authentication-error',
        'messaging/third-party-auth-error',
      ]);
      const isConfigLevelAllFailure =
        invalidTokens.size === tokens.length &&
        failureCodes.size === 1 &&
        configLevelErrors.has([...failureCodes.keys()][0]);

      if (isConfigLevelAllFailure) {
        logger.error(
          `⚠️ ALL ${tokens.length} token(s) failed with [${[...failureCodes.keys()][0]}]. ` +
            'Skipping token pruning — check that the server Firebase service account and the app ' +
            'google-services.json point to the SAME Firebase project.'
        );
      } else {
        await this.removeTokens(userId, Array.from(invalidTokens));
      }
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

      // No WhatsApp Business API gateway is configured, so this channel cannot
      // actually deliver. Reporting `delivered: true` would be a lie — it would
      // mark the notification 'sent' and inflate delivery stats. Report an
      // explicit skip instead (same convention as push when FCM is unavailable),
      // so callers know nothing was delivered and no retry storm is triggered.
      logger.warn(`WhatsApp gateway not configured; skipping ${notification._id} to ${user.phone}`);

      return {
        method: 'whatsapp',
        recipient: user.phone,
        skipped: true,
        reason: 'whatsapp_gateway_unavailable'
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
   * Check whether a user already has a usable push subscription.
   *
   * Used at login so the client can skip the permission prompt / token
   * generation when a token already exists. When `deviceId` is supplied the
   * check is scoped to that browser/device (the stable per-device id), so a
   * new device still triggers registration even if other devices are set up.
   *
   * @returns {Promise<{ exists: boolean, hasAnyToken: boolean }>}
   */
  async hasActivePushToken(userId, deviceId) {
    const user = await User.findById(userId)
      .select('pushTokens deviceTokens')
      .lean();
    if (!user) {
      return { exists: false, hasAnyToken: false };
    }

    const activeDeviceTokens = (user.deviceTokens || []).filter((d) => d.isActive);
    const hasAnyToken =
      (user.pushTokens && user.pushTokens.length > 0) || activeDeviceTokens.length > 0;

    // Scope to this device when we can, otherwise fall back to "any token".
    const exists = deviceId
      ? activeDeviceTokens.some((d) => d.deviceId === deviceId)
      : hasAnyToken;

    return { exists, hasAnyToken };
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

      const now = new Date();
      notification.readAt = now;
      // Keep tracking.readAt in sync with the root readAt — the model's
      // markRead() sets both, and unread logic keys off readAt, so a mismatch
      // here makes the two disagree on what's "read".
      notification.tracking = { ...notification.tracking, readAt: now };
      notification.status = 'read';
      await notification.save();

      await this.invalidateUnreadCache(userId);

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
      const now = new Date();
      await Notification.updateMany(
        {
          user: userId,
          readAt: { $exists: false },
          type: 'in_app'
        },
        {
          $set: {
            readAt: now,
            'tracking.readAt': now,
            status: 'read'
          }
        }
      );

      await this.invalidateUnreadCache(userId);

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

      await this.invalidateUnreadCache(userId);

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

      await this.invalidateUnreadCache(userId);

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
   * Drop the cached unread count for a user.
   *
   * getUnreadCount() memoizes the count in Redis for 60s. Any operation that
   * changes how many unread in-app notifications a user has (read one, read
   * all, delete, clear, or deliver a new in-app notification) must call this,
   * otherwise the badge stays stale for up to a minute. No-op when Redis is
   * not configured.
   */
  async invalidateUnreadCache(userId) {
    if (!this.redisClient || !userId) return;
    try {
      await this.redisClient.del(`notifications:unread:${userId}`);
    } catch (err) {
      logger.error('Error invalidating unread cache:', err.message);
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
  async sendTestNotification(userId, type = 'in_app', channelDetails = {}, scheduledFor = null) {
    return this.createNotification({
      userId,
      // Honour the requested channel. The controller passes req.body.type
      // (default 'in_app'); previously this was hardcoded to 'push', so a
      // user testing their in-app or email delivery always got a push instead.
      type,
      category: 'system',
      title: 'Test Notification',
      content: {
        text: 'This is a test notification from RentEase',
        html: '<p>This is a test notification from <strong>RentEase</strong></p>'
      },
      data: {
        test: true,
        timestamp: new Date().toISOString()
      },
      channelDetails,
      scheduledFor,
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
  /**
   * Broadcast with per-recipient template rendering.
   *
   * Resolves {{variables}} for every recipient in ONE pass (batched user +
   * cart lookups) so personalization is not N+1 queries. Supported variables:
   *   {{firstName}}, {{lastName}}, {{name}}  — from the user's profile
   *   {{cartCount}}, {{cartItems}}            — from the user's cart (withCart)
   *   any static key in template.variables    — e.g. {{discount}}, {{endTime}}
   *
   * When the template is cart-based, the user's cart product images are
   * attached to the notification (carousel + hero) automatically.
   */
  async createPersonalizedBroadcast(recipients, payload) {
    const { template = {}, title, content } = payload;
    const staticVars = template.variables || {};
    const needsCart = template.withCart === true || String(template.slug || '').includes('cart');

    // Batch-fetch recipient profiles (avoids one query per user)
    const users = await User.find({ _id: { $in: recipients } })
      .select('profile.firstName profile.lastName')
      .lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    // Batch-fetch carts with product details when the template needs them
    let cartMap = new Map();
    if (needsCart) {
      const carts = await Cart.find({ user: { $in: recipients } })
        .populate('items.product', 'title images')
        .lean();
      for (const cart of carts) {
        cartMap.set(String(cart.user), cart);
      }
    }

    const renderText = (text, user, cart) => {
      if (!text) return text;
      const firstName = user?.profile?.firstName || '';
      const lastName = user?.profile?.lastName || '';
      const name = [firstName, lastName].filter(Boolean).join(' ').trim() || 'there';
      const productTitles = (cart?.items || [])
        .map((item) => item.product?.title)
        .filter(Boolean);
      const itemsCount = cart?.summary?.itemsCount ?? cart?.items?.length ?? 0;
      const vars = {
        ...staticVars,
        firstName,
        lastName,
        name,
        cartCount: String(itemsCount),
        cartItems: productTitles.length
          ? `${productTitles.slice(0, 3).join(', ')}${productTitles.length > 3 ? ` and ${productTitles.length - 3} more` : ''}`
          : 'your cart items',
      };
      return String(text).replace(/\{\{\s*([\w]+)\s*\}\}/g, (match, key) =>
        key in vars ? String(vars[key]) : match
      );
    };

    const results = { successful: 0, failed: 0, errors: [] };
    const notifications = [];
    const concurrency = 10;

    for (let i = 0; i < recipients.length; i += concurrency) {
      const batch = recipients.slice(i, i + concurrency);
      const settled = await Promise.allSettled(
        batch.map(async (userId) => {
          const user = userMap.get(String(userId)) || null;
          const cart = needsCart ? cartMap.get(String(userId)) : null;

          const renderedTitle = renderText(title, user, cart);
          const renderedContent = {
            ...(content || {}),
            text: renderText(content?.text, user, cart),
          };

          // Cart product images become the notification's hero + carousel
          const cartImages = needsCart
            ? (cart?.items || [])
                .map((item) => item.product?.images?.[0])
                .filter(Boolean)
                .slice(0, 5)
            : [];

          const personalPayload = {
            ...payload,
            title: renderedTitle,
            content: renderedContent,
            data: {
              ...(payload.data || {}),
              ...(cartImages.length
                ? { imageUrl: cartImages[0], images: cartImages }
                : {}),
            },
          };

          const notification = await this.createNotification({ userId, ...personalPayload });
          return notification;
        })
      );

      settled.forEach((outcome) => {
        if (outcome.status === 'fulfilled') {
          // A null result means the user opted out — neither success nor error.
          if (outcome.value) {
            notifications.push(outcome.value);
            results.successful++;
          }
        } else {
          results.failed++;
          results.errors.push({
            error: outcome.reason?.message || String(outcome.reason)
          });
        }
      });
    }

    return { notifications, results };
  }

  async sendAdminBroadcast(data) {
    const {
      title,
      content,
      type = 'push',
      category = 'system',
      target = 'all', // 'all', 'users', 'vendors', 'specific'
      userIds = [],
      priority = 'medium',
      scheduledFor,
      // Rich-media / deep-link fields (Flipkart-style push):
      imageUrl,      // hero image shown in the push notification
      images,        // optional carousel image list
      actionUrl,     // deep link opened when the notification is tapped
      actionLabel,   // button/action label for the deep link
      // Template personalization: { slug, variables } enables per-recipient
      // rendering ({{firstName}}, {{cartCount}}, {{cartItems}}, static vars).
      template
    } = data;

    console.log("type->", type, "category->", category, "target->", target, "userIds->", userIds, "priority->", priority, "scheduledFor->", scheduledFor)
    // Traceability: a single short id threads through enqueue → worker
    // processing → DB docs, so a given broadcast can be matched across the
    // server console and the notifications collection when debugging.
    const broadcastId = `BC${Date.now().toString(36)}`;

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

    const payload = {
      type,
      category,
      title,
      content,
      priority,
      scheduledFor,
      data: {
        broadcast: true,
        broadcastId,
        sentBy: data.sentBy,
        // Fall back to the first carousel image so pushes always carry an image
        // when the admin attached a carousel without a separate hero image.
        ...(imageUrl || (images && images.length) ? { imageUrl: imageUrl || images[0] } : {}),
        ...(images && Array.isArray(images) && images.length ? { images } : {}),
        ...(actionUrl ? { url: actionUrl } : {})
      },
      // Deep link: the push layer reads actions[0].url for webpush link and
      // click routing (notification.service.sendPushNotification).
      ...(actionUrl ? { actions: [{ label: actionLabel || 'View', url: actionUrl }] } : {}),
      // Template personalization (per-recipient rendering in the broadcast job).
      ...(template ? { template } : {})
    };

    console.log("recipients->", recipients.length, )

    if (recipients.length === 0) {
      return { queued: false, recipientCount: 0, target, broadcastId };
    }

    // Fanning out to every recipient (per-user DB writes + push/email network
    // calls) is slow. Doing it inline makes the HTTP request exceed the client /
    // hosting-proxy timeout on large audiences. Resolve the audience, then hand
    // delivery to a DURABLE BullMQ job so it survives a server restart (the old
    // setImmediate was lost entirely if the process died after the response).
    // attempts:1 avoids re-running already-delivered recipients on a retry —
    // a retried whole-fanout would otherwise send duplicate broadcast pushes.
    // Per-recipient createNotification still carries its own durability and
    // schedules its own delay when scheduledFor is set.
    try {
      // BullMQ serializes job data to JSON. `recipients` are Mongoose ObjectIds
      // (from .distinct('_id')), which would round-trip as `{_bsontype, id}`
      // plain objects that Mongoose can't re-cast. Send plain id strings —
      // Mongoose casts those back to ObjectId reliably in createNotification.
      const recipientIds = recipients.map((id) => String(id));
      logger.info(`[broadcast ${broadcastId}] enqueued fan-out to ${recipientIds.length} recipient(s) (target=${target})`);
      const job = await addJob(
        'notification',
        'broadcast',
        { broadcastId, recipients: recipientIds, payload, target },
        { attempts: 1 }
      );
      logger.info(`[broadcast ${broadcastId}] BullMQ job queued with id ${job?.id}`);
    } catch (err) {
      logger.error(`[broadcast ${broadcastId}] Failed to enqueue admin broadcast:`, err);
      return { queued: false, recipientCount: recipients.length, target, error: err.message };
    }

    return { queued: true, recipientCount: recipients.length, target };
  }
}

module.exports = new NotificationService();