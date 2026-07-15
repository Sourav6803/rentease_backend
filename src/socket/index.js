const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../config/logger');
const { User, Vendor, Admin, DeliveryPerson } = require('../models');
const { getRedisClient } = require('../config/redis');
const socketHandlers = require('./handlers');

const { setIO } = require('./emitter');

let io;

// Connected users tracking
const connectedUsers = new Map(); // userId -> { socketIds: Set, userData: {} }
const userSockets = new Map(); // socketId -> userId
const vendorRooms = new Map(); // vendorId -> Set of socketIds
const adminRooms = new Map(); // adminId -> Set of socketIds

// Initialize Socket.IO
const initializeSocket = (server) => {
  io = socketIO(server, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:3000',
      credentials: true,
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowEIO3: true,
  });

  setIO(io); 
  
  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || 
                    socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication required'));
      }

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Get user from database
      let user = await User.findById(decoded.id)
        .select('-password -security.refreshTokens')
        .lean();

      if (!user) {
        // Check if vendor
        const vendor = await Vendor.findOne({ user: decoded.id })
          .populate('user', '-password')
          .lean();
        if (vendor) {
          user = vendor.user;
          socket.userType = 'vendor';
          socket.vendorData = vendor;
        } else {
          // Check if admin
          const admin = await Admin.findOne({ user: decoded.id })
            .populate('user', '-password')
            .lean();
          if (admin) {
            user = admin.user;
            socket.userType = 'admin';
            socket.adminData = admin;
          }
        }
      } else {
        socket.userType = 'user';
      }

      if (!user) {
        return next(new Error('User not found'));
      }

      // Check if user is active
      if (!user.status?.isActive || user.status?.isBlocked) {
        return next(new Error('Account is not active'));
      }

      // Attach user data to socket
      socket.userId = user._id.toString();
      socket.user = user;
      socket.userRole = user.role;

      // Check token in Redis blacklist
      const redisClient = getRedisClient();
      if (redisClient) {
        const isBlacklisted = await redisClient.get(`blacklist:${token}`);
        if (isBlacklisted) {
          return next(new Error('Token has been revoked'));
        }
      }

      next();
    } catch (error) {
      logger.error('Socket authentication error:', error);
      next(new Error('Authentication failed'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    const userId = socket.userId;
    const userRole = socket.userRole;
    const userType = socket.userType;

    logger.info(`Socket connected: ${socket.id} for user: ${userId} (${userRole})`);

    // Add to connected users
    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, {
        socketIds: new Set(),
        userData: {
          id: userId,
          role: userRole,
          type: userType,
          name: socket.user?.profile?.firstName + ' ' + socket.user?.profile?.lastName,
        },
        connectedAt: new Date(),
      });
    }
    connectedUsers.get(userId).socketIds.add(socket.id);
    userSockets.set(socket.id, userId);

    // Join user-specific room
    socket.join(`user:${userId}`);

    // Join role-specific room
    socket.join(`role:${userRole}`);

    // Join vendor room if vendor
    if (userType === 'vendor') {
      const vendorId = socket.vendorData?._id.toString();
      if (vendorId) {
        socket.join(`vendor:${vendorId}`);
        if (!vendorRooms.has(vendorId)) {
          vendorRooms.set(vendorId, new Set());
        }
        vendorRooms.get(vendorId).add(socket.id);
      }
    }

    // Join admin room if admin
    if (userRole === 'admin' || userRole === 'super-admin') {
      const adminId = socket.adminData?._id.toString() || userId;
      socket.join(`admin:${adminId}`);
      socket.join('admins');
      if (!adminRooms.has(adminId)) {
        adminRooms.set(adminId, new Set());
      }
      adminRooms.get(adminId).add(socket.id);
    }

    // Join delivery partner room for live location updates
    const deliveryRoles = ['delivery', 'delivery_partner', 'delivery_boy', 'delivery_team'];
    if (deliveryRoles.includes(userRole)) {
      DeliveryPerson.findOne({ user: userId })
        .select('_id')
        .lean()
        .then((person) => {
          if (person) {
            socket.deliveryPersonId = person._id.toString();
            socket.join(`delivery:partner:${person._id}`);
          }
        })
        .catch((err) => {
          logger.error('Failed to join delivery partner socket room:', err);
        });
    }

    // Broadcast user online status
    broadcastUserStatus(userId, 'online');

    // Initialize socket handlers
    socketHandlers(io, socket, {
      connectedUsers,
      userSockets,
      vendorRooms,
      adminRooms,
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      logger.info(`Socket disconnected: ${socket.id} for user: ${userId}, reason: ${reason}`);

      // Remove from connected users
      const userData = connectedUsers.get(userId);
      if (userData) {
        userData.socketIds.delete(socket.id);
        if (userData.socketIds.size === 0) {
          connectedUsers.delete(userId);
          // Broadcast user offline status
          broadcastUserStatus(userId, 'offline');
        }
      }

      userSockets.delete(socket.id);

      // Remove from vendor rooms
      if (userType === 'vendor') {
        const vendorId = socket.vendorData?._id.toString();
        if (vendorId && vendorRooms.has(vendorId)) {
          vendorRooms.get(vendorId).delete(socket.id);
          if (vendorRooms.get(vendorId).size === 0) {
            vendorRooms.delete(vendorId);
          }
        }
      }

      // Remove from admin rooms
      if (userRole === 'admin' || userRole === 'super-admin') {
        const adminId = socket.adminData?._id.toString() || userId;
        if (adminRooms.has(adminId)) {
          adminRooms.get(adminId).delete(socket.id);
          if (adminRooms.get(adminId).size === 0) {
            adminRooms.delete(adminId);
          }
        }
      }
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error(`Socket error for user ${userId}:`, error);
    });
  });

  return io;
};

// Broadcast user status to relevant rooms
const broadcastUserStatus = (userId, status) => {
  if (!io) return;

  const statusData = {
    userId,
    status,
    timestamp: new Date(),
  };

  // Broadcast to admins
  io.to('admins').emit('user:status', statusData);

  // Broadcast to user's connections
  io.to(`user:${userId}`).emit('user:status', statusData);
};

// Emit event to specific user
const emitToUser = (userId, event, data) => {
  if (!io) return false;

  const userData = connectedUsers.get(userId?.toString());
  if (userData && userData.socketIds.size > 0) {
    io.to(`user:${userId}`).emit(event, data);
    return true;
  }
  return false;
};

// Emit event to multiple users
const emitToUsers = (userIds, event, data) => {
  if (!io) return;

  userIds.forEach(userId => {
    emitToUser(userId, event, data);
  });
};

// Emit event to all users with specific role
const emitToRole = (role, event, data) => {
  if (!io) return;
  io.to(`role:${role}`).emit(event, data);
};

// Emit event to specific vendor
const emitToVendor = (vendorId, event, data) => {
  if (!io) return;
  io.to(`vendor:${vendorId}`).emit(event, data);
};

// Emit event to all admins
const emitToAdmins = (event, data) => {
  if (!io) return;
  io.to('admins').emit(event, data);
};

// Emit event to specific room
const emitToRoom = (room, event, data) => {
  if (!io) return;
  io.to(room).emit(event, data);
};

// Get online users count
const getOnlineUsersCount = () => {
  return connectedUsers.size;
};

// Get online users list (with optional role filter)
const getOnlineUsers = (role = null) => {
  const users = [];
  for (const [userId, data] of connectedUsers) {
    if (!role || data.userData.role === role) {
      users.push({
        id: userId,
        name: data.userData.name,
        role: data.userData.role,
        type: data.userData.type,
        connectedAt: data.connectedAt,
      });
    }
  }
  return users;
};

// Check if user is online
const isUserOnline = (userId) => {
  return connectedUsers.has(userId?.toString());
};

// Get socket instance
const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
};

module.exports = {
  initializeSocket,
  getIO,
  emitToUser,
  emitToUsers,
  emitToRole,
  emitToVendor,
  emitToAdmins,
  emitToRoom,
  getOnlineUsersCount,
  getOnlineUsers,
  isUserOnline,
  connectedUsers,
  userSockets,
};