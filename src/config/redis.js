

const Redis = require('ioredis');
const logger = require('./logger');

let redisClient;

const connectRedis = async () => {
  try {
    
    if (process.env.REDIS_URL) {
      redisClient = new Redis(process.env.REDIS_URL);
    }

    redisClient.on('ready', () => {
      logger.info('✅ Redis connected successfully');
    });

    redisClient.on('error', (err) => {
      logger.error('❌ Redis error:', err.message);
    });

    await redisClient.ping();

    return redisClient;

  } catch (error) {
    logger.warn('⚠️ Redis not available, continuing without Redis');
    return null;
  }
};

const getRedisClient = () => redisClient;

module.exports = { connectRedis, getRedisClient };