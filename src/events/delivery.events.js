const eventEmitter = require('./eventEmitter');
const EVENTS = require('./events.constants');
const logger = require('../config/logger');
const { emitToRoom, emitToUser } = require('../socket/emitter');
const { Delivery } = require('../models');
const { createNotification } = require('../services/notification.service');
const { processJob } = require('../jobs');

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

const buildLocationPayload = (data) => ({
  deliveryId: data.deliveryId,
  deliveryNumber: data.deliveryNumber,
  location: data.location,
  status: data.status,
  estimatedArrival: data.estimatedArrival,
  personId: data.personId,
  timestamp: data.timestamp || new Date(),
});

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const fullName = (u) =>
  u?.profile ? `${u.profile.firstName || ''} ${u.profile.lastName || ''}`.trim() : (u?.name || 'Customer');

const money = (n) => (n === null || n === undefined || isNaN(n) ? '0' : Number(n).toLocaleString('en-IN'));

// Load full delivery (rental → user / product / vendor.user) for notifications.
// Returns null when the delivery no longer exists (edge case).
const loadDeliveryForEvent = async (deliveryId) => {
  try {
    return await Delivery.findById(deliveryId)
      .populate('address')
      .populate({
        path: 'rental',
        populate: [
          { path: 'user', select: 'email profile.firstName profile.lastName' },
          { path: 'product', select: 'basicInfo.name' },
          {
            path: 'vendor',
            select: 'user business.name',
            populate: { path: 'user', select: 'email profile.firstName profile.lastName' },
          },
        ],
      })
      .lean();
  } catch (err) {
    logger.error(`Error loading delivery ${deliveryId}:`, err.message);
    return null;
  }
};

// Shared delivery context used by every status handler: customer + vendor
// user objects, address, product name, tracking URL, slot label.
const buildDeliveryContext = (delivery) => {
  const rental = delivery.rental || {};
  const address = delivery.address || {};
  const customer = rental.user || {};
  const vendorUser = rental.vendor?.user || {};
  const slot = delivery.schedule?.scheduledSlot;
  const slotLabel =
    slot?.label ||
    (slot?.start && slot?.end ? `${slot.start} - ${slot.end}` : 'Flexible slot');

  return {
    deliveryNumber: delivery.deliveryNumber,
    rentalNumber: rental.rentalNumber,
    productName: rental.product?.basicInfo?.name || (delivery.items && delivery.items[0]?.name) || 'Your item',
    customer,
    vendorUser,
    address: {
      addressLine1: address.addressLine1 || '',
      addressLine2: address.addressLine2 || '',
      city: address.city || '',
      state: address.state || '',
      pincode: address.pincode || '',
    },
    deliveryDate: formatDate(delivery.schedule?.scheduledDate),
    deliverySlot: slotLabel,
    trackUrl: `${CLIENT_URL}/deliveries/track/${delivery.deliveryNumber}`,
    status: delivery.status,
  };
};

// Isolated notifier: never lets a notification/email failure break the flow.
const notifyCustomer = async (ctx, { title, content, template, subject, extra = {} }) => {
  if (!ctx.customer?._id) return;
  try {
    await createNotification({
      userId: ctx.customer._id,
      type: 'in_app',
      category: 'delivery',
      title,
      content,
      data: { deliveryId: ctx.deliveryId, deliveryNumber: ctx.deliveryNumber, status: ctx.status },
      priority: 'high',
    });
  } catch (err) {
    logger.error(`Delivery notify customer in-app failed (${ctx.deliveryNumber}):`, err.message);
  }
  if (ctx.customer.email && template) {
    try {
      await processJob('email:send', {
        to: ctx.customer.email,
        subject,
        template,
        data: {
          name: fullName(ctx.customer),
          deliveryNumber: ctx.deliveryNumber,
          rentalNumber: ctx.rentalNumber,
          productName: ctx.productName,
          deliveryDate: ctx.deliveryDate,
          deliverySlot: ctx.deliverySlot,
          address: ctx.address,
          trackUrl: ctx.trackUrl,
          ...extra,
        },
      });
    } catch (err) {
      logger.error(`Delivery customer email failed (${ctx.deliveryNumber}):`, err.message);
    }
  }
};

const notifyVendor = async (ctx, { title, content, template, subject, extra = {} }) => {
  if (!ctx.vendorUser?._id) return;
  try {
    await createNotification({
      userId: ctx.vendorUser._id,
      type: 'in_app',
      category: 'delivery',
      title,
      content,
      data: { deliveryId: ctx.deliveryId, deliveryNumber: ctx.deliveryNumber, status: ctx.status },
      priority: 'high',
    });
  } catch (err) {
    logger.error(`Delivery notify vendor in-app failed (${ctx.deliveryNumber}):`, err.message);
  }
  if (ctx.vendorUser.email && template) {
    try {
      await processJob('email:send', {
        to: ctx.vendorUser.email,
        subject,
        template,
        data: {
          name: fullName(ctx.vendorUser) || (ctx.vendorName || 'Vendor'),
          isVendor: true,
          deliveryNumber: ctx.deliveryNumber,
          rentalNumber: ctx.rentalNumber,
          productName: ctx.productName,
          deliveryDate: ctx.deliveryDate,
          deliverySlot: ctx.deliverySlot,
          address: ctx.address,
          trackUrl: `${CLIENT_URL}/vendor/orders`,
          ...extra,
        },
      });
    } catch (err) {
      logger.error(`Delivery vendor email failed (${ctx.deliveryNumber}):`, err.message);
    }
  }
};

// ── Status handlers ────────────────────────────────────────────────────────

// 1. Out for delivery → customer: in-app + email
eventEmitter.on(EVENTS.DELIVERY.OUT_FOR_DELIVERY, async (data) => {
  try {
    const delivery = await loadDeliveryForEvent(data.deliveryId);
    if (!delivery) {
      logger.warn(`OUT_FOR_DELIVERY event: delivery ${data.deliveryId} not found, skipping`);
      return;
    }
    const ctx = { ...buildDeliveryContext(delivery), deliveryId: delivery._id };

    await notifyCustomer(ctx, {
      title: 'Your Order Is Out for Delivery 🚚',
      content: `Your order #${ctx.rentalNumber} is out for delivery. Delivery partner is on the way!`,
      template: 'delivery-out-for-delivery',
      subject: `Your Order Is Out for Delivery #${ctx.deliveryNumber} - RentEase`,
    });

    // SMS (was previously sent inline in startDelivery — kept behaviour)
    if (delivery.contact?.phone) {
      try {
        await processJob('sms:send', {
          to: delivery.contact.phone,
          message: `Your RentEase delivery #${ctx.deliveryNumber} is on the way! Track here: ${ctx.trackUrl}`,
        });
      } catch (err) {
        logger.error(`Delivery SMS failed (${ctx.deliveryNumber}):`, err.message);
      }
    }

    emitToUser(ctx.customer?._id, 'delivery:status', { deliveryId: ctx.deliveryId, status: 'out_for_delivery' });
    emitToRoom(`delivery:${ctx.deliveryId}`, 'delivery:status', { deliveryId: ctx.deliveryId, status: 'out_for_delivery' });
  } catch (error) {
    logger.error('Error handling delivery OUT_FOR_DELIVERY event:', error.message);
  }
});

// 2. In transit → customer: in-app + email (ETA update)
eventEmitter.on(EVENTS.DELIVERY.IN_TRANSIT, async (data) => {
  try {
    const delivery = await loadDeliveryForEvent(data.deliveryId);
    if (!delivery) {
      logger.warn(`IN_TRANSIT event: delivery ${data.deliveryId} not found, skipping`);
      return;
    }
    const ctx = { ...buildDeliveryContext(delivery), deliveryId: delivery._id };

    await notifyCustomer(ctx, {
      title: 'Delivery Partner Is On the Way 🛵',
      content: `Your delivery #${ctx.deliveryNumber} is in transit. Your delivery partner is on the way!`,
      template: 'delivery-in-transit',
      subject: `Your Delivery Is On the Way #${ctx.deliveryNumber} - RentEase`,
      extra: {
        estimatedArrival: data.estimatedArrival
          ? formatDate(data.estimatedArrival) +
            ' ' +
            new Date(data.estimatedArrival).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
          : null,
      },
    });
  } catch (error) {
    logger.error('Error handling delivery IN_TRANSIT event:', error.message);
  }
});

// 3. Reached → customer: in-app + email (partner arrived)
eventEmitter.on(EVENTS.DELIVERY.REACHED, async (data) => {
  try {
    const delivery = await loadDeliveryForEvent(data.deliveryId);
    if (!delivery) {
      logger.warn(`REACHED event: delivery ${data.deliveryId} not found, skipping`);
      return;
    }
    const ctx = { ...buildDeliveryContext(delivery), deliveryId: delivery._id };

    await notifyCustomer(ctx, {
      title: 'Delivery Partner Has Arrived 📍',
      content: `Your delivery partner has reached your location for order #${ctx.rentalNumber}. Please be ready to receive it.`,
      template: 'delivery-reached',
      subject: `Your Delivery Partner Has Arrived #${ctx.deliveryNumber} - RentEase`,
    });

    emitToUser(ctx.customer?._id, 'delivery:status', { deliveryId: ctx.deliveryId, status: 'reached' });
    emitToRoom(`delivery:${ctx.deliveryId}`, 'delivery:status', { deliveryId: ctx.deliveryId, status: 'reached' });
  } catch (error) {
    logger.error('Error handling delivery REACHED event:', error.message);
  }
});

// 4. Delivered → customer + vendor: in-app + email
eventEmitter.on(EVENTS.DELIVERY.DELIVERED, async (data) => {
  try {
    const delivery = await loadDeliveryForEvent(data.deliveryId);
    if (!delivery) {
      logger.warn(`DELIVERED event: delivery ${data.deliveryId} not found, skipping`);
      return;
    }
    const ctx = {
      ...buildDeliveryContext(delivery),
      deliveryId: delivery._id,
      vendorName: delivery.rental?.vendor?.business?.name,
    };
    const receivedBy = delivery.contact?.name || delivery.proof?.deliveredTo;

    await notifyCustomer(ctx, {
      title: 'Your Order Has Been Delivered! 🎉',
      content: `Your order #${ctx.rentalNumber} has been delivered successfully. Enjoy your rental!`,
      template: 'delivery-delivered',
      subject: `Your Order Has Been Delivered #${ctx.deliveryNumber} - RentEase`,
      extra: { receivedBy },
    });

    await notifyVendor(ctx, {
      title: 'Delivery Completed ✅',
      content: `Delivery #${ctx.deliveryNumber} for order #${ctx.rentalNumber} has been completed.`,
      template: 'delivery-delivered',
      subject: `Delivery Completed #${ctx.deliveryNumber} - RentEase`,
      extra: { receivedBy },
    });

    emitToUser(ctx.customer?._id, 'delivery:status', { deliveryId: ctx.deliveryId, status: 'delivered' });
    emitToRoom(`delivery:${ctx.deliveryId}`, 'delivery:status', { deliveryId: ctx.deliveryId, status: 'delivered' });
  } catch (error) {
    logger.error('Error handling delivery DELIVERED event:', error.message);
  }
});

// 5. Failed → customer + vendor: in-app + email
eventEmitter.on(EVENTS.DELIVERY.FAILED, async (data) => {
  try {
    const delivery = await loadDeliveryForEvent(data.deliveryId);
    if (!delivery) {
      logger.warn(`FAILED event: delivery ${data.deliveryId} not found, skipping`);
      return;
    }
    const ctx = {
      ...buildDeliveryContext(delivery),
      deliveryId: delivery._id,
      vendorName: delivery.rental?.vendor?.business?.name,
    };
    const reason = data.reason || 'delivery could not be completed';

    await notifyCustomer(ctx, {
      title: 'Delivery Attempt Failed ⚠️',
      content: `Your delivery #${ctx.deliveryNumber} could not be completed. Reason: ${reason}. We'll arrange a retry.`,
      template: 'delivery-failed',
      subject: `Delivery Attempt Failed #${ctx.deliveryNumber} - RentEase`,
      extra: { reason, rescheduled: !!data.rescheduled },
    });

    await notifyVendor(ctx, {
      title: 'Delivery Failed ⚠️',
      content: `Delivery #${ctx.deliveryNumber} for order #${ctx.rentalNumber} failed. Reason: ${reason}.`,
      template: 'delivery-failed',
      subject: `Delivery Failed #${ctx.deliveryNumber} - Action Required`,
      extra: { reason, rescheduled: !!data.rescheduled },
    });
  } catch (error) {
    logger.error('Error handling delivery FAILED event:', error.message);
  }
});

// 6. Cancelled → customer + vendor: in-app + email
eventEmitter.on(EVENTS.DELIVERY.CANCELLED, async (data) => {
  try {
    const delivery = await loadDeliveryForEvent(data.deliveryId);
    if (!delivery) {
      logger.warn(`CANCELLED event: delivery ${data.deliveryId} not found, skipping`);
      return;
    }
    const ctx = {
      ...buildDeliveryContext(delivery),
      deliveryId: delivery._id,
      vendorName: delivery.rental?.vendor?.business?.name,
    };
    const reason = data.reason || 'cancelled';

    await notifyCustomer(ctx, {
      title: 'Delivery Cancelled',
      content: `Your delivery #${ctx.deliveryNumber} has been cancelled.${data.refundAmount ? ` Refund of ₹${money(data.refundAmount)} will be processed.` : ''}`,
      template: 'delivery-cancelled',
      subject: `Order Cancelled #${ctx.rentalNumber} - RentEase`,
      extra: { reason, refundAmount: data.refundAmount },
    });

    await notifyVendor(ctx, {
      title: 'Delivery Cancelled',
      content: `Delivery #${ctx.deliveryNumber} for order #${ctx.rentalNumber} has been cancelled.`,
      template: 'delivery-cancelled',
      subject: `Order Cancelled #${ctx.rentalNumber} - RentEase`,
      extra: { reason },
    });
  } catch (error) {
    logger.error('Error handling delivery CANCELLED event:', error.message);
  }
});

// ── Real-time location handlers (existing) ─────────────────────────────────

eventEmitter.on('delivery:location-updated', async (data) => {
  try {
    const payload = buildLocationPayload(data);

    if (data.deliveryId) {
      emitToRoom(`delivery:${data.deliveryId}`, 'delivery:location', payload);
    }

    if (data.deliveryNumber) {
      emitToRoom(`delivery:track:${data.deliveryNumber}`, 'delivery:location', payload);
    }

    if (data.customerUserId) {
      emitToUser(data.customerUserId, 'delivery:tracking', payload);
    }
  } catch (error) {
    logger.error('delivery:location-updated socket handler error:', error);
  }
});

eventEmitter.on('delivery:partner-location-updated', async (data) => {
  try {
    const payload = {
      personId: data.personId,
      userId: data.userId,
      location: data.location,
      currentLocation: data.currentLocation,
      activeDeliveryIds: data.activeDeliveryIds || [],
      timestamp: data.timestamp || new Date(),
    };

    emitToRoom(`delivery:partner:${data.personId}`, 'delivery:partner:location', payload);

    if (data.userId) {
      emitToUser(data.userId, 'delivery:partner:location', payload);
    }

    for (const deliveryId of payload.activeDeliveryIds) {
      emitToRoom(`delivery:${deliveryId}`, 'delivery:partner:location', payload);
    }
  } catch (error) {
    logger.error('delivery:partner-location-updated socket handler error:', error);
  }
});

module.exports = eventEmitter;
