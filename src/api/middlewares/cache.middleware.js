const { getRedisClient } = require('../../config/redis');
const logger = require('../../config/logger');

// Cache response in Redis - FIXED VERSION
const cacheResponse = (duration = 300, keyPrefix = 'cache') => {
  return async (req, res, next) => {
    // Skip caching for non-GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const redisClient = getRedisClient();
    if (!redisClient) {
      return next();
    }

    // Generate cache key
    const key = `${keyPrefix}:${req.originalUrl || req.url}`;
    
    try {
      // Try to get cached response
      const cachedResponse = await redisClient.get(key);
      
      if (cachedResponse) {
        const parsed = JSON.parse(cachedResponse);
        return res.status(parsed.status).json(parsed.data);
      }

      // Store original json function
      const originalJson = res.json;
      
      // Override json function properly for Express 5
      res.json = function(data) {
        // Restore original function first to avoid infinite recursion
        res.json = originalJson;
        
        // Cache the response (don't await to avoid blocking)
        const responseData = {
          status: this.statusCode,
          data: data
        };
        
        redisClient.setex(key, duration, JSON.stringify(responseData))
          .catch(err => logger.error('Redis cache error:', err));
        
        // Call original json
        return originalJson.call(this, data);
      };

      next();
    } catch (error) {
      logger.error('Cache middleware error:', error);
      next();
    }
  };
};

// Clear cache by pattern
const clearCache = async (pattern) => {
  const redisClient = getRedisClient();
  if (!redisClient) return;

  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  } catch (error) {
    logger.error('Clear cache error:', error);
  }
};

// Cache user data
const cacheUser = (userId) => {
  return cacheResponse(300, `user:${userId}`);
};

// Cache product data
const cacheProduct = (productId) => {
  return cacheResponse(600, `product:${productId}`);
};

// Cache category data
const cacheCategory = (categoryId) => {
  return cacheResponse(3600, `category:${categoryId}`);
};

/**
 * Cache rental data
 */
const cacheRental = (rentalId) => {
  return cacheResponse(300, `rental:${rentalId}`);
};

/**
 * Cache vendor data
 */
const cacheVendor = (vendorId) => {
  return cacheResponse(600, `vendor:${vendorId}`);
};

/**
 * Cache payment data
 */
const cachePayment = (paymentId) => {
  return cacheResponse(300, `payment:${paymentId}`);
};

const cacheMaintenance = (maintenanceId) => {
  return cacheResponse(300, `maintenance:${maintenanceId}`);
};

const cacheReview = (reviewId) => {
  return cacheResponse(600, `review:${reviewId}`); // 10 minutes TTL
};

const cacheInventory = (inventoryId) => {
  return cacheResponse(300, `inventory:${inventoryId}`); // 5 minutes TTL
};

const cacheDelivery = (deliveryId) => {
  return cacheResponse(300, `delivery:${deliveryId}`); // 5 minutes TTL
};

const cacheAnalytics = (type) => {
  return cacheResponse(1800, `analytics:${type}`); // 30 minutes TTL
};

const cacheDiscount = (discountId) => {
  return cacheResponse(600, `discount:${discountId}`); // 10 minutes TTL
};

/**
 * Invalidate cache after mutation
 */
const invalidateCache = (patterns = []) => {
  return async (req, res, next) => {
    // Store original json function
    const originalJson = res.json;
    
    res.json = async function(data) {
      // Restore original function
      res.json = originalJson;
      
      // Call original json first
      const result = await originalJson.call(this, data);
      
      // Clear cache patterns after successful response
      if (this.statusCode >= 200 && this.statusCode < 300) {
        const redisClient = getRedisClient();
        if (redisClient) {
          for (const pattern of patterns) {
            try {
              const keys = await redisClient.keys(pattern);
              if (keys.length > 0) {
                await redisClient.del(keys);
                logger.info(`Invalidated ${keys.length} cache keys matching pattern: ${pattern}`);
              }
            } catch (error) {
              logger.error('Cache invalidation error:', error);
            }
          }
        }
      }
      
      return result;
    };
    
    next();
  };
};


// Cache list data with invalidation
const cacheList = (listName, duration = 300) => {
  return cacheResponse(duration, `list:${listName}`);
};

// Invalidate cache after mutation - FIXED VERSION
// const invalidateCache = (patterns = []) => {
//   return async (req, res, next) => {
//     // Store original json function
//     const originalJson = res.json;
    
//     res.json = async function(data) {
//       // Restore original function
//       res.json = originalJson;
      
//       // Call original json first
//       const result = await originalJson.call(this, data);
      
//       // Clear cache patterns after successful response
//       if (this.statusCode >= 200 && this.statusCode < 300) {
//         const redisClient = getRedisClient();
//         if (redisClient) {
//           for (const pattern of patterns) {
//             try {
//               const keys = await redisClient.keys(pattern);
//               if (keys.length > 0) {
//                 await redisClient.del(keys);
//               }
//             } catch (error) {
//               logger.error('Cache invalidation error:', error);
//             }
//           }
//         }
//       }
      
//       return result;
//     };
    
//     next();
//   };
// };

// Cache with tags for group invalidation - FIXED VERSION
const cacheWithTags = (duration = 300, tags = []) => {
  return async (req, res, next) => {
    if (req.method !== 'GET') {
      return next();
    }

    const redisClient = getRedisClient();
    if (!redisClient) {
      return next();
    }

    const key = `cache:${req.originalUrl}`;
    
    try {
      // Check if cached
      const cached = await redisClient.get(key);
      if (cached) {
        const parsed = JSON.parse(cached);
        return res.status(parsed.status).json(parsed.data);
      }

      // Store original json function
      const originalJson = res.json;
      
      res.json = async function(data) {
        // Restore original function
        res.json = originalJson;
        
        // Store response
        const responseData = {
          status: this.statusCode,
          data: data
        };
        
        // Cache the response
        await redisClient.setex(key, duration, JSON.stringify(responseData));
        
        // Add to tag sets
        for (const tag of tags) {
          await redisClient.sadd(`tag:${tag}`, key);
        }
        
        return originalJson.call(this, data);
      };

      next();
    } catch (error) {
      logger.error('Cache with tags error:', error);
      next();
    }
  };
};

// Invalidate by tags
const invalidateByTags = async (tags = []) => {
  const redisClient = getRedisClient();
  if (!redisClient) return;

  try {
    for (const tag of tags) {
      // Get all cache keys for this tag
      const keys = await redisClient.smembers(`tag:${tag}`);
      
      if (keys.length > 0) {
        // Delete all cache entries
        await redisClient.del(keys);
        // Delete the tag set
        await redisClient.del(`tag:${tag}`);
      }
    }
  } catch (error) {
    logger.error('Invalidate by tags error:', error);
  }
};

// Memory cache fallback (when Redis is unavailable) - FIXED VERSION
const memoryCacheMiddleware = (duration = 300) => {
  return (req, res, next) => {
    if (req.method !== 'GET') {
      return next();
    }

    const key = req.originalUrl;
    const cached = memoryCache.get(key);

    if (cached && cached.expires > Date.now()) {
      return res.status(cached.status).json(cached.data);
    }

    const originalJson = res.json;
    
    res.json = function(data) {
      // Restore original function
      res.json = originalJson;
      
      memoryCache.set(key, {
        data: data,
        status: this.statusCode,
        expires: Date.now() + duration * 1000
      });
      
      return originalJson.call(this, data);
    };

    next();
  };
};

// Memory cache store
const memoryCache = new Map();

module.exports = {
  cacheResponse,
  clearCache,
  cacheUser,
  cacheProduct,
  cacheCategory,
  cacheList,
  invalidateCache,
  cacheWithTags,
  invalidateByTags,
  memoryCacheMiddleware,
  cacheRental,
  cacheVendor,
  cachePayment,
  cacheMaintenance,
  cacheReview,
  cacheInventory,
  cacheDelivery,
  cacheAnalytics,
  cacheDiscount
};