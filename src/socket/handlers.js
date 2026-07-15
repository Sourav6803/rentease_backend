const logger = require('../config/logger');
const { DeliveryPerson } = require('../models');
const DeliveryPersonnelService = require('../services/delivery-personnel.service');
const { emitToUser, emitToVendor, emitToRoom, emitToAdmins } = require('./emitter');


// Socket event handlers
const socketHandlers = (io, socket, context) => {
  const { connectedUsers, userSockets, vendorRooms, adminRooms } = context;
  const userId = socket.userId;
  const userRole = socket.userRole;
  const userType = socket.userType;

  // ==================== User Status Handlers ====================
  
  socket.on('user:ping', (data, callback) => {
    // Update last seen
    const userData = connectedUsers.get(userId);
    if (userData) {
      userData.lastPing = new Date();
    }
    
    if (callback) callback({ status: 'ok', timestamp: new Date() });
  });

  socket.on('user:typing', (data) => {
    const { conversationId, isTyping } = data;
    
    // Emit to conversation participants
    socket.to(`conversation:${conversationId}`).emit('user:typing', {
      userId,
      conversationId,
      isTyping,
      timestamp: new Date(),
    });
  });

  // ==================== Chat/Message Handlers ====================
  
  socket.on('message:send', async (data, callback) => {
    try {
      const { to, message, type = 'text', conversationId, attachments = [] } = data;
      
      // Create message object
      const messageData = {
        id: generateMessageId(),
        from: userId,
        fromName: socket.user?.profile?.firstName + ' ' + socket.user?.profile?.lastName,
        to,
        message,
        type,
        attachments,
        conversationId: conversationId || generateConversationId(userId, to),
        timestamp: new Date(),
        read: false,
      };

      // Save to database (you'll need to implement this)
      // await saveMessage(messageData);

      // Emit to recipient if online
      const delivered = emitToUser(to, 'message:receive', messageData);

      // Emit back to sender with delivery status
      socket.emit('message:sent', {
        ...messageData,
        delivered,
        timestamp: new Date(),
      });

      if (callback) callback({ success: true, messageId: messageData.id, delivered });
    } catch (error) {
      logger.error('Error sending message:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  socket.on('message:read', async (data) => {
    const { messageId, conversationId } = data;
    
    // Update message read status in database
    // await markMessageAsRead(messageId, userId);
    
    // Notify sender
    socket.to(`conversation:${conversationId}`).emit('message:read', {
      messageId,
      conversationId,
      readBy: userId,
      readAt: new Date(),
    });
  });

  socket.on('conversation:join', (conversationId) => {
    socket.join(`conversation:${conversationId}`);
    socket.to(`conversation:${conversationId}`).emit('conversation:joined', {
      userId,
      conversationId,
      timestamp: new Date(),
    });
  });

  socket.on('conversation:leave', (conversationId) => {
    socket.leave(`conversation:${conversationId}`);
    socket.to(`conversation:${conversationId}`).emit('conversation:left', {
      userId,
      conversationId,
      timestamp: new Date(),
    });
  });

  // ==================== Notification Handlers ====================
  
  socket.on('notification:markRead', (notificationId) => {
    // Mark notification as read in database
    // await markNotificationAsRead(notificationId, userId);
    
    socket.emit('notification:marked', { notificationId, read: true });
  });

  socket.on('notification:markAllRead', () => {
    // Mark all notifications as read
    // await markAllNotificationsAsRead(userId);
    
    socket.emit('notification:allMarked', { read: true });
  });

  // ==================== Rental/Order Handlers ====================
  
  socket.on('rental:track', (rentalId) => {
    socket.join(`rental:${rentalId}`);
  });

  socket.on('rental:untrack', (rentalId) => {
    socket.leave(`rental:${rentalId}`);
  });

  socket.on('rental:statusUpdate', async (data) => {
    const { rentalId, status, notes } = data;
    
    // Update rental status in database
    // await updateRentalStatus(rentalId, status, userId);
    
    // Get rental details to know who to notify
    const rental = await getRentalDetails(rentalId);
    
    if (rental) {
      // Notify user
      emitToUser(rental.userId, 'rental:updated', {
        rentalId,
        status,
        notes,
        updatedBy: userId,
        timestamp: new Date(),
      });
      
      // Notify vendor
      if (rental.vendorId) {
        emitToVendor(rental.vendorId, 'rental:updated', {
          rentalId,
          status,
          notes,
          updatedBy: userId,
          timestamp: new Date(),
        });
      }
      
      // Notify admins for certain statuses
      if (['cancelled', 'disputed'].includes(status)) {
        emitToAdmins('rental:alert', {
          rentalId,
          status,
          notes,
          userId: rental.userId,
          vendorId: rental.vendorId,
          timestamp: new Date(),
        });
      }
    }
  });

  socket.on('rental:deliveryUpdate', (data) => {
    const { rentalId, deliveryStatus, location } = data;
    
    // Broadcast to rental room
    io.to(`rental:${rentalId}`).emit('rental:delivery', {
      rentalId,
      deliveryStatus,
      location,
      timestamp: new Date(),
    });
  });

  // ==================== Vendor Handlers ====================
  
  if (userType === 'vendor') {
    socket.on('vendor:status', (status) => {
      // Update vendor status
      socket.data.vendorStatus = status;
      
      // Notify admins
      emitToAdmins('vendor:status', {
        vendorId: socket.vendorData?._id,
        userId,
        status,
        timestamp: new Date(),
      });
    });

    socket.on('vendor:inventoryUpdate', (data) => {
      const { productId, quantity, status } = data;
      
      // Notify admins about inventory changes
      emitToAdmins('vendor:inventory', {
        vendorId: socket.vendorData?._id,
        productId,
        quantity,
        status,
        timestamp: new Date(),
      });
    });
  }

  // ==================== Admin Handlers ====================
  
  if (userRole === 'admin' || userRole === 'super-admin') {
    socket.on('admin:subscribe', (topic) => {
      socket.join(`admin:${topic}`);
      logger.info(`Admin ${userId} subscribed to ${topic}`);
    });

    socket.on('admin:unsubscribe', (topic) => {
      socket.leave(`admin:${topic}`);
    });

    socket.on('admin:alert', (data) => {
      // Broadcast alert to all admins
      emitToAdmins('admin:alert', {
        ...data,
        from: userId,
        timestamp: new Date(),
      });
    });
  }

  // ==================== Live Tracking Handlers ====================
  
  socket.on('tracking:start', (data) => {
    const { rentalId, type } = data;
    socket.join(`tracking:${rentalId}`);
    
    // Notify relevant parties
    socket.to(`rental:${rentalId}`).emit('tracking:started', {
      rentalId,
      type,
      userId,
      timestamp: new Date(),
    });
  });

  socket.on('tracking:stop', (rentalId) => {
    socket.leave(`tracking:${rentalId}`);
    socket.to(`rental:${rentalId}`).emit('tracking:stopped', {
      rentalId,
      userId,
      timestamp: new Date(),
    });
  });

  socket.on('tracking:location', (data) => {
    const { rentalId, latitude, longitude, accuracy } = data;
    
    // Broadcast location to all tracking the rental
    socket.to(`tracking:${rentalId}`).emit('tracking:location', {
      rentalId,
      latitude,
      longitude,
      accuracy,
      userId,
      timestamp: new Date(),
    });
  });

  // ==================== Delivery Tracking Handlers ====================

  socket.on('delivery:partner:subscribe', async (callback) => {
    try {
      const person = await DeliveryPerson.findOne({ user: userId }).select('_id').lean();
      if (!person) {
        if (callback) callback({ success: false, error: 'Delivery partner profile not found' });
        return;
      }

      socket.deliveryPersonId = person._id.toString();
      socket.join(`delivery:partner:${person._id}`);

      if (callback) {
        callback({ success: true, personId: person._id.toString() });
      }
    } catch (error) {
      logger.error('delivery:partner:subscribe error:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  socket.on('delivery:track', ({ deliveryId, trackingNumber }) => {
    if (deliveryId) {
      socket.join(`delivery:${deliveryId}`);
    }
    if (trackingNumber) {
      socket.join(`delivery:track:${trackingNumber}`);
    }
  });

  socket.on('delivery:untrack', ({ deliveryId, trackingNumber }) => {
    if (deliveryId) {
      socket.leave(`delivery:${deliveryId}`);
    }
    if (trackingNumber) {
      socket.leave(`delivery:track:${trackingNumber}`);
    }
  });

  socket.on('delivery:location:update', async (data, callback) => {
    try {
      const deliveryRoles = ['delivery', 'delivery_partner', 'delivery_boy', 'delivery_team'];
      if (!deliveryRoles.includes(userRole)) {
        if (callback) callback({ success: false, error: 'Unauthorized' });
        return;
      }

      const { lat, lng, speed, battery, accuracy } = data || {};
      if (lat == null || lng == null) {
        if (callback) callback({ success: false, error: 'lat and lng are required' });
        return;
      }

      const person = await DeliveryPerson.findOne({ user: userId }).select('_id').lean();
      if (!person) {
        if (callback) callback({ success: false, error: 'Delivery partner profile not found' });
        return;
      }

      const updated = await DeliveryPersonnelService.updateLocationWithHistory(person._id, {
        lat,
        lng,
        speed,
        battery,
        accuracy,
      });

      if (callback) {
        callback({
          success: true,
          currentLocation: updated.availability.currentLocation,
        });
      }
    } catch (error) {
      logger.error('delivery:location:update socket error:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // ==================== Room Management ====================
  
  socket.on('room:join', (room) => {
    socket.join(room);
    socket.to(room).emit('room:joined', {
      userId,
      room,
      timestamp: new Date(),
    });
  });

  socket.on('room:leave', (room) => {
    socket.leave(room);
    socket.to(room).emit('room:left', {
      userId,
      room,
      timestamp: new Date(),
    });
  });

  // ==================== Custom Events ====================
  
  socket.on('event:emit', (data) => {
    const { event, to, payload } = data;
    
    switch (to.type) {
      case 'user':
        emitToUser(to.id, event, payload);
        break;
      case 'vendor':
        emitToVendor(to.id, event, payload);
        break;
      case 'role':
        io.to(`role:${to.role}`).emit(event, payload);
        break;
      case 'room':
        io.to(to.room).emit(event, payload);
        break;
      default:
        socket.broadcast.emit(event, payload);
    }
  });

  // ==================== Error Handling ====================
  
  socket.on('error', (error) => {
    logger.error(`Socket error in handler for user ${userId}:`, error);
    socket.emit('error', {
      message: 'An error occurred',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  });
};

// Helper functions
const generateMessageId = () => {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const generateConversationId = (user1, user2) => {
  return [user1, user2].sort().join('_');
};

const getRentalDetails = async (rentalId) => {
  // Implement this to fetch rental details from database
  return null;
};

module.exports = socketHandlers;