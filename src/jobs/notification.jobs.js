const logger = require('../config/logger');
const { Notification } = require('../models');
const { emitToUser } = require('../socket');
const { sendEmail } = require('../services/email.service');
const { sendSMS } = require('../services/sms.service');
const NotificationService = require('../services/notification.service');

// Notification job processor
const process = async (type, data) => {
  logger.info(`Processing notification job: ${type}`, { data });

  switch (type) {
    case 'create':
      return await handleCreateNotification(data);
       
    case 'send':
      return await handleSendNotification(data);
       
    case 'batch':
      return await handleBatchNotification(data);
       
    case 'reminder':
      return await handleReminderNotification(data);

    case 'retry':
      return await handleRetryNotification(data);
       
    case 'cleanup':
      return await handleCleanupNotifications(data);
       
    default:
      throw new Error(`Unknown notification job type: ${type}`);
  }
};

// Retry a previously failed notification (enqueued by NotificationService.scheduleRetry)
const handleRetryNotification = async (data) => {
  const { notificationId } = data;
  const notification = await Notification.findById(notificationId);
  if (!notification) {
    throw new Error(`Notification not found: ${notificationId}`);
  }
  if (notification.status === 'sent' || notification.status === 'read') {
    return notification; // already delivered
  }
  return NotificationService.processNotification(notification);
};

// Handle create notification
const handleCreateNotification = async (data) => {
  const { userId, type, title, content, data: metaData, scheduledFor } = data;

  const notification = await Notification.create({
    user: userId,
    type,
    title,
    content,
    data: metaData,
    status: scheduledFor ? 'scheduled' : 'pending',
    schedule: scheduledFor ? { scheduledFor } : undefined,
  });

  if (!scheduledFor) {
    // Process immediately
    await processNotification(notification);
  }

  return notification;
};

// Handle send notification
const handleSendNotification = async (data) => {
  const { notificationId } = data;
  
  const notification = await Notification.findById(notificationId)
    .populate('user');

  if (!notification) {
    throw new Error(`Notification not found: ${notificationId}`);
  }

  return processNotification(notification);
};

// Handle batch notifications
const handleBatchNotification = async (data) => {
  const { userIds, type, title, content, metaData } = data;
  
  const notifications = [];
  
  for (const userId of userIds) {
    const notification = await Notification.create({
      user: userId,
      type,
      title,
      content,
      data: metaData,
      status: 'pending',
    });
    
    notifications.push(notification);
    
    // Process each notification
    await processNotification(notification);
  }
  
  return { count: notifications.length };
};

// Handle reminder notifications
const handleReminderNotification = async (data) => {
  const { userId, reminderType, referenceId, dueDate } = data;
  
  let title, content;
  
  switch (reminderType) {
    case 'payment':
      title = 'Payment Reminder';
      content = `Your payment of ₹${data.amount} for rental #${data.rentalNumber} is due on ${new Date(dueDate).toLocaleDateString()}`;
      break;
      
    case 'return':
      title = 'Return Reminder';
      content = `Your rental #${data.rentalNumber} is due for return on ${new Date(dueDate).toLocaleDateString()}`;
      break;
      
    case 'review':
      title = 'Review Reminder';
      content = 'Please take a moment to review your recent rental experience';
      break;
      
    default:
      title = 'Reminder';
      content = data.content || 'You have a pending action';
  }

  return handleCreateNotification({
    userId,
    type: 'in_app',
    title,
    content,
    data: { reminderType, referenceId, dueDate, ...data },
  });
};

// Handle cleanup old notifications
const handleCleanupNotifications = async (data) => {
  const { olderThan = 30 } = data; // days
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThan);
  
  const result = await Notification.deleteMany({
    createdAt: { $lt: cutoffDate },
    status: { $in: ['sent', 'delivered', 'read'] },
  });
  
  logger.info(`Cleaned up ${result.deletedCount} old notifications`);
  return result;
};

// Process individual notification
const processNotification = async (notification) => {
  try {
    // Update status to processing
    notification.status = 'processing';
    await notification.save();

    // Send based on type
    switch (notification.type) {
      case 'in_app':
        await sendInAppNotification(notification);
        break;
        
      case 'email':
        await sendEmailNotification(notification);
        break;
        
      case 'sms':
        await sendSMSNotification(notification);
        break;
        
      case 'push':
        await sendPushNotification(notification);
        break;
    }

    // Update status to sent
    notification.status = 'sent';
    notification.tracking.sentAt = new Date();
    await notification.save();

    return notification;
  } catch (error) {
    logger.error('Error processing notification:', error);
    
    notification.status = 'failed';
    notification.tracking.failedAt = new Date();
    notification.tracking.failureReason = error.message;
    await notification.save();
    
    throw error;
  }
};

// Send in-app notification
const sendInAppNotification = async (notification) => {
  const user = notification.user;
  
  if (user) {
    emitToUser(user._id, 'notification:receive', {
      id: notification._id,
      title: notification.title,
      content: notification.content,
      data: notification.data,
      timestamp: notification.createdAt,
    });
  }
  
  notification.tracking.deliveredAt = new Date();
  await notification.save();
};

// Send email notification
const sendEmailNotification = async (notification) => {
  const user = notification.user;
  
  if (!user?.email) {
    throw new Error('User email not found');
  }

  await sendEmail({
    to: user.email,
    subject: notification.title,
    html: notification.content,
    data: notification.data,
  });
};

// Send SMS notification
const sendSMSNotification = async (notification) => {
  const user = notification.user;
  
  if (!user?.phone) {
    throw new Error('User phone not found');
  }

  await sendSMS({
    to: user.phone,
    message: notification.content,
    data: notification.data,
  });
};

// Send push notification (delegates to the shared service so FCM logic stays in one place)
const sendPushNotification = async (notification) => {
  return NotificationService.sendPushNotification(notification);
};

module.exports = { process };