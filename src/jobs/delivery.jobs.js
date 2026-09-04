const logger = require('../config/logger');
const { Delivery } = require('../models');
const NotificationService = require('../services/notification.service');

// Delivery job processor.
// Enqueued from:
//  - rental.service.js confirmRental -> addJob('delivery', 'prepare', ...)
//  - delivery.service.js scheduleDeliveryReminders -> addJob('delivery', 'reminder' | 'staff-reminder', ...)
const process = async (type, data) => {
  logger.info(`Processing delivery job: ${type}`, { data });

  switch (type) {
    case 'prepare':
      return await handlePrepare(data);

    case 'reminder':
      return await handleReminder(data);

    case 'staff-reminder':
      return await handleStaffReminder(data);

    default:
      throw new Error(`Unknown delivery job type: ${type}`);
  }
};

// Runs ~24h before the scheduled delivery date (scheduled at vendor confirm).
// Marks the delivery as prepared and nudges the vendor to start packing.
const handlePrepare = async (data) => {
  const { rentalId } = data;

  const delivery = await Delivery.findOne({ rental: rentalId, type: 'delivery' })
    .populate('rental', 'vendor rentalNumber user');

  if (!delivery) {
    logger.warn(`[delivery/prepare] No delivery found for rental ${rentalId} — skipping`);
    return null;
  }

  delivery.metadata = delivery.metadata || {};
  delivery.metadata.preparedAt = new Date();
  if (!(delivery.metadata.tags || []).includes('prepared')) {
    delivery.metadata.tags = delivery.metadata.tags || [];
    delivery.metadata.tags.push('prepared');
  }
  await delivery.save();

  const rental = delivery.rental;
  if (rental && rental.vendor) {
    try {
      await NotificationService.createNotification({
        userId: rental.vendor,
        type: 'in_app',
        title: 'Delivery Preparation Due',
        content: `Order ${rental.rentalNumber} is scheduled for delivery soon. Please prepare the items.`,
        data: { rentalId, deliveryId: String(delivery._id) },
      });
    } catch (err) {
      logger.error(`[delivery/prepare] Vendor notification failed: ${err.message}`);
    }
  }

  logger.info(`[delivery/prepare] Delivery ${delivery.deliveryNumber} marked prepared`);
  return delivery;
};

// Customer reminders: 24h and 2h before the scheduled delivery.
const handleReminder = async (data) => {
  const { deliveryId, userId, type = '24h' } = data;

  const delivery = await Delivery.findById(deliveryId).populate('rental', 'rentalNumber');
  if (!delivery) {
    logger.warn(`[delivery/reminder] Delivery ${deliveryId} not found — skipping`);
    return null;
  }

  const hoursLabel = type === '2h' ? '2 hours' : '24 hours';
  try {
    await NotificationService.createNotification({
      userId,
      type: 'in_app',
      title: 'Delivery Reminder',
      content: `Your delivery for order ${delivery.rental?.rentalNumber || ''} is scheduled within ${hoursLabel}.`,
      data: { deliveryId: String(delivery._id), rentalId: String(delivery.rental?._id || ''), reminderType: type },
    });
  } catch (err) {
    logger.error(`[delivery/reminder] Notification failed: ${err.message}`);
  }

  return { notified: true, deliveryId: String(delivery._id), type };
};

// Remind an assigned delivery person ~1h before the delivery.
const handleStaffReminder = async (data) => {
  const { deliveryId, userId } = data;

  const delivery = await Delivery.findById(deliveryId).populate('rental', 'rentalNumber');
  if (!delivery) {
    logger.warn(`[delivery/staff-reminder] Delivery ${deliveryId} not found — skipping`);
    return null;
  }

  try {
    await NotificationService.createNotification({
      userId,
      type: 'in_app',
      title: 'Upcoming Delivery',
      content: `Delivery ${delivery.deliveryNumber} (order ${delivery.rental?.rentalNumber || ''}) is scheduled within 1 hour.`,
      data: { deliveryId: String(delivery._id), rentalId: String(delivery.rental?._id || '') },
    });
  } catch (err) {
    logger.error(`[delivery/staff-reminder] Notification failed: ${err.message}`);
  }

  return { notified: true, deliveryId: String(delivery._id) };
};

module.exports = { process };
