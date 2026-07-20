require('dotenv').config();
const Redis = require('ioredis');

const config = process.env.REDIS_URL
  ? process.env.REDIS_URL
  : {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB) || 0,
      tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    };

console.log('Connecting with:', config);

const redis = new Redis(config, { maxRetriesPerRequest: 1, connectTimeout: 5000 });

redis.on('error', (err) => console.error('❌ Redis error:', err.message));

redis
  .ping()
  .then((res) => {
    console.log('✅ PING response:', res);
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ PING failed:', err.message);
    process.exit(1);
  });