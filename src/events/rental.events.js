
// const { eventEmitter, EVENTS } = require('./index');
const eventEmitter = require('./eventEmitter');
const EVENTS = require('./events.constants');
const logger = require('../config/logger');
// Lazy require breaks the socket <-> events circular dependency (see user.events).
const socketApi = () => require('../socket');
const emitToUser = (...args) => socketApi().emitToUser(...args);
const emitToVendor = (...args) => socketApi().emitToVendor(...args);
const emitToAdmins = (...args) => socketApi().emitToAdmins(...args);
const { createNotification } = require('../services/notification.service');
const { processJob } = require('../jobs');
const { Rental, User } = require('../models');

// Shared helpers ----------------------------------------------------------

// Format a date for emails ("26 Aug 2026"). Returns a dash when missing so
// templates never render "undefined".
const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const fullName = (u) =>
  u?.profile ? `${u.profile.firstName || ''} ${u.profile.lastName || ''}`.trim() : (u?.name || 'Customer');

const money = (n) => (n === null || n === undefined || isNaN(n) ? '0' : Number(n).toLocaleString('en-IN'));

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// Fetch all admin/super-admin user ids for admin notifications.
const getAdminUserIds = async () => {
  try {
    const admins = await User.find({ role: { $in: ['admin', 'super-admin'] } })
      .select('_id')
      .lean();
    return admins.map((a) => a._id);
  } catch (err) {
    logger.error('Error fetching admin ids:', err);
    return [];
  }
};

// Send a notification to every admin, isolated so a single failure cannot
// break the rest of the flow.
const notifyAdmins = async (payload) => {
  const adminIds = await getAdminUserIds();
  for (const adminId of adminIds) {
    try {
      await createNotification({ userId: adminId, ...payload });
    } catch (err) {
      logger.error(`Error notifying admin ${adminId}:`, err.message);
    }
  }
};

// Load the full rental document (user, product, vendor) for notification/email
// content. Returns null when the rental no longer exists (edge case).
const loadRentalForEvent = async (rentalId) => {
  try {
    return await Rental.findById(rentalId)
      .populate('user', 'email profile.firstName profile.lastName')
      .populate('product', 'basicInfo.name pricing.monthlyRent')
      .populate({
        path: 'vendor',
        select: 'user business.name',
        populate: { path: 'user', select: 'email profile.firstName profile.lastName' },
      })
      .lean();
  } catch (err) {
    logger.error(`Error loading rental ${rentalId}:`, err.message);
    return null;
  }
};

// Rental created
eventEmitter.on(EVENTS.RENTAL.CREATED, async (data) => {
  try {
    logger.info(`Rental created: ${data.rentalNumber}`);

    const rental = await loadRentalForEvent(data.rentalId || data._id);
    if (!rental) {
      logger.warn(`Rental created event: rental not found, skipping notifications`);
      return;
    }

    const user = rental.user;
    const vendor = rental.vendor;
    const product = rental.product;
    const rd = rental.rentalDetails || {};
    const addr = rental.addressDetails || {};
    const customerName = fullName(user);
    const rentalNumber = rental.rentalNumber;

    const notificationData = {
      rentalId: rental._id,
      rentalNumber,
      productName: product?.basicInfo?.name,
      startDate: formatDate(rd.startDate),
      endDate: formatDate(rd.endDate),
      monthlyRent: money(rd.monthlyRent),
      securityDeposit: money(rd.securityDeposit),
      totalAmount: money(rd.totalAmount),
      deliveryAddress: {
        addressLine1: addr.addressLine1 || '',
        addressLine2: addr.addressLine2 || '',
        city: addr.city || '',
        state: addr.state || '',
        pincode: addr.pincode || '',
      },
    };

    // 1) Customer — in-app + email
    await createNotification({
      userId: rental.user,
      type: 'in_app',
      title: 'Rental Request Received',
      content: `Your rental request #${rentalNumber} has been received and is pending vendor confirmation.`,
      data: { rentalId: rental._id, rentalNumber },
    });

    if (user?.email) {
      await processJob('email:send', {
        to: user.email,
        subject: `Order Received #${rentalNumber} - RentEase`,
        template: 'rental-created',
        data: {
          name: customerName,
          customerName,
          vendorName: vendor?.business?.name || 'Vendor',
          ...notificationData,
          trackUrl: `${CLIENT_URL}/dashboard/rentals/${rental._id}`,
        },
      });
    }

    // 2) Vendor — in-app + email with verify CTA
    const vendorUser = vendor?.user;
    await createNotification({
      userId: vendorUser?._id || data.vendorId,
      type: 'in_app',
      title: 'New Rental Order',
      content: `You have a new rental order #${rentalNumber} from ${customerName}. Please verify it.`,
      data: { rentalId: rental._id, rentalNumber },
    });

    if (vendorUser?.email) {
      await processJob('email:send', {
        to: vendorUser.email,
        subject: `New Rental Order #${rentalNumber} - Action Required`,
        template: 'rental-created',
        data: {
          vendorName: vendor?.business?.name || 'Vendor',
          customerName,
          ...notificationData,
          verifyUrl: `${CLIENT_URL}/vendor/orders`,
        },
      });
    }

    // 3) Admin — in-app alert
    await notifyAdmins({
      type: 'in_app',
      title: 'New Rental Order',
      content: `New rental order #${rentalNumber} received (₹${notificationData.totalAmount}).`,
      data: { rentalId: rental._id, rentalNumber },
    });

    emitToUser(rental.user, 'rental:created', data);
    emitToVendor(data.vendorId, 'rental:created', data);
    emitToAdmins('rental:created', { rentalId: rental._id, rentalNumber });

    // Schedule confirmation reminder
    await processJob('rental:confirmation-reminder', {
      rentalId: rental._id,
      vendorId: data.vendorId,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  } catch (error) {
    logger.error('Error handling rental created event:', error);
  }
});

// Rental confirmed
eventEmitter.on(EVENTS.RENTAL.CONFIRMED, async (data) => {
  try {
    logger.info(`Rental confirmed: ${data.rentalNumber}`);

    const rental = await loadRentalForEvent(data.rentalId || data._id);
    if (!rental) {
      logger.warn(`Rental confirmed event: rental not found, skipping notifications`);
      return;
    }

    const user = rental.user;
    const vendor = rental.vendor;
    const product = rental.product;
    const rd = rental.rentalDetails || {};
    const addr = rental.addressDetails || {};
    const rentalNumber = rental.rentalNumber;
    const customerName = fullName(user);

    const notificationData = {
      rentalId: rental._id,
      rentalNumber,
      productName: product?.basicInfo?.name,
      startDate: formatDate(rd.startDate),
      endDate: formatDate(rd.endDate),
      monthlyRent: money(rd.monthlyRent),
      securityDeposit: money(rd.securityDeposit),
      totalAmount: money(rd.totalAmount),
      deliveryAddress: {
        addressLine1: addr.addressLine1 || '',
        addressLine2: addr.addressLine2 || '',
        city: addr.city || '',
        state: addr.state || '',
        pincode: addr.pincode || '',
      },
    };

    // 1) Customer — in-app + email with full details
    await createNotification({
      userId: rental.user,
      type: 'in_app',
      title: 'Rental Confirmed!',
      content: `Your rental #${rentalNumber} has been confirmed by the vendor. We'll notify you when it's out for delivery.`,
      data: { rentalId: rental._id, rentalNumber },
    });

    if (user?.email) {
      await processJob('email:send', {
        to: user.email,
        subject: `Rental Confirmed #${rentalNumber} - RentEase`,
        template: 'rental-confirmed',
        data: {
          name: customerName,
          ...notificationData,
          trackUrl: `${CLIENT_URL}/dashboard/rentals/${rental._id}`,
        },
      });
    }

    // 2) Vendor — in-app confirmation
    const vendorUser = vendor?.user;
    await createNotification({
      userId: vendorUser?._id || data.vendorId,
      type: 'in_app',
      title: 'Order Confirmed',
      content: `Order #${rentalNumber} has been confirmed. Delivery will be scheduled soon.`,
      data: { rentalId: rental._id, rentalNumber },
    });

    // 3) Admin — in-app alert
    await notifyAdmins({
      type: 'in_app',
      title: 'Rental Order Confirmed',
      content: `Rental order #${rentalNumber} confirmed (₹${notificationData.totalAmount}).`,
      data: { rentalId: rental._id, rentalNumber },
    });

    emitToUser(rental.user, 'rental:confirmed', data);
    emitToVendor(data.vendorId, 'rental:confirmed', data);
    emitToAdmins('rental:confirmed', { rentalId: rental._id, rentalNumber });

    // Schedule delivery preparation
    await processJob('delivery:prepare', {
      rentalId: rental._id,
      scheduledAt: new Date(data.rentalDetails?.startDate || rental.rentalDetails?.startDate).setHours(-24), // 24 hours before delivery
    });
  } catch (error) {
    logger.error('Error handling rental confirmed event:', error);
  }
});

// Delivery scheduled
eventEmitter.on(EVENTS.RENTAL.DELIVERY_SCHEDULED, async (data) => {
  try {
    logger.info(`Delivery scheduled for rental: ${data.rentalNumber}`);

    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Delivery Scheduled',
      content: `Your delivery is scheduled for ${new Date(data.deliveryDate).toLocaleString()}`,
      data: { 
        rentalId: data._id, 
        deliveryDate: data.deliveryDate,
        deliverySlot: data.deliverySlot,
      },
    });

    emitToUser(data.userId, 'rental:delivery-scheduled', data);

    // Schedule delivery reminder
    await processJob('notification:delivery-reminder', {
      userId: data.userId,
      rentalId: data._id,
      deliveryDate: data.deliveryDate,
      scheduledAt: new Date(data.deliveryDate).setHours(-2), // 2 hours before delivery
    });
  } catch (error) {
    logger.error('Error handling delivery scheduled event:', error);
  }
});

// Rental delivered
eventEmitter.on(EVENTS.RENTAL.DELIVERED, async (data) => {
  try {
    logger.info(`Rental delivered: ${data.rentalNumber}`);

    const rental = await loadRentalForEvent(data.rentalId || data._id);
    const customerName = rental ? fullName(rental.user) : 'Customer';
    const vendorUser = rental?.vendor?.user || {};
    const productName = rental?.product?.basicInfo?.name || 'Your item';

    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Product Delivered!',
      content: `Your rented product has been delivered. Enjoy your rental!`,
      data: { rentalId: data._id, rentalNumber: data.rentalNumber },
    });

    // Customer email
    if (rental?.user?.email) {
      await processJob('email:send', {
        to: rental.user.email,
        subject: `Your Order Has Been Delivered #${data.rentalNumber} - RentEase`,
        template: 'delivery-delivered',
        data: {
          name: customerName,
          deliveryNumber: data.deliveryNumber || '',
          rentalNumber: data.rentalNumber,
          productName,
          receivedBy: data.receivedBy,
          address: {
            addressLine1: rental?.address?.addressLine1 || rental?.deliveryAddress?.addressLine1 || '',
            addressLine2: rental?.address?.addressLine2 || rental?.deliveryAddress?.addressLine2 || '',
            city: rental?.address?.city || rental?.deliveryAddress?.city || '',
            state: rental?.address?.state || rental?.deliveryAddress?.state || '',
            pincode: rental?.address?.pincode || rental?.deliveryAddress?.pincode || '',
          },
          trackUrl: `${CLIENT_URL}/dashboard/rentals/${data.rentalId || data._id}`,
        },
      });
    }

    // Vendor in-app + email
    if (vendorUser?._id) {
      await createNotification({
        userId: vendorUser._id,
        type: 'in_app',
        title: 'Delivery Completed ✅',
        content: `Delivery for order #${data.rentalNumber} has been completed.`,
        data: { rentalId: data._id, rentalNumber: data.rentalNumber },
      });
      if (vendorUser.email) {
        await processJob('email:send', {
          to: vendorUser.email,
          subject: `Delivery Completed #${data.rentalNumber} - RentEase`,
          template: 'delivery-delivered',
          data: {
            name: fullName(vendorUser) || 'Vendor',
            isVendor: true,
            deliveryNumber: data.deliveryNumber || '',
            rentalNumber: data.rentalNumber,
            productName,
            receivedBy: data.receivedBy,
            address: {
              addressLine1: rental?.address?.addressLine1 || rental?.deliveryAddress?.addressLine1 || '',
              addressLine2: rental?.address?.addressLine2 || rental?.deliveryAddress?.addressLine2 || '',
              city: rental?.address?.city || rental?.deliveryAddress?.city || '',
              state: rental?.address?.state || rental?.deliveryAddress?.state || '',
              pincode: rental?.address?.pincode || rental?.deliveryAddress?.pincode || '',
            },
            trackUrl: `${CLIENT_URL}/vendor/orders`,
          },
        });
      }
    }

    emitToUser(data.userId, 'rental:delivered', data);
    emitToVendor(data.vendorId, 'rental:delivered', data);

    // Schedule review reminder
    await processJob('rental:review-reminder', {
      userId: data.userId,
      rentalId: data._id,
      scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days after delivery
    });

    // Schedule return reminder
    const returnDate = new Date(data.rentalDetails?.endDate || rental?.rentalDetails?.endDate || Date.now());
    returnDate.setDate(returnDate.getDate() - 3); // 3 days before return
    
    await processJob('rental:return-reminder', {
      userId: data.userId,
      rentalId: data._id,
      scheduledAt: returnDate,
    });
  } catch (error) {
    logger.error('Error handling rental delivered event:', error);
  }
});

// Rental active
eventEmitter.on(EVENTS.RENTAL.ACTIVE, async (data) => {
  try {
    logger.info(`Rental active: ${data.rentalNumber}`);

    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Rental Period Started',
      content: 'Your rental period has started. Hope you\'re enjoying the product!',
      data: { rentalId: data._id },
    });

    // Schedule payment reminders
    const nextPaymentDate = new Date(data.rentalDetails.startDate);
    nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
    
    await processJob('payment:reminder', {
      userId: data.userId,
      rentalId: data._id,
      amount: data.rentalDetails.monthlyRent,
      scheduledAt: new Date(nextPaymentDate).setDate(-3), // 3 days before payment due
    });
  } catch (error) {
    logger.error('Error handling rental active event:', error);
  }
});

// Extension requested
eventEmitter.on(EVENTS.RENTAL.EXTENSION_REQUESTED, async (data) => {
  try {
    logger.info(`Extension requested for rental: ${data.rentalNumber}`);

    await createNotification({
      userId: data.vendorId,
      type: 'in_app',
      title: 'Extension Request',
      content: `User requested to extend rental #${data.rentalNumber} by ${data.extensionMonths} months.`,
      data: { 
        rentalId: data._id, 
        extensionMonths: data.extensionMonths,
        additionalAmount: data.additionalAmount,
      },
    });

    emitToVendor(data.vendorId, 'rental:extension-requested', data);
    emitToUser(data.userId, 'rental:extension-requested', data);
  } catch (error) {
    logger.error('Error handling extension requested event:', error);
  }
});

// Extension approved
eventEmitter.on(EVENTS.RENTAL.EXTENSION_APPROVED, async (data) => {
  try {
    logger.info(`Extension approved for rental: ${data.rentalNumber}`);

    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Extension Approved',
      content: `Your rental extension request has been approved. New end date: ${new Date(data.newEndDate).toLocaleDateString()}`,
      data: { 
        rentalId: data._id, 
        newEndDate: data.newEndDate,
        additionalAmount: data.additionalAmount,
      },
    });

    // Request payment for extension
    await processJob('payment:create', {
      userId: data.userId,
      rentalId: data._id,
      amount: data.additionalAmount,
      type: 'extension',
    });

    emitToUser(data.userId, 'rental:extension-approved', data);
  } catch (error) {
    logger.error('Error handling extension approved event:', error);
  }
});

// Rental completed
eventEmitter.on(EVENTS.RENTAL.COMPLETED, async (data) => {
  try {
    logger.info(`Rental completed: ${data.rentalNumber}`);

    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Rental Completed',
      content: 'Your rental has been completed. Thank you for choosing RentEase!',
      data: { rentalId: data._id },
    });

    // Request review
    await processJob('rental:request-review', {
      userId: data.userId,
      rentalId: data._id,
      productId: data.productId,
    });

    // Process security deposit refund if applicable
    if (data.securityDeposit > 0 && !data.damages) {
      await processJob('payment:refund-deposit', {
        userId: data.userId,
        rentalId: data._id,
        amount: data.securityDeposit,
      });
    }

    emitToUser(data.userId, 'rental:completed', data);
    emitToVendor(data.vendorId, 'rental:completed', data);
  } catch (error) {
    logger.error('Error handling rental completed event:', error);
  }
});

// Rental cancelled
eventEmitter.on(EVENTS.RENTAL.CANCELLED, async (data) => {
  try {
    logger.info(`Rental cancelled: ${data.rentalNumber} - Reason: ${data.reason}`);

    const rental = await loadRentalForEvent(data.rentalId || data._id);
    const customerName = rental ? fullName(rental.user) : 'Customer';
    const vendorUser = rental?.vendor?.user || {};
    const productName = rental?.product?.basicInfo?.name || 'Your item';
    const address = rental?.address || {};
    const addr = address?.addressLine1
      ? address
      : (rental?.deliveryAddress || {});

    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Rental Cancelled',
      content: `Your rental #${data.rentalNumber} has been cancelled.${data.refundAmount ? ` Refund of ₹${money(data.refundAmount)} will be processed.` : ''}`,
      data: { 
        rentalId: data._id, 
        reason: data.reason,
        refundAmount: data.refundAmount,
      },
    });

    // Customer email
    if (rental?.user?.email) {
      await processJob('email:send', {
        to: rental.user.email,
        subject: `Order Cancelled #${data.rentalNumber} - RentEase`,
        template: 'delivery-cancelled',
        data: {
          name: customerName,
          deliveryNumber: '',
          rentalNumber: data.rentalNumber,
          productName,
          reason: data.reason,
          refundAmount: data.refundAmount,
          address: {
            addressLine1: addr.addressLine1 || '',
            addressLine2: addr.addressLine2 || '',
            city: addr.city || '',
            state: addr.state || '',
            pincode: addr.pincode || '',
          },
          trackUrl: `${CLIENT_URL}/browse`,
        },
      });
    }

    // Vendor in-app + email
    if (vendorUser?._id) {
      await createNotification({
        userId: vendorUser._id,
        type: 'in_app',
        title: 'Order Cancelled',
        content: `Order #${data.rentalNumber} has been cancelled by ${data.cancelledBy === data.userId ? 'the customer' : 'the vendor'}.`,
        data: { rentalId: data._id, reason: data.reason, refundAmount: data.refundAmount },
      });
      if (vendorUser.email) {
        await processJob('email:send', {
          to: vendorUser.email,
          subject: `Order Cancelled #${data.rentalNumber} - RentEase`,
          template: 'delivery-cancelled',
          data: {
            name: fullName(vendorUser) || 'Vendor',
            isVendor: true,
            deliveryNumber: '',
            rentalNumber: data.rentalNumber,
            productName,
            reason: data.reason,
            refundAmount: data.refundAmount,
            address: {
              addressLine1: addr.addressLine1 || '',
              addressLine2: addr.addressLine2 || '',
              city: addr.city || '',
              state: addr.state || '',
              pincode: addr.pincode || '',
            },
            trackUrl: `${CLIENT_URL}/vendor/orders`,
          },
        });
      }
    }

    // Process refund if applicable
    if (data.refundAmount > 0) {
      await processJob('payment:refund', {
        userId: data.userId,
        rentalId: data._id,
        amount: data.refundAmount,
        reason: data.reason,
      });
    }

    emitToUser(data.userId, 'rental:cancelled', data);
    emitToVendor(data.vendorId, 'rental:cancelled', data);
    emitToAdmins('rental:cancelled', data);
  } catch (error) {
    logger.error('Error handling rental cancelled event:', error);
  }
});

// Rental overdue
eventEmitter.on(EVENTS.RENTAL.OVERDUE, async (data) => {
  try {
    logger.warn(`Rental overdue: ${data.rentalNumber} - Days: ${data.daysOverdue}`);

    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: '⚠️ Rental Overdue',
      content: `Your rental #${data.rentalNumber} is overdue by ${data.daysOverdue} days. Please return the product or request extension.`,
      data: { 
        rentalId: data._id, 
        daysOverdue: data.daysOverdue,
        lateFee: data.lateFee,
      },
    });

    // Send SMS reminder
    await processJob('sms:send', {
      to: data.user?.phone,
      template: 'rental-overdue',
      data: {
        rentalNumber: data.rentalNumber,
        daysOverdue: data.daysOverdue,
        lateFee: data.lateFee,
      },
    });

    emitToUser(data.userId, 'rental:overdue', data);
    emitToVendor(data.vendorId, 'rental:overdue', data);
    emitToAdmins('rental:overdue', data);
  } catch (error) {
    logger.error('Error handling rental overdue event:', error);
  }
});

// Rental disputed
eventEmitter.on(EVENTS.RENTAL.DISPUTED, async (data) => {
  try {
    logger.warn(`Rental disputed: ${data.rentalNumber} - Reason: ${data.reason}`);

    // Notify all parties
    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Dispute Filed',
      content: `Your dispute has been filed. Our support team will contact you soon.`,
      data: { rentalId: data._id, reason: data.reason },
    });

    await createNotification({
      userId: data.vendorId,
      type: 'in_app',
      title: 'Dispute Filed Against Your Rental',
      content: `A dispute has been filed for rental #${data.rentalNumber}. Reason: ${data.reason}`,
      data: { rentalId: data._id, reason: data.reason },
    });

    // Create support ticket
    await processJob('support:create-ticket', {
      type: 'rental_dispute',
      priority: 'high',
      userId: data.userId,
      vendorId: data.vendorId,
      rentalId: data._id,
      reason: data.reason,
      description: data.description,
    });

    emitToAdmins('rental:disputed', data);
  } catch (error) {
    logger.error('Error handling rental disputed event:', error);
  }
});