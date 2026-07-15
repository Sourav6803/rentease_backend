// const rateLimit = require('express-rate-limit');
// const RedisStore = require('rate-limit-redis');
// const { getRedisClient } = require('../../config/redis');
// const AppError = require('../../utils/AppError');

// // General API rate limiter
// const apiLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 100, // Limit each IP to 100 requests per windowMs
//   message: 'Too many requests from this IP, please try again later.',
//   standardHeaders: true,
//   legacyHeaders: false,
//   handler: (req, res) => {
//     throw new AppError('Too many requests, please try again later.', 429);
//   }
// });

// // Auth endpoints rate limiter (stricter)
// const authLimiter = rateLimit({
//   windowMs: 60 * 60 * 1000, // 1 hour
//   max: 10, // Limit each IP to 10 login/register attempts per hour
//   skipSuccessfulRequests: true,
//   message: 'Too many authentication attempts, please try again later.',
//   standardHeaders: true,
//   legacyHeaders: false
// });

// // OTP rate limiter
// const otpLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 5, // 5 OTP requests per 15 minutes
//   message: 'Too many OTP requests, please try again later.',
//   standardHeaders: true,
//   legacyHeaders: false,
//   keyGenerator: (req) => {
//     return req.body.phone || req.body.email || req.ip;
//   }
// });

// // Payment endpoints rate limiter
// const paymentLimiter = rateLimit({
//   windowMs: 60 * 60 * 1000, // 1 hour
//   max: 20, // 20 payment attempts per hour
//   message: 'Too many payment attempts, please try again later.',
//   standardHeaders: true,
//   legacyHeaders: false
// });

// // Admin endpoints rate limiter
// const adminLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 200, // 200 requests per 15 minutes for admin
//   message: 'Too many admin requests, please try again later.',
//   standardHeaders: true,
//   legacyHeaders: false,
//   keyGenerator: (req) => {
//     return req.admin?._id?.toString() || req.ip;
//   }
// });

// // Create custom Redis store limiter
// const createRedisLimiter = (options = {}) => {
//   const redisClient = getRedisClient();
  
//   if (!redisClient) {
//     // Fallback to memory store if Redis is not available
//     return rateLimit({
//       windowMs: options.windowMs || 15 * 60 * 1000,
//       max: options.max || 100,
//       message: options.message || 'Too many requests',
//       standardHeaders: true,
//       legacyHeaders: false
//     });
//   }

//   return rateLimit({
//     store: new RedisStore({
//       sendCommand: (...args) => redisClient.call(...args),
//       prefix: options.prefix || 'rl:'
//     }),
//     windowMs: options.windowMs || 15 * 60 * 1000,
//     max: options.max || 100,
//     message: options.message || 'Too many requests',
//     standardHeaders: true,
//     legacyHeaders: false,
//     keyGenerator: options.keyGenerator || ((req) => req.ip)
//   });
// };

// // Dynamic rate limiter based on user role
// const dynamicRateLimiter = (req, res, next) => {
//   const role = req.userRole || 'guest';
  
//   const limits = {
//     guest: { windowMs: 15 * 60 * 1000, max: 50 },
//     user: { windowMs: 15 * 60 * 1000, max: 100 },
//     vendor: { windowMs: 15 * 60 * 1000, max: 200 },
//     admin: { windowMs: 15 * 60 * 1000, max: 500 },
//     super_admin: { windowMs: 15 * 60 * 1000, max: 1000 }
//   };

//   const limit = limits[role] || limits.guest;
  
//   return rateLimit({
//     windowMs: limit.windowMs,
//     max: limit.max,
//     message: 'Too many requests, please try again later.',
//     standardHeaders: true,
//     legacyHeaders: false,
//     keyGenerator: (req) => {
//       return req.userId?.toString() || req.ip;
//     }
//   })(req, res, next);
// };

// // IP based rate limiter with whitelist
// const ipWhitelistLimiter = (whitelist = []) => {
//   return (req, res, next) => {
//     const clientIp = req.ip || req.connection.remoteAddress;
    
//     if (whitelist.includes(clientIp)) {
//       // Skip rate limiting for whitelisted IPs
//       return next();
//     }
    
//     return apiLimiter(req, res, next);
//   };
// };

// // Concurrent request limiter
// const concurrencyLimiter = (maxConcurrent = 5) => {
//   const concurrent = new Map();
  
//   return (req, res, next) => {
//     const key = req.userId?.toString() || req.ip;
    
//     if (concurrent.has(key)) {
//       const count = concurrent.get(key);
//       if (count >= maxConcurrent) {
//         return next(new AppError('Too many concurrent requests', 429));
//       }
//       concurrent.set(key, count + 1);
//     } else {
//       concurrent.set(key, 1);
//     }
    
//     res.on('finish', () => {
//       const count = concurrent.get(key);
//       if (count === 1) {
//         concurrent.delete(key);
//       } else {
//         concurrent.set(key, count - 1);
//       }
//     });
    
//     next();
//   };
// };

// module.exports = {
//   apiLimiter,
//   authLimiter,
//   otpLimiter,
//   paymentLimiter,
//   adminLimiter,
//   createRedisLimiter,
//   dynamicRateLimiter,
//   ipWhitelistLimiter,
//   concurrencyLimiter
// };


const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { getRedisClient } = require('../../config/redis');
const AppError = require('../../utils/AppError');



// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req),
  handler: (req, res) => {
    throw new AppError('Too many requests, please try again later.', 429);
  }
});


// Auth limiter
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req)
});


// OTP limiter
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many OTP requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.body.phone || req.body.email || ipKeyGenerator(req);
  }
});


// Payment limiter
const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many payment attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req)
});


// Admin limiter
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: 'Too many admin requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.admin?._id?.toString() || ipKeyGenerator(req);
  }
});


// Redis limiter
const createRedisLimiter = (options = {}) => {

  const redisClient = getRedisClient();

  if (!redisClient) {
    return rateLimit({
      windowMs: options.windowMs || 15 * 60 * 1000,
      max: options.max || 100,
      message: options.message || 'Too many requests',
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => ipKeyGenerator(req)
    });
  }

  return rateLimit({
    store: new RedisStore({
      sendCommand: (...args) => redisClient.call(...args),
      prefix: options.prefix || 'rl:'
    }),

    windowMs: options.windowMs || 15 * 60 * 1000,
    max: options.max || 100,
    message: options.message || 'Too many requests',
    standardHeaders: true,
    legacyHeaders: false,

    keyGenerator: options.keyGenerator || ((req) => ipKeyGenerator(req))
  });
};


// Dynamic limiter
const dynamicRateLimiter = (req, res, next) => {

  const role = req.userRole || 'guest';

  const limits = {
    guest: { windowMs: 15 * 60 * 1000, max: 50 },
    user: { windowMs: 15 * 60 * 1000, max: 100 },
    vendor: { windowMs: 15 * 60 * 1000, max: 200 },
    admin: { windowMs: 15 * 60 * 1000, max: 500 },
    super_admin: { windowMs: 15 * 60 * 1000, max: 1000 }
  };

  const limit = limits[role] || limits.guest;

  return rateLimit({
    windowMs: limit.windowMs,
    max: limit.max,
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,

    keyGenerator: (req) => {
      return req.userId?.toString() || ipKeyGenerator(req);
    }

  })(req, res, next);
};


// IP whitelist limiter
const ipWhitelistLimiter = (whitelist = []) => {

  return (req, res, next) => {

    const clientIp = req.ip || req.connection.remoteAddress;

    if (whitelist.includes(clientIp)) {
      return next();
    }

    return apiLimiter(req, res, next);

  };

};


// Concurrent limiter
const concurrencyLimiter = (maxConcurrent = 5) => {

  const concurrent = new Map();

  return (req, res, next) => {

    const key = req.userId?.toString() || ipKeyGenerator(req);

    if (concurrent.has(key)) {

      const count = concurrent.get(key);

      if (count >= maxConcurrent) {
        return next(new AppError('Too many concurrent requests', 429));
      }

      concurrent.set(key, count + 1);

    } else {

      concurrent.set(key, 1);

    }

    res.on('finish', () => {

      const count = concurrent.get(key);

      if (count === 1) {
        concurrent.delete(key);
      } else {
        concurrent.set(key, count - 1);
      }

    });

    next();

  };

};


module.exports = {
  apiLimiter,
  authLimiter,
  otpLimiter,
  paymentLimiter,
  adminLimiter,
  createRedisLimiter,
  dynamicRateLimiter,
  ipWhitelistLimiter,
  concurrencyLimiter
};