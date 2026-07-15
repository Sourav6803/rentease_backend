const eventEmitter = require('./eventEmitter');
const logger = require('../config/logger');
const { emitToUser, emitToVendor, emitToAdmins } = require('../socket');
const { processJob } = require('../jobs');

// Import all event handlers
require('./user.events');
require('./rental.events');
require('./payment.events');
require('./notification.events');
require('./vendor.events');
require('./product.events');
require('./delivery.events');

// Base event definitions
const EVENTS = {
  // User events
  USER: {
    REGISTERED: 'user:registered',
    LOGGED_IN: 'user:loggedin',
    LOGGED_OUT: 'user:loggedout',
    PROFILE_UPDATED: 'user:profile.updated',
    PASSWORD_CHANGED: 'user:password.changed',
    EMAIL_VERIFIED: 'user:email.verified',
    PHONE_VERIFIED: 'user:phone.verified',
    KYC_SUBMITTED: 'user:kyc.submitted',
    KYC_APPROVED: 'user:kyc.approved',
    KYC_REJECTED: 'user:kyc.rejected',
    ACCOUNT_BLOCKED: 'user:account.blocked',
    ACCOUNT_UNBLOCKED: 'user:account.unblocked',
  },

  // Rental events
  RENTAL: {
    CREATED: 'rental:created',
    CONFIRMED: 'rental:confirmed',
    DELIVERY_SCHEDULED: 'rental:delivery.scheduled',
    DELIVERED: 'rental:delivered',
    ACTIVE: 'rental:active',
    EXTENSION_REQUESTED: 'rental:extension.requested',
    EXTENSION_APPROVED: 'rental:extension.approved',
    EXTENSION_REJECTED: 'rental:extension.rejected',
    RETURN_SCHEDULED: 'rental:return.scheduled',
    RETURNED: 'rental:returned',
    COMPLETED: 'rental:completed',
    CANCELLED: 'rental:cancelled',
    OVERDUE: 'rental:overdue',
    DISPUTED: 'rental:disputed',
  },

  // Payment events
  PAYMENT: {
    INITIATED: 'payment:initiated',
    PROCESSING: 'payment:processing',
    SUCCESS: 'payment:success',
    FAILED: 'payment:failed',
    REFUNDED: 'payment:refunded',
    DISPUTED: 'payment:disputed',
  },

  // Notification events
  NOTIFICATION: {
    SENT: 'notification:sent',
    DELIVERED: 'notification:delivered',
    READ: 'notification:read',
    FAILED: 'notification:failed',
  },

  // Vendor events
  VENDOR: {
    REGISTERED: 'vendor:registered',
    APPROVED: 'vendor:approved',
    REJECTED: 'vendor:rejected',
    SUSPENDED: 'vendor:suspended',
    PRODUCT_ADDED: 'vendor:product.added',
    PRODUCT_UPDATED: 'vendor:product.updated',
    PRODUCT_DELETED: 'vendor:product.deleted',
    INVENTORY_LOW: 'vendor:inventory.low',
    PAYOUT_PROCESSED: 'vendor:payout.processed',
  },

  // Product events
  PRODUCT: {
    CREATED: 'product:created',
    UPDATED: 'product:updated',
    DELETED: 'product:deleted',
    APPROVED: 'product:approved',
    REJECTED: 'product:rejected',
    FEATURED: 'product:featured',
    OUT_OF_STOCK: 'product:outofstock',
    BACK_IN_STOCK: 'product:backinstock',
  },

  // Maintenance events
  MAINTENANCE: {
    REQUESTED: 'maintenance:requested',
    ASSIGNED: 'maintenance:assigned',
    SCHEDULED: 'maintenance:scheduled',
    IN_PROGRESS: 'maintenance:inprogress',
    COMPLETED: 'maintenance:completed',
    CANCELLED: 'maintenance:cancelled',
    ESCALATED: 'maintenance:escalated',
  },

  // Review events
  REVIEW: {
    SUBMITTED: 'review:submitted',
    APPROVED: 'review:approved',
    REJECTED: 'review:rejected',
    RESPONDED: 'review:responded',
    REPORTED: 'review:reported',
  },

  // Delivery events
  DELIVERY: {
    SCHEDULED: 'delivery:scheduled',
    ASSIGNED: 'delivery:assigned',
    OUT_FOR_DELIVERY: 'delivery:outfordelivery',
    IN_TRANSIT: 'delivery:intransit',
    REACHED: 'delivery:reached',
    DELIVERED: 'delivery:delivered',
    PICKED_UP: 'delivery:pickedup',
    FAILED: 'delivery:failed',
    RESCHEDULED: 'delivery:rescheduled',
  },

  // System events
  SYSTEM: {
    ERROR: 'system:error',
    WARNING: 'system:warning',
    INFO: 'system:info',
    MAINTENANCE: 'system:maintenance',
    BACKUP: 'system:backup',
    RESTORE: 'system:restore',
  },

  // Support ticket events
  SUPPORT: {
    TICKET_CREATED: 'support:ticket.created',
    TICKET_ASSIGNED: 'support:ticket.assigned',
    TICKET_UPDATED: 'support:ticket.updated',
    TICKET_MESSAGE_ADDED: 'support:ticket.message.added',
    TICKET_RESOLVED: 'support:ticket.resolved',
    TICKET_CLOSED: 'support:ticket.closed',
    TICKET_REOPENED: 'support:ticket.reopened',
    TICKET_ESCALATED: 'support:ticket.escalated',
    FEEDBACK_RECEIVED: 'support:ticket.feedback.received',
  },
};

// Global error handler for events
eventEmitter.on('error', (error) => {
  logger.error('Event emitter error:', error);
});

// Helper to emit event with all necessary side effects
const emitEvent = async (event, data, options = {}) => {
  const { 
    socket = true, 
    notification = true, 
    job = true,
    log = true 
  } = options;

  if (log) {
    logger.info(`Event: ${event}`, { event, data });
  }

  // Emit to event emitter listeners
  eventEmitter.emit(event, data);

  // Trigger socket events
  if (socket) {
    await handleSocketEvents(event, data);
  }

  // Trigger notifications
  if (notification) {
    await handleNotificationEvents(event, data);
  }

  // Trigger background jobs
  if (job) {
    await handleJobEvents(event, data);
  }
};

// Socket event handler
const handleSocketEvents = async (event, data) => {
  try {
    switch (event) {
      case EVENTS.RENTAL.CREATED:
        emitToUser(data.userId, 'rental:created', data);
        emitToVendor(data.vendorId, 'rental:created', data);
        break;

      case EVENTS.RENTAL.CONFIRMED:
        emitToUser(data.userId, 'rental:confirmed', data);
        emitToVendor(data.vendorId, 'rental:confirmed', data);
        break;

      case EVENTS.RENTAL.DELIVERED:
        emitToUser(data.userId, 'rental:delivered', data);
        emitToVendor(data.vendorId, 'rental:delivered', data);
        break;

      case EVENTS.PAYMENT.SUCCESS:
        emitToUser(data.userId, 'payment:success', data);
        emitToVendor(data.vendorId, 'payment:success', data);
        break;

      case EVENTS.PAYMENT.FAILED:
        emitToUser(data.userId, 'payment:failed', data);
        break;

      case EVENTS.DELIVERY.OUT_FOR_DELIVERY:
        emitToUser(data.userId, 'delivery:tracking', data);
        break;

      case EVENTS.DELIVERY.IN_TRANSIT:
      case EVENTS.DELIVERY.REACHED:
        if (data.userId) emitToUser(data.userId, 'delivery:tracking', data);
        if (data.deliveryId) {
          const { emitToRoom } = require('../socket/emitter');
          emitToRoom(`delivery:${data.deliveryId}`, 'delivery:status', data);
        }
        break;

      case EVENTS.VENDOR.APPROVED:
        emitToUser(data.userId, 'vendor:approved', data);
        emitToAdmins('vendor:approved', data);
        break;

      case EVENTS.MAINTENANCE.REQUESTED:
        emitToUser(data.userId, 'maintenance:requested', data);
        emitToVendor(data.vendorId, 'maintenance:requested', data);
        emitToAdmins('maintenance:requested', data);
        break;

      case EVENTS.SYSTEM.MAINTENANCE:
        // Broadcast to all connected users
        const io = require('../socket').getIO();
        io.emit('system:maintenance', data);
        break;

      default:
        // For other events, emit to relevant parties based on data
        if (data.userId) emitToUser(data.userId, event, data);
        if (data.vendorId) emitToVendor(data.vendorId, event, data);
        if (data.broadcast) {
          const io = require('../socket').getIO();
          io.emit(event, data);
        }
    }
  } catch (error) {
    logger.error('Socket event handling error:', error);
  }
};

// Notification event handler
const handleNotificationEvents = async (event, data) => {
  try {
    const { createNotification } = require('../services/notification.service');
    
    switch (event) {
      case EVENTS.RENTAL.CREATED:
        await createNotification({
          userId: data.userId,
          type: 'in_app',
          title: 'Rental Request Submitted',
          content: `Your rental request #${data.rentalNumber} has been submitted successfully.`,
          data: { rentalId: data._id, rentalNumber: data.rentalNumber },
        });
        break;

      case EVENTS.RENTAL.CONFIRMED:
        await createNotification({
          userId: data.userId,
          type: 'in_app',
          title: 'Rental Confirmed',
          content: `Your rental #${data.rentalNumber} has been confirmed!`,
          data: { rentalId: data._id, rentalNumber: data.rentalNumber },
        });
        break;

      case EVENTS.PAYMENT.SUCCESS:
        await createNotification({
          userId: data.userId,
          type: 'in_app',
          title: 'Payment Successful',
          content: `Payment of ${data.amount} for rental #${data.rentalNumber} was successful.`,
          data: { paymentId: data._id, amount: data.amount },
        });
        break;

      // Add more notification mappings as needed
    }
  } catch (error) {
    logger.error('Notification event handling error:', error);
  }
};

// Job event handler
const handleJobEvents = async (event, data) => {
  try {
    switch (event) {
      case EVENTS.RENTAL.CREATED:
        // Schedule rental confirmation reminder
        await processJob('rental:confirmation-reminder', {
          rentalId: data._id,
          userId: data.userId,
          scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        });
        break;

      case EVENTS.RENTAL.ACTIVE:
        // Schedule rental completion reminder
        await processJob('rental:completion-reminder', {
          rentalId: data._id,
          userId: data.userId,
          endDate: data.rentalDetails.endDate,
        });
        break;

      case EVENTS.PAYMENT.SUCCESS:
        // Generate invoice
        await processJob('payment:generate-invoice', {
          paymentId: data._id,
          rentalId: data.rental,
        });
        break;

      case EVENTS.VENDOR.INVENTORY_LOW:
        // Alert vendor about low inventory
        await processJob('vendor:inventory-alert', {
          vendorId: data.vendorId,
          productId: data.productId,
          quantity: data.quantity,
        });
        break;
    }
  } catch (error) {
    logger.error('Job event handling error:', error);
  }
};

module.exports = {
  eventEmitter,
  EVENTS,
  emitEvent,
};