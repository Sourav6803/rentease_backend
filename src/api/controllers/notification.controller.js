const NotificationService = require('../../services/notification.service');
const catchAsync = require('../../utils/catchAsync');
const {ApiResponse} = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const Notification = require('../../models/Notification.model');
const User = require('../../models/User.model');
const { queues, workers, addJob } = require('../../jobs');

class NotificationController {
  /**
   * Get user notifications
   */
  getUserNotifications = catchAsync(async (req, res) => {
    const { page = 1, limit = 20, ...filters } = req.query;
    
    const notifications = await NotificationService.getUserNotifications(
      req.user._id,
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Notifications retrieved successfully', notifications);
  });

  /**
   * Get unread count
   */
  getUnreadCount = catchAsync(async (req, res) => {
    const count = await NotificationService.getUnreadCount(req.user._id);
    
    return ApiResponse.success(res, 200, 'Unread count retrieved successfully', { count });
  });

  /**
   * Mark notification as read
   */
  markAsRead = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const notification = await NotificationService.markAsRead(id, req.user._id);
    
    return ApiResponse.success(res, 200, 'Notification marked as read', { notification });
  });

  /**
   * Mark all as read
   */
  markAllAsRead = catchAsync(async (req, res) => {
    const result = await NotificationService.markAllAsRead(req.user._id);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Delete notification
   */
  deleteNotification = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const result = await NotificationService.deleteNotification(id, req.user._id);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Clear all notifications
   */
  clearAllNotifications = catchAsync(async (req, res) => {
    const result = await NotificationService.clearAllNotifications(req.user._id);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Register push token
   */
  registerPushToken = catchAsync(async (req, res) => {
    const { token, platform, deviceId, appVersion } = req.body;
    
    if (!token) {
      throw new AppError('Push token is required', 400);
    }

    const result = await NotificationService.registerPushToken(
      req.user._id,
      token,
      platform,
      { deviceId, appVersion }
    );
    
    return ApiResponse.success(res, 200, result.message, result);
  });

  /**
   * Unregister push token
   */
  unregisterPushToken = catchAsync(async (req, res) => {
    const { token } = req.body;
    
    if (!token) {
      throw new AppError('Push token is required', 400);
    }

    const result = await NotificationService.unregisterPushToken(req.user._id, token);

    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Push token status.
   * Lets the client check on login whether an active token already exists for
   * this device — if so it can skip re-generating and re-registering.
   */
  getPushTokenStatus = catchAsync(async (req, res) => {
    const { deviceId } = req.query;

    const result = await NotificationService.hasActivePushToken(
      req.user._id,
      deviceId
    );

    return ApiResponse.success(res, 200, 'Push token status retrieved', result);
  });

  /**
   * Update notification preferences
   */
  updatePreferences = catchAsync(async (req, res) => {
    const { notifications } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (notifications && typeof notifications === 'object') {
      const allowed = ['email', 'sms', 'push'];
      for (const key of allowed) {
        if (typeof notifications[key] === 'boolean') {
          user.preferences.notifications[key] = notifications[key];
        }
      }
      await user.save();
    }

    return ApiResponse.success(res, 200, 'Notification preferences updated successfully', {
      notifications: user.preferences.notifications
    });
  });

  /**
   * Get notification preferences
   */
  getPreferences = catchAsync(async (req, res) => {
    const user = await User.findById(req.user._id)
      .select('preferences.notifications');

    if (!user) {
      throw new AppError('User not found', 404);
    }

    return ApiResponse.success(res, 200, 'Notification preferences retrieved successfully', {
      notifications: user.preferences.notifications
    });
  });

  /**
   * Send test notification
   */
  sendTestNotification = catchAsync(async (req, res) => {
    const { type = 'in_app' } = req.body;
    
    const notification = await NotificationService.sendTestNotification(req.user._id, type);
    
    return ApiResponse.success(res, 200, 'Test notification sent successfully', { notification });
  });

  /**
   * Get notification statistics
   */
  getNotificationStats = catchAsync(async (req, res) => {
    const stats = await NotificationService.getNotificationStats(req.user._id);
    
    return ApiResponse.success(res, 200, 'Notification statistics retrieved successfully', stats);
  });

  // ==================== ADMIN ROUTES ====================

  /**
   * Send broadcast notification (admin only)
   */
  sendBroadcast = catchAsync(async (req, res) => {
    const broadcastData = {
      ...req.body,
      sentBy: req.admin._id
    };

    const results = await NotificationService.sendAdminBroadcast(broadcastData);

    const message = results.queued
      ? `Broadcast queued for delivery to ${results.recipientCount} recipient(s)`
      : 'No active recipients matched the selected audience';

    return ApiResponse.success(res, 200, message, results);
  });

  /**
   * Get all notifications (admin only)
   */
  getAllNotifications = catchAsync(async (req, res) => {
    const { page = 1, limit = 20, ...filters } = req.query;
    
    // This would be an admin view of all system notifications
  
    
    const skip = (page - 1) * limit;
    const query = {};

    if (filters.userId) {
      query.user = filters.userId;
    }

    if (filters.type) {
      query.type = filters.type;
    }

    if (filters.status) {
      query.status = filters.status;
    }

    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .populate('user', 'profile.firstName profile.lastName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Notification.countDocuments(query)
    ]);

    return ApiResponse.success(res, 200, 'All notifications retrieved successfully', {
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  });

  /**
   * Get notification analytics (admin only)
   */
  getNotificationAnalytics = catchAsync(async (req, res) => {
    const { startDate, endDate } = req.query;
    
    const match = {};
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) match.createdAt.$lte = new Date(endDate);
    }

    const analytics = await Notification.aggregate([
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
                count: { $sum: 1 },
                read: {
                  $sum: { $cond: [{ $ne: ['$readAt', null] }, 1, 0] }
                }
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
                count: { $sum: 1 },
                delivered: {
                  $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered', 'read']] }, 1, 0] }
                },
                failed: {
                  $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
                }
              }
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
          ],
          readRate: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                read: {
                  $sum: { $cond: [{ $ne: ['$readAt', null] }, 1, 0] }
                }
              }
            },
            {
              $project: {
                rate: { $multiply: [{ $divide: ['$read', '$total'] }, 100] }
              }
            }
          ]
        }
      }
    ]);

    return ApiResponse.success(res, 200, 'Notification analytics retrieved successfully', analytics[0]);
  });

  /**
   * Get notification overview (admin only)
   * Returns the flat KPI shape the admin intelligence dashboard consumes.
   */
  getNotificationOverview = catchAsync(async (req, res) => {
    const { startDate, endDate } = req.query;

    const match = {};
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) match.createdAt.$lte = new Date(endDate);
    }

    const [agg] = await Notification.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalSent: {
            $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered', 'read']] }, 1, 0] },
          },
          delivered: {
            $sum: { $cond: [{ $ne: ['$tracking.deliveredAt', null] }, 1, 0] },
          },
          opened: {
            $sum: { $cond: [{ $ne: ['$readAt', null] }, 1, 0] },
          },
          clicked: {
            // A notification counts as "clicked" only when there is a real
            // click (a `tracking.clickedAt` or a 'clicked' tracking event).
            // The old check counted any doc with >=1 tracking event — but
            // sent/delivered/read all push events, so the CTR was inflated by
            // every delivered notification.
            $sum: {
              $cond: [
                {
                  $or: [
                    { $ne: ['$tracking.clickedAt', null] },
                    { $in: ['clicked', { $ifNull: ['$tracking.events.event', []] }] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
          },
          pendingQueue: {
            $sum: { $cond: [{ $in: ['$status', ['pending', 'processing', 'scheduled', 'queued']] }, 1, 0] },
          },
        },
      },
    ]);

    const totalSent = agg?.totalSent || 0;
    const delivered = agg?.delivered || 0;
    const opened = agg?.opened || 0;
    const clicked = agg?.clicked || 0;

    const overview = {
      totalSent,
      delivered,
      opened,
      clicked,
      failed: agg?.failed || 0,
      ctr: opened > 0 ? Number(((clicked / opened) * 100).toFixed(1)) : 0,
      deliveryRate: totalSent > 0 ? Number(((delivered / totalSent) * 100).toFixed(1)) : 0,
      avgDeliveryTimeSeconds: 0,
      pendingQueue: agg?.pendingQueue || 0,
    };

    return ApiResponse.success(res, 200, 'Notification overview retrieved successfully', overview);
  });

  /**
   * Clean up old notifications (admin only)
   */
  cleanupOldNotifications = catchAsync(async (req, res) => {
    const { days = 30 } = req.query;
    
    const result = await NotificationService.cleanupOldNotifications(parseInt(days));
    
    return ApiResponse.success(res, 200, `Cleaned up ${result.deletedCount} old notifications`);
  });

  /**
   * Resend failed notification (admin only)
   */
  resendFailedNotification = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const notification = await Notification.findById(id);
    
    if (!notification) {
      throw new AppError('Notification not found', 404);
    }

    notification.status = 'pending';
    // Reset the retry budget: if the previous attempts already hit maxRetries
    // (3), scheduleRetry() refuses to enqueue another retry. A manual admin
    // resend is a fresh attempt, so clear the count (and stale failure marks)
    // to give it the full backoff window again.
    notification.tracking = {
      ...notification.tracking,
      retryCount: 0,
      failureReason: undefined,
      failedAt: undefined,
    };
    await notification.save();

    // Process asynchronously. Resolving the audience + fanning out is slow for
    // email/push, so we hand off and return "initiated" immediately.
    NotificationService.processNotification(notification).catch(error => {
      logger.error(`Error resending notification ${id}:`, error);
    });

    return ApiResponse.success(res, 200, 'Notification resend initiated');
  });

  /**
   * Broadcast diagnostic. Confirms whether the BullMQ worker is alive, whether
   * the notification queue is consuming jobs, and whether broadcasts actually
   * produced notification documents. Use this to tell apart "worker not running
   * / disconnected" from "delivery reached no one".
   */
  getBroadcastStatus = catchAsync(async (req, res) => {
    const queue = queues.notification;

    let counts = null;
    if (queue) {
      try {
        counts = await queue.getJobCounts(); // waiting/active/completed/failed/delayed/paused
      } catch (err) {
        logger.error('getBroadcastStatus: getJobCounts failed:', err.message);
      }
    }

    const recentJobs = { completed: [], failed: [] };
    if (queue) {
      try {
        recentJobs.completed = (await queue.getCompleted(0, 10)).map((j) => ({
          id: j.id,
          name: j.name,
          timestamp: j.timestamp,
          returnvalue: j.returnvalue,
        }));
      } catch { /* ignore */ }
      try {
        recentJobs.failed = (await queue.getFailed(0, 10)).map((j) => ({
          id: j.id,
          name: j.name,
          timestamp: j.timestamp,
          failedReason: j.failedReason,
          data: j.data,
        }));
      } catch { /* ignore */ }
    }

    const recentDocs = await Notification.find({ 'data.broadcast': true })
      .select('notificationNumber user type title status category createdAt tracking.readAt data.broadcastId')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return ApiResponse.success(res, 200, 'Broadcast status retrieved', {
      workerRunning: Boolean(workers.notification),
      redisConnected: counts !== null,
      counts,
      recentJobs,
      recentBroadcastDocuments: recentDocs,
    });
  });

  /**
   * Broadcast self-test. Runs two probes in one call to isolate WHERE delivery
   * breaks:
   *  - sync: createBulkNotifications + processNotification INLINE (no BullMQ) —
   *          proves the fan-out + in-app delivery logic works on its own.
   *  - async: enqueues a real BullMQ 'broadcast' job and reads queue counts
   *           after a short wait — proves whether the worker consumes it.
   * If sync succeeds but async never moves waiting→completed/failed, the worker
   * is the problem; if both fail, it's the fan-out/delivery code.
   */
  testBroadcast = catchAsync(async (req, res) => {
    const { target = 'users', title = 'Broadcast Self-Test', type = 'in_app' } = req.body;

    // Resolve up to 2 recipients exactly as sendAdminBroadcast does.
    let recipients = [];
    if (target === 'all') {
      recipients = await User.find({ 'status.isActive': true }).limit(2).distinct('_id');
    } else if (target === 'vendors') {
      recipients = await User.find({ role: 'user', 'status.isActive': true }).limit(2).distinct('_id');
    } else {
      recipients = await User.find({ role: 'user', 'status.isActive': true }).limit(2).distinct('_id');
    }

    const payload = {
      type,
      category: 'system',
      title,
      content: { text: `${title} (self-test)` },
      priority: 'medium',
      data: { broadcast: true, selfTest: true, sentBy: req.admin?._id },
    };

    // 1) SYNCHRONOUS probe — no BullMQ involved.
    let syncResult;
    const syncStart = Date.now();
    try {
      const { notifications, results } = await NotificationService.createBulkNotifications(recipients, payload);
      syncResult = {
        ok: true,
        ms: Date.now() - syncStart,
        created: notifications.length,
        results,
      };
    } catch (err) {
      syncResult = { ok: false, ms: Date.now() - syncStart, error: err.message };
    }

    // 2) ASYNC probe — real BullMQ 'broadcast' job, then read queue state.
    let asyncResult;
    const queue = queues.notification;
    try {
      const recipientIds = recipients.map((id) => String(id));
      const job = await addJob(
        'notification',
        'broadcast',
        { broadcastId: 'SELFTEST', recipients: recipientIds, payload, target },
        { attempts: 1 }
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const counts = queue ? await queue.getJobCounts() : null;
      asyncResult = { queuedJobId: job?.id ?? null, ok: true, counts };
    } catch (err) {
      asyncResult = { ok: false, error: err.message };
    }

    return ApiResponse.success(res, 200, 'Broadcast self-test complete', {
      recipients: recipients.length,
      type,
      syncResult,
      asyncResult,
    });
  });
}

module.exports = new NotificationController();