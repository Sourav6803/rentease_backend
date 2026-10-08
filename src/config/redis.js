
const Redis = require('ioredis');
const logger = require('./logger');

let redisClient = null;
let connectingPromise = null;

// Two flavours of connection, because BullMQ and the rest of the app have
// opposite needs:
//
//   • BullMQ   — MUST use `maxRetriesPerRequest: null`. Its blocking commands
//                (BZPOPMIN / BRPOPLPUSH) legitimately sit idle for minutes and
//                BullMQ throws if a command is rejected mid-reconnect.
//
//   • The app  — must FAIL FAST. The old code handed the SAME null-retry
//                connection to everything, so whenever Redis was slow or the
//                Upstash request limit was hit, every cache GET/SET and
//                blacklist lookup queued in the offline queue forever instead
//                of erroring. That is what turned a Redis hiccup into requests
//                that hang for tens of seconds.
const buildRedisConfig = ({ forBullmq = false } = {}) => {
  const base = {
    maxRetriesPerRequest: forBullmq ? null : 2,
    // App commands surface the error immediately instead of queueing behind a
    // dead connection; BullMQ still needs the queue.
    enableOfflineQueue: forBullmq,
    enableReadyCheck: false, // recommended for serverless Redis (Upstash)
    connectTimeout: forBullmq ? 10000 : 3000,
    keepAlive: 5000, // keep the socket alive so Upstash doesn't drop it
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

// Attach the listeners every client needs. Without an 'error' handler a dropped
// connection emits an unhandled 'error' event and crashes the process.
const attachClientLogging = (client, label = 'Redis') => {
  client.on('ready', () => {
    logger.info(`✅ ${label} connected successfully`);
  });

  client.on('error', (err) => {
    logger.error(`❌ ${label} error: ${err?.message || err?.code || err}`);
  });

  client.on('reconnecting', (delay) => {
    // Upstash closes idle connections by design, so reconnect is expected.
    // Debug level to avoid spam (retryStrategy logs real failures).
    logger.debug(`${label} reconnecting in ${delay}ms`);
  });

  client.on('end', () => {
    logger.error(`${label} connection ended`);
  });

  return client;
};

// Factory for the shared APP client (fail-fast flavour).
const createRedisConnection = () => attachClientLogging(new Redis(buildRedisConfig()), 'Redis');

// Dedicated factory for BullMQ queues/workers. Kept separate from the app
// client on purpose: BullMQ needs a blocking-safe connection, and every Worker
// duplicates this connection internally for its own blocking reader.
const createBullConnection = () =>
  attachClientLogging(new Redis(buildRedisConfig({ forBullmq: true })), 'Redis(BullMQ)');

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

      // Wait for the socket to be usable BEFORE pinging.
      //
      // The app client runs with `enableOfflineQueue: false` (so commands fail
      // fast instead of hanging when Redis is degraded). That also means an
      // immediate PING would reject with "Stream isn't writeable" because the
      // connection has not completed yet — which would make a perfectly healthy
      // Redis look unavailable on every boot. So gate on 'ready', bounded by a
      // timeout so a dead Redis never hangs startup.
      const { once } = require('events');
      await Promise.race([
        once(client, 'ready'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Redis connect timeout')), 5000)
        ),
      ]);

      await client.ping();

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

module.exports = {
  connectRedis,
  getRedisClient,
  createRedisConnection,
  createBullConnection,
  // exported for `npm run test:jobs` so the two connection flavours can be
  // asserted directly instead of by reading the source
  buildRedisConfig,
};
