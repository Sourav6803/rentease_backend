const eventEmitter = require('./eventEmitter');
const logger = require('../config/logger');
const { emitToUser } = require('../socket/emitter');

/**
 * Build the wire payload delivered to clients over Socket.IO.
 * Kept in sync with the shape emitted by the notification job
 * (`jobs/notification.jobs.js` -> `notification:receive`) and consumed by the
 * frontend `useNotifications` hook so both real-time paths look identical.
 */
const buildNotificationPayload = (notification = {}) => {
  const content = notification.content || {};
  return {
    id: notification._id,
    title: notification.title,
    // Prefer plain text, fall back to preview, then to a raw string content.
    body:
      typeof content === 'string'
        ? content
        : content.text || content.preview || '',
    content,
    type: notification.type,
    category: notification.category,
    priority: notification.priority,
    data: notification.data || {},
    read: Boolean(notification.readAt || notification.tracking?.readAt),
    createdAt: notification.createdAt,
    timestamp: notification.createdAt || new Date(),
  };
};

/**
 * The notification service emits `notification:sent` on the in-process event
 * bus for in-app notifications, but it has no way to reach the browser on its
 * own. Bridge that to the client socket here as `notification:receive` — the
 * single event name the frontend listens for.
 */
eventEmitter.on('notification:sent', async ({ userId, notification } = {}) => {
  try {
    if (!userId || !notification) return;
    emitToUser(userId, 'notification:receive', buildNotificationPayload(notification));
  } catch (error) {
    logger.error('notification:sent socket handler error:', error);
  }
});

module.exports = eventEmitter;
