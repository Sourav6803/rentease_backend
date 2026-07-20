const NotificationService = require('../../services/notification.service');
const catchAsync = require('../../utils/catchAsync');
const {ApiResponse} = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const Notification = require('../../models/Notification.model');
const User = require('../../models/User.model');

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
    
    return ApiResponse.success(res, 200, 'Broadcast notification sent successfully', results);
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
                count: { $sum: 1 }
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
    await notification.save();

    // Process asynchronously
    NotificationService.processNotification(notification).catch(error => {
      logger.error(`Error resending notification ${id}:`, error);
    });

    return ApiResponse.success(res, 200, 'Notification resend initiated');
  });
}

module.exports = new NotificationController();