const jwt = require('jsonwebtoken');
const { promisify } = require('util');
// const { Admin } = require('../models');
// const { getRedisClient } = require('../config/redis');
const  AppError  = require('../../utils/AppError');
const logger = require('../../config/logger');
const { Admin } = require('../../models');
const { getRedisClient } = require('../../config/redis');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
/**
 * Protect admin routes - Verify JWT token
 */
const protectAdmin = async (req, res, next) => {
  let token;

  // Get token from headers or cookies
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies?.adminAccessToken) {
    token = req.cookies.adminAccessToken;
  }

  if (!token) {
    return next(new AppError('You are not logged in. Please log in to access this resource admin auth proect admin.', 401));
  }

  // Check if token is blacklisted
  const redisClient = getRedisClient();
  if (redisClient) {
    const isBlacklisted = await redisClient.get(`admin_blacklist:${token}`);
    if (isBlacklisted) {
      return next(new AppError('Invalid token. Please log in again.', 401));
    }
  }

  try {
    // Verify token
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

    // Check if token is for admin
    if (decoded.type !== 'admin') {
      return next(new AppError('Invalid token type. Please use admin credentials.', 401));
    }

    // Get admin from database
    const admin = await Admin.findById(decoded.id)
      .select('-password -access.twoFactorSecret ')
      .populate('user', 'email phone profile');

    if (!admin) {
      return next(new AppError('Admin account no longer exists.', 401));
    }

    // Check if admin is active
    if (!admin.status.isActive || admin.status.isBlocked) {
      return next(new AppError('Your account has been deactivated. Please contact super admin.', 403));
    }

    // Check if email is verified
    if (!admin.security.emailVerified) {
      return next(new AppError('Please verify your email before accessing admin panel.', 403));
    }

    // Check if password change is required
    if (admin.access.requirePasswordChange) {
      return next(new AppError('Password change required. Please set a new password.', 403, {
        requirePasswordChange: true
      }));
    }

    // Update last active
    admin.activity.lastActive = new Date();
    await admin.save({ validateBeforeSave: false });

    // Attach admin to request
    req.admin = admin;
    req.adminId = admin._id;

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return next(new AppError('Invalid token. Please log in again.', 401));
    } else if (error.name === 'TokenExpiredError') {
      return next(new AppError('Your token has expired. Please log in again.', 401));
    }
    return next(error);
  }
};

/**
 * Restrict to specific admin roles
 */
const normalizeRole = (role) => role?.toLowerCase().replace(/-/g, '_');

const restrictTo = (...roles) => {
  return (req, res, next) => {
    const userRole = normalizeRole(req.admin?.role);
    const allowedRoles = roles.map(normalizeRole);
    if (!userRole || !allowedRoles.includes(userRole)) {
      return next(new AppError('You do not have permission to perform this action.', 403));
    }
    next();
  };
};

/**
 * Check admin permission for resource and action
 */
const hasPermission = (resource, action) => {
  return async (req, res, next) => {
    if (!req.admin) {
      return next(new AppError('Authentication required', 401));
    }

    const hasAccess = req.admin.hasPermission(resource, action);
    
    if (!hasAccess) {
      return next(new AppError(`You do not have permission to ${action} ${resource}`, 403));
    }

    next();
  };
};

/**
 * Check if admin can access specific vendor
 */
const canAccessVendor = (vendorIdParam = 'vendorId') => {
  return async (req, res, next) => {
    const vendorId = req.params[vendorIdParam];
    
    if (!vendorId) {
      return next();
    }

    // Super admin and vendor managers can access all vendors
    if (req.admin.role === 'super_admin' || req.admin.role === 'vendor_manager') {
      return next();
    }

    // Check if vendor is assigned to this admin
    if (req.admin.assignments?.assignedVendors?.includes(vendorId)) {
      return next();
    }

    return next(new AppError('You do not have permission to access this vendor', 403));
  };
};

/**
 * Check if admin can access specific ticket
 */
const canAccessTicket = (ticketIdParam = 'ticketId') => {
  return async (req, res, next) => {
    const ticketId = req.params[ticketIdParam];
    
    if (!ticketId) {
      return next();
    }

    const SupportTicket = require('../models/SupportTicket.model');
    const ticket = await SupportTicket.findById(ticketId);

    if (!ticket) {
      return next();
    }

    // Check if admin is assigned to this ticket
    if (ticket.assignedTo?.toString() === req.admin._id.toString()) {
      return next();
    }

    // Super admin and support managers can access all tickets
    if (req.admin.role === 'super_admin' || req.admin.role === 'support_manager') {
      return next();
    }

    return next(new AppError('You do not have permission to access this ticket', 403));
  };
};

/**
 * Audit log middleware
 */
const auditLog = (action, resource) => {
  return async (req, res, next) => {
    const originalSend = res.json;
    
    res.json = async function(data) {
      // Log the action after response is sent
      if (req.admin && res.statusCode >= 200 && res.statusCode < 300) {
        try {
          await req.admin.logAction(
            action,
            resource,
            req.params.id || req.body.id,
            {
              method: req.method,
              url: req.originalUrl,
              body: req.body,
              params: req.params,
              query: req.query,
              responseStatus: res.statusCode
            },
            req.ip
          );
        } catch (error) {
          logger.error('Audit log error:', error);
        }
      }
      
      originalSend.call(this, data);
    };
    
    next();
  };
};

/**
 * Rate limit for admin endpoints
 */
const adminRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  keyGenerator: (req) => {
    // For authenticated admins, use their ID
    if (req.admin?._id) {
      return `admin:${req.admin._id}`;
    }
    // For unauthenticated, use IP with proper IPv6 handling
    return ipKeyGenerator(req.ip);
  },
  message: 'Too many requests from this IP, please try again later.'
});

module.exports = {
  protectAdmin,
  restrictTo,
  hasPermission,
  canAccessVendor,
  canAccessTicket,
  auditLog,
  adminRateLimiter
};