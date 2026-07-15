
// const { eventEmitter, EVENTS } = require('./index');
const eventEmitter = require('./eventEmitter');
const EVENTS = require('./events.constants');
const logger = require('../config/logger');
const { emitToUser, emitToVendor, emitToAdmins } = require('../socket');
const { createNotification } = require('../services/notification.service');
const { processJob } = require('../jobs');

// Rental created
eventEmitter.on(EVENTS.RENTAL.CREATED, async (data) => {
  try {
    logger.info(`Rental created: ${data.rentalNumber}`);

    // Notify user
    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Rental Request Received',
      content: `Your rental request #${data.rentalNumber} has been received and is pending confirmation.`,
      data: { rentalId: data._id, rentalNumber: data.rentalNumber },
    });

    // Notify vendor
    await createNotification({
      userId: data.vendorId,
      type: 'in_app',
      title: 'New Rental Request',
      content: `You have a new rental request #${data.rentalNumber}.`,
      data: { rentalId: data._id, rentalNumber: data.rentalNumber },
    });

    emitToUser(data.userId, 'rental:created', data);
    emitToVendor(data.vendorId, 'rental:created', data);

    // Schedule confirmation reminder
    await processJob('rental:confirmation-reminder', {
      rentalId: data._id,
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

    // Notify user
    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Rental Confirmed!',
      content: `Your rental #${data.rentalNumber} has been confirmed. We'll notify you when it's out for delivery.`,
      data: { rentalId: data._id, rentalNumber: data.rentalNumber },
    });

    // Send email confirmation
    await processJob('email:send', {
      to: data.user?.email,
      template: 'rental-confirmed',
      data: {
        name: data.user?.profile?.firstName,
        rentalNumber: data.rentalNumber,
        productName: data.product?.basicInfo?.name,
        startDate: data.rentalDetails.startDate,
        endDate: data.rentalDetails.endDate,
        totalAmount: data.rentalDetails.totalAmount,
      },
    });

    emitToUser(data.userId, 'rental:confirmed', data);
    emitToVendor(data.vendorId, 'rental:confirmed', data);

    // Schedule delivery preparation
    await processJob('delivery:prepare', {
      rentalId: data._id,
      scheduledAt: new Date(data.rentalDetails.startDate).setHours(-24), // 24 hours before delivery
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

    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Product Delivered!',
      content: `Your rented product has been delivered. Enjoy your rental!`,
      data: { rentalId: data._id, rentalNumber: data.rentalNumber },
    });

    emitToUser(data.userId, 'rental:delivered', data);
    emitToVendor(data.vendorId, 'rental:delivered', data);

    // Schedule review reminder
    await processJob('rental:review-reminder', {
      userId: data.userId,
      rentalId: data._id,
      scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days after delivery
    });

    // Schedule return reminder
    const returnDate = new Date(data.rentalDetails.endDate);
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

    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Rental Cancelled',
      content: `Your rental #${data.rentalNumber} has been cancelled.${data.refundAmount ? ` Refund of ₹${data.refundAmount} will be processed.` : ''}`,
      data: { 
        rentalId: data._id, 
        reason: data.reason,
        refundAmount: data.refundAmount,
      },
    });

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