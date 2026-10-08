// src/worker.js
//
// Standalone BullMQ worker process.
//
//   npm run worker          (same as: node src/worker.js)
//
// WHY THIS EXISTS
// ---------------
// A BullMQ Worker long-polls Redis whenever its queue is empty, and Upstash
// bills per command. Running workers inside the web process means every API
// instance pays that polling cost. Split them:
//
//   web tier      ENABLE_QUEUE_WORKERS=false npm start   -> zero queue polling
//   worker tier   npm run worker                         -> owns all 4 workers
//
// Both tiers talk to the SAME queues, so the web tier can still enqueue jobs.
//
// This process also connects to MongoDB, because the job processors read and
// write application data.

// Load .env exactly like the app does (config/env.js runs dotenv.config).
require('./config/env');

// This process exists to run workers — force them on regardless of what the
// shared .env says (the web tier sets ENABLE_QUEUE_WORKERS=false).
process.env.ENABLE_QUEUE_WORKERS = 'true';

const logger = require('./config/logger');
const connectDB = require('./config/database');
const { connectRedis } = require('./config/redis');
const { initializeQueues, workers, gracefulShutdown } = require('./jobs');

let shuttingDown = false;

const start = async () => {
  try {
    await connectDB();
    logger.info('✅ [worker] MongoDB connected');

    // Optional for the processors (they mostly touch Mongo), but cache
    // invalidation and the auth blacklist use Redis, so connect best-effort.
    await connectRedis();

    initializeQueues();

    logger.info(
      `👷 [worker] ready — ${Object.keys(workers).length} workers listening on ` +
        `${new Set(Object.values(workers).map((w) => w.name)).size} queues`
    );
  } catch (error) {
    logger.error('❌ [worker] failed to start:', error);
    process.exit(1);
  }
};

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`🛑 [worker] ${signal} received — shutting down`);

  try {
    await gracefulShutdown();
  } catch (error) {
    logger.error('❌ [worker] shutdown error:', error);
  }

  process.exit(0);
};

['SIGTERM', 'SIGINT'].forEach((signal) => {
  process.on(signal, () => shutdown(signal));
});

process.on('unhandledRejection', (reason) => {
  logger.error('❌ [worker] unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('❌ [worker] uncaught exception:', error);
  shutdown('uncaughtException');
});

start();
