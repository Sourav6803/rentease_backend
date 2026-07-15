
const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const { User, Admin, Vendor } = require('../../models/index');
const AppError = require('../../utils/AppError');
const catchAsync = require('../../utils/catchAsync');
const { getRedisClient } = require('../../config/redis');
const logger = require('../../config/logger');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');


// Protect routes - Verify JWT token
// const protect = catchAsync(async (req, res, next) => {
//   let token;

//   // 1. Get token from headers or cookies
//   if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
//     token = req.headers.authorization.split(' ')[1];
//   } else if (req.cookies?.token) {
//     token = req.cookies.token;
//   }

//   if (!token) {
//     return next(new AppError('You are not logged in. Please log in to access this resource.', 401));
//   }

//   // 2. Check if token is blacklisted (logout)
//   const redisClient = getRedisClient();
//   if (redisClient) {
//     const isBlacklisted = await redisClient.get(`blacklist:${token}`);
//     if (isBlacklisted) {
//       return next(new AppError('Invalid token. Please log in again.', 401));
//     }
//   }

//   try {
//     // 3. Verify token
//     const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

//     // 4. Check if user exists
//     let user = await User.findById(decoded.id)
//       .select('-password -security.refreshTokens -security.twoFactorSecret')
//       .populate('addresses');

//     if (!user) {
//       // Check if it's an admin
//       const admin = await Admin.findOne({ user: decoded.id }).populate('user');
//       if (admin) {
//         req.admin = admin;
//         req.user = admin.user;
//         req.userRole = 'admin';
//         return next();
//       }
//       console.log('No user or admin found for decoded token')
      
//       // Check if it's a vendor
//       const vendor = await Vendor.findOne({ user: decoded.id }).populate('user');
//       console.log('Decoded vendor:', vendor)
//       if (vendor) {
//         req.vendor = vendor;
//         req.user = vendor.user;
//         req.userRole = 'vendor';
//         return next();
//       }
      
//       return next(new AppError('The user belonging to this token no longer exists.', 401));
//     }

//     // 5. Check if user is active
//     if (!user.status.isActive || user.status.isBlocked) {
//       return next(new AppError('Your account has been deactivated. Please contact support.', 401));
//     }

//     // 6. Check if password changed after token was issued
//     if (user.changedPasswordAfter && user.changedPasswordAfter(decoded.iat)) {
//       return next(new AppError('User recently changed password. Please log in again.', 401));
//     }

//     console.log('Authenticated user:', user._id, 'Role:', user.role)
//     if(user.role === 'vendor'){
//       console.log('Checking vendor profile for user:', user._id)
//       const vendor = await Vendor.findOne({ user: user._id });
//       if (!vendor) {
//         return next(new AppError('Vendor profile not found', 404));

//       }
//       req.vendor = vendor;
//       req.userRole = 'vendor';
//       req.vendorId = vendor._id;
//       user.stats.lastActive = new Date();
//       await user.save({ validateBeforeSave: false });
//       return next();
//     }

//     // 7. Set user in request
//     req.user = user;
//     req.userRole = user.role;
//     req.userId = user._id;  



//     // 8. Update last active
//     user.stats.lastActive = new Date();
//     await user.save({ validateBeforeSave: false });

//     next();
//   } catch (error) {
//     if (error.name === 'JsonWebTokenError') {
//       return next(new AppError('Invalid token. Please log in again.', 401));
//     } else if (error.name === 'TokenExpiredError') {
//       return next(new AppError('Your token has expired. Please log in again.', 401));
//     }
//     return next(error);
//   }
// });

const protect = catchAsync(async (req, res, next) => {
  let token;

  // Token extraction (same as before)
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return next(new AppError('You are not logged in. Please log in to access this resource.', 401));
  }

  // Token blacklist check (same as before)
  const redisClient = getRedisClient();
  if (redisClient) {
    const isBlacklisted = await redisClient.get(`blacklist:${token}`);
    if (isBlacklisted) {
      return next(new AppError('Invalid token. Please log in again.', 401));
    }
  }

  try {
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

    // console.log('Decoded token:', decoded)
    // Check Admin first
    const admin = await Admin.findOne({_id: decoded.id}).populate("user");
    // console.log('Admin found:', admin)
    if (admin) {
      if (!admin.user.status.isActive || admin.user.status.isBlocked) {
        return next(new AppError('Your account has been deactivated.', 401));
      }
      req.admin = admin;
      req.user = admin.user;
      req.userRole = 'admin';
      req.userId = admin.user._id;
      
      admin.user.stats.lastActive = new Date();
      await admin.user.save({ validateBeforeSave: false });
      return next();
    }

    // Check Vendor
    const vendor = await Vendor.findOne({ user: decoded.id }).populate('user');
    // console.log('Vendor found:', vendor)
    if (vendor) {
      if (!vendor.user.status.isActive || vendor.user.status.isBlocked) {
        return next(new AppError('Your account has been deactivated.', 401));
      }
      // if (vendor.verification?.status !== 'verified') {
      //   return next(new AppError('Your vendor account is not verified yet.', 403));
      // }
      req.vendor = vendor;
      req.user = vendor.user;
      req.userRole = 'vendor';
      req.vendorId = vendor._id;
      req.userId = vendor.user._id;
      
      vendor.user.stats.lastActive = new Date();
      await vendor.user.save({ validateBeforeSave: false });
      return next();
    }

    // Check Regular User
    const user = await User.findById(decoded.id)
      .select('-password -security.refreshTokens -security.twoFactorSecret')
      .populate('addresses');

    // console.log('User found:', user)  

    if (!user) {
      return next(new AppError('The user belonging to this token no longer exists.', 401));
    }

    if (!user.status.isActive || user.status.isBlocked) {
      return next(new AppError('Your account has been deactivated. Please contact support.', 401));
    }

    if (user.changedPasswordAfter && user.changedPasswordAfter(decoded.iat)) {
      return next(new AppError('User recently changed password. Please log in again.', 401));
    }

    req.user = user;
    req.userRole = user.role;
    req.userId = user._id;

    user.stats.lastActive = new Date();
    await user.save({ validateBeforeSave: false });

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return next(new AppError('Invalid token. Please log in again.', 401));
    } else if (error.name === 'TokenExpiredError') {
      return next(new AppError('Your token has expired. Please log in again.', 401));
    }
    return next(error);
  }
});

// Optional auth - doesn't throw error if no token
const optionalAuth = catchAsync(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next();
  }

  try {
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    
    if (user && user.status.isActive && !user.status.isBlocked) {
      req.user = user;
      req.userId = user._id;
    }
    
    next();
  } catch (error) {
    // Ignore token errors for optional auth
    next();
  }
});

// Generate JWT token
const generateToken = (id, role = 'user') => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m'
  });
};

// Generate refresh token
const generateRefreshToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  });
};

// Verify refresh token
const verifyRefreshToken = async (token) => {
  try {
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_REFRESH_SECRET);
    return decoded;
  } catch (error) {
    return null;
  }
};

// Blacklist token (logout)
const blacklistToken = async (token) => {
  const redisClient = getRedisClient();
  if (redisClient) {
    const decoded = jwt.decode(token);
    const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
    await redisClient.setex(`blacklist:${token}`, expiresIn, 'true');
  }
};

// Refresh token middleware
const refreshToken = catchAsync(async (req, res, next) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return next(new AppError('Refresh token is required', 400));
  }

  const decoded = await verifyRefreshToken(refreshToken);
  if (!decoded) {
    return next(new AppError('Invalid refresh token', 401));
  }

  const user = await User.findById(decoded.id);
  if (!user) {
    return next(new AppError('User not found', 401));
  }

  // Check if refresh token exists in user's tokens
  const tokenExists = user.security.refreshTokens?.some(
    t => t.token === refreshToken && t.expiresAt > new Date()
  );

  if (!tokenExists) {
    return next(new AppError('Invalid refresh token', 401));
  }

  // Generate new tokens
  const newToken = generateToken(user._id, user.role);
  const newRefreshToken = generateRefreshToken(user._id);

  // Update refresh token in database
  user.security.refreshTokens = user.security.refreshTokens.filter(
    t => t.token !== refreshToken
  );
  user.security.refreshTokens.push({
    token: newRefreshToken,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  });
  await user.save();

  res.json({
    success: true,
    token: newToken,
    refreshToken: newRefreshToken
  });
});

// Logout middleware
const logout = catchAsync(async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
  
  if (token) {
    await blacklistToken(token);
  }

  if (req.user) {
    // Clear refresh token from database
    await User.findByIdAndUpdate(req.user._id, {
      $set: { 'security.refreshTokens': [] }
    });
  }

  res.clearCookie('token');
  res.clearCookie('refreshToken');

  res.json({ success: true, message: 'Logged out successfully' });
});

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
  max: 10,
  keyGenerator: (req) => {
    // For authenticated users, use their ID
    if (req.user?._id) {
      return `user:${req.user._id}`;
    }
    // For unauthenticated users, use IP with proper IPv6 handling
    return ipKeyGenerator(req.ip);
  },
  skipSuccessfulRequests: true, // Don't count successful logins against limit
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again later.',
    retryAfter: Math.ceil(15 * 60 * 1000 / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  protect,
  optionalAuth,
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  blacklistToken,
  refreshToken,
  logout,
  canAccessVendor,
  canAccessTicket,
  auditLog,
  adminRateLimiter

};

