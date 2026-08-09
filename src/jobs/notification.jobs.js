const logger = require('../config/logger');
const { Notification } = require('../models');
const NotificationService = require('../services/notification.service');

// Notification job processor
const process = async (type, data) => {
  logger.info(`Processing notification job: ${type}`, { data });

  switch (type) {
    case 'create':
      return await handleCreateNotification(data);
       
    case 'send':
      return await handleSendNotification(data);

    case 'send-scheduled':
      return await handleSendScheduledNotification(data);

    case 'batch':
      return await handleBatchNotification(data);

    case 'broadcast':
      return await handleBroadcastNotification(data);
       
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

// Handle a scheduled notification whose delay has elapsed.
// Enqueued by NotificationService.createNotification with a BullMQ delay equal
// to `scheduledFor - now`. When it fires we flip the doc out of 'scheduled' and
// hand it to the SHARED service processor (retry/event/tracking logic) rather
// than the divergent copy in this file.
const handleSendScheduledNotification = async (data) => {
  const { notificationId } = data;

  const notification = await Notification.findById(notificationId);
  if (!notification) {
    throw new Error(`Notification not found: ${notificationId}`);
  }

  // Already delivered/cancelled by another path — nothing to do.
  if (['sent', 'delivered', 'read', 'cancelled'].includes(notification.status)) {
    return notification;
  }

  notification.status = 'pending';
  await notification.save();

  return NotificationService.processNotification(notification);
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

// Handle a durable admin broadcast. Enqueued by
// NotificationService.sendAdminBroadcast as a BullMQ job (attempts: 1) so the
// audience fan-out survives a server restart — the previous setImmediate was
// lost entirely if the process died after the HTTP response. Each recipient is
// still created through createNotification, which keeps its own per-notification
// durability (and schedules per-recipient delay jobs when scheduledFor is set).
const handleBroadcastNotification = async (data) => {
  const { broadcastId, recipients = [], payload = {} } = data;
  const tag = broadcastId ? `[broadcast ${broadcastId}]` : '[broadcast]';

  logger.info(`${tag} worker processing ${recipients.length} recipient(s)`);

  if (!Array.isArray(recipients) || recipients.length === 0) {
    logger.warn(`${tag} no recipients — nothing to fan out`);
    return { queued: false, recipientCount: 0 };
  }

  const { notifications, results } = await NotificationService.createBulkNotifications(recipients, payload);
  logger.info(
    `${tag} done: ${results.successful} sent, ${results.failed} failed ` +
    `(recipients=${recipients.length}, docs=${notifications?.length || 0})`
  );
  return results;
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

// Process individual notification.
// Delegates to the SHARED service processor so every enqueued job (create,
// batch, send, scheduled, retry) goes through one code path with retry/backoff,
// unread-cache invalidation, and the notification:sent socket bridge. The
// previous local copy had none of those, so create/batch jobs silently skipped
// retries and real-time delivery for in-app notifications.
const processNotification = async (notification) => {
  return NotificationService.processNotification(notification);
};

module.exports = { process };