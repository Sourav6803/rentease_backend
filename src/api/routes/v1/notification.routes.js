const express = require('express');
const router = express.Router();
const notificationController = require('../../controllers/notification.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { notificationValidations } = require('../../middlewares/validation.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');

// All notification routes require authentication
router.use(protect);

// ==================== USER NOTIFICATION ROUTES ====================

// Get user notifications
router.get('/', notificationController.getUserNotifications);

// Get unread count
router.get('/unread/count', notificationController.getUnreadCount);

// Get notification preferences
router.get('/preferences', notificationController.getPreferences);

// Update notification preferences
router.put('/preferences',
  validate(notificationValidations.updatePreferences),
  notificationController.updatePreferences
);

// Mark all as read
router.post('/read-all', notificationController.markAllAsRead);

// Get notification statistics
router.get('/stats', notificationController.getNotificationStats);

// Register push token
router.post('/push/register', 
  validate(notificationValidations.registerPushToken),
  notificationController.registerPushToken
);

// Unregister push token
router.post('/push/unregister', 
  validate(notificationValidations.unregisterPushToken),
  notificationController.unregisterPushToken
);

// Send test notification
router.post('/test', notificationController.sendTestNotification);

// Mark notification as read
router.patch('/:id/read', notificationController.markAsRead);

// Delete notification
router.delete('/:id', notificationController.deleteNotification);

// Clear all notifications
router.delete('/', notificationController.clearAllNotifications);

// ==================== ADMIN NOTIFICATION ROUTES ====================

// Admin routes
router.use('/admin', restrictTo('admin', 'super-admin'));

// Send broadcast notification
router.post('/admin/broadcast', 
  validate(notificationValidations.broadcast),
  notificationController.sendBroadcast
);

// Get all notifications (admin view)
router.get('/admin/all', notificationController.getAllNotifications);

// Get notification analytics
router.get('/admin/analytics', notificationController.getNotificationAnalytics);

// Clean up old notifications
router.delete('/admin/cleanup', notificationController.cleanupOldNotifications);

// Resend failed notification
router.post('/admin/:id/resend', notificationController.resendFailedNotification);

module.exports = router;