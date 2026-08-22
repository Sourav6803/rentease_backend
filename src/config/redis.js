
const Redis = require('ioredis');
const logger = require('./logger');

let redisClient = null;
let connectingPromise = null;

// Build ioredis options once. Shared by the app cache, rate limiter AND BullMQ,
// so only ONE physical connection is opened to Upstash.
const buildRedisConfig = () => {
  const base = {
    maxRetriesPerRequest: null, // required by BullMQ (never reject a queued command)
    enableReadyCheck: false,    // recommended for serverless Redis (Upstash)
    connectTimeout: 10000,
    keepAlive: 5000,            // keep the socket alive so Upstash doesn't drop it
    retryStrategy: (times) => {
      // Throttled logging: only every 10th attempt. With exponential backoff
      // (capped at 30s) this is ~one line every few minutes per client.
      if (times % 10 === 0) {
        logger.warn(`🔄 Redis retry attempt ${times}...`);
      }
      if (times > 60) {
        logger.error('🔄 Redis: giving up auto-retry after 60 attempts');
        return null; // stop retrying; 'end' event fires and logs
      }
      // Exponential backoff capped at 30s instead of a 100ms hammer loop
      return Math.min(1000 * 2 ** times, 30000);
    },
  };

  if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);
    return {
      ...base,
      host: url.hostname,
      port: parseInt(url.port, 10) || 6379,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      tls: url.protocol === 'rediss:' ? {} : undefined,
      db: 0,
    };
  }

  return {
    ...base,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  };
};

// Factory for the shared client. ALWAYS attach an 'error' listener — without it,
// a dropped connection emits an unhandled 'error' event and crashes the process.
const createRedisConnection = () => {
  const client = new Redis(buildRedisConfig());

  client.on('ready', () => {
    logger.info('✅ Redis connected successfully');
  });

  client.on('error', (err) => {
    logger.error(`❌ Redis error: ${err?.message || err?.code || err}`);
  });

  client.on('reconnecting', (delay) => {
    // Upstash closes idle connections by design, so reconnect is expected.
    // Debug level to avoid spam (retryStrategy logs real failures).
    logger.debug(`Redis reconnecting in ${delay}ms`);
  });

  client.on('end', () => {
    logger.error('Redis connection ended');
  });

  return client;
};

// Singleton connect for app startup. Returns the shared client or null
// (server keeps running without Redis instead of hanging/crashing).
const connectRedis = async () => {
  if (redisClient && ['ready', 'connecting', 'connect', 'reconnecting'].includes(redisClient.status)) {
    return redisClient;
  }

  if (connectingPromise) {
    return connectingPromise;
  }

  connectingPromise = (async () => {
    try {
      const client = createRedisConnection();

      // Ping with a timeout so a dead Redis never hangs server startup
      await Promise.race([
        client.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), 5000)),
      ]);

      redisClient = client;
      return redisClient;
    } catch (error) {
      logger.warn(`⚠️ Redis not available, continuing without Redis: ${error.message}`);
      return null;
    } finally {
      connectingPromise = null;
    }
  })();

  return connectingPromise;
};

const getRedisClient = () => redisClient;

module.exports = { connectRedis, getRedisClient, createRedisConnection };
