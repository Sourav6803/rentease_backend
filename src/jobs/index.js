
const { Queue, Worker } = require('bullmq');
const logger = require('../config/logger');
const { getRedisClient, createRedisConnection } = require('../config/redis');

// Job queues
const queues = {};
const workers = {};

// Queue configurations
const queueConfigs = {
  'email': {
    name: 'email-queue',
    concurrency: 5,
    options: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 60000,
      },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  },
  'sms': {
    name: 'sms-queue',
    concurrency: 3,
    options: {
      attempts: 3,
      backoff: 2000,
      removeOnComplete: true,
    },
  },
  'notification': {
    name: 'notification-queue',
    concurrency: 10,
    options: {
      attempts: 3,
      backoff: 5000,
    },
  },
  'payment': {
    name: 'payment-queue',
    concurrency: 2,
    options: {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 30000,
      },
    },
  },
  'rental': {
    name: 'rental-queue',
    concurrency: 3,
    options: {
      attempts: 3,
      backoff: 60000,
    },
  },
  'delivery': {
    name: 'delivery-queue',
    concurrency: 2,
    options: {
      attempts: 3,
      backoff: 30000,
    },
  },
  'report': {
    name: 'report-queue',
    concurrency: 1,
    options: {
      attempts: 2,
      backoff: 60000,
    },
  },
  'cleanup': {
    name: 'cleanup-queue',
    concurrency: 1,
    options: {
      attempts: 1,
      repeat: {
        pattern: '0 0 * * *',
      },
    },
  },
  'default': {
    name: 'default-queue',
    concurrency: 5,
    options: {
      attempts: 2,
      backoff: 10000,
    },
  },
};

// NOTE: BullMQ does NOT create its own Redis connection anymore.
// It reuses the single shared client from src/config/redis.js (see initializeQueues).

// Initialize all queues (call AFTER Redis is connected — see app.js startServer)
let isInitialized = false;
const initializeQueues = () => {
  if (isInitialized) return queues;
  isInitialized = true;

  logger.info('🔧 Initializing BullMQ queues...');

  // Reuse the app-wide Redis client — no second connection to Upstash.
  // Fallback to a fresh connection ONLY when Redis is down (self-heals on retry).
  const connection = getRedisClient() || createRedisConnection();

  // Create queues
  Object.entries(queueConfigs).forEach(([key, config]) => {
    // console.log(`📦 Creating queue: ${key} with name: ${config.name}`);
    
    try {
      // Create queue
      queues[key] = new Queue(config.name, {
        connection,
        defaultJobOptions: config.options,
      });
      
      // Create worker with concurrency
      workers[key] = new Worker(
        config.name,
        async (job) => {
          logger.info(`⚙️ Processing job from ${key} queue:`, {
            jobId: job.id,
            type: job.data.type,
          });
          
          try {
            const result = await processJobByType(key, job);
            logger.info(`✅ Job ${job.id} from ${key} completed`);
            return result;
          } catch (error) {
            logger.error(`❌ Job ${job.id} from ${key} failed:`, error);
            throw error;
          }
        },
        {
          connection,
          concurrency: config.concurrency,
          // Gentler stalled-job handling for serverless Redis (Upstash):
          // checks stalled jobs every 60s and allows one recovery attempt
          stalledInterval: 60000,
          maxStalledCount: 2,
        }
      );

      // Worker event handlers
      workers[key].on('completed', (job, result) => {
        logger.info(`✅ Job ${job.id} (${key}) completed successfully`, {
          durationMs: Date.now() - (job.timestamp || Date.now()),
        });
      });

      workers[key].on('failed', (job, error) => {
        logger.error(`❌ Job ${job.id} (${key}) failed:`, {
          error: error.message,
          attemptsMade: job?.attemptsMade,
          data: job?.data,
        });
      });

      // CRITICAL: the listener must stay attached — an unhandled 'error' event
      // would crash the process. Logged at debug because the shared client in
      // config/redis.js already logs the same connection error once (otherwise
      // 9 workers × 9 queues = 18 duplicate lines per Redis blip).
      workers[key].on('error', (err) => {
        logger.debug(`Worker ${key} error: ${err?.message || err?.code || err}`);
      });

      workers[key].on('stalled', (job) => {
        logger.warn(`⚠️ Job ${job.id} (${key}) stalled — will be retried`);
      });

      workers[key].on('active', (job) => {
        logger.info(`🔄 Job ${job.id} (${key}) started processing`);
      });

      workers[key].on('progress', (job, progress) => {
        // Progress logging kept minimal to avoid noise
      });

      // Queue event handlers (debug — the shared client logs the connection
      // error once; this listener exists only to keep the event handled)
      queues[key].on('error', (error) => {
        logger.debug(`Queue ${key} error: ${error?.message || error?.code || error}`);
      });

      // console.log(`✅ Queue initialized: ${key}`);
    } catch (error) {
      logger.error(`❌ Failed to initialize queue ${key}:`, error);
    }
  });

  logger.info('🎯 All BullMQ queues initialized successfully!');
  return queues;
};

// Process job by type
const processJobByType = async (queueType, job) => {
  const { type, data } = job.data;
  
  // console.log(`🔄 Processing ${queueType} job: ${type}`, { jobId: job.id, data });

  try {
    let result;
    switch (queueType) {
      case 'email':
        const emailModule = require('./email.jobs');
        logger.info('📧 Loading email jobs module');
        result = await emailModule.process(type, data);
        break;
      case 'sms':
        result = await require('./sms.jobs').process(type, data);
        break;
      case 'notification':
        result = await require('./notification.jobs').process(type, data);
        break;
      case 'payment':
        result = await require('./payment.jobs').process(type, data);
        break;
      case 'rental':
        result = await require('./rental.jobs').process(type, data);
        break;
      case 'delivery':
        result = await require('./delivery.jobs').process(type, data);
        break;
      case 'report':
        result = await require('./report.jobs').process(type, data);
        break;
      case 'cleanup':
        result = await require('./cleanup.jobs').process(type, data);
        break;
      default:
        result = await require('./default.jobs').process(type, data);
        break;
    }
    
    // console.log(`✅ Processed ${queueType} job: ${type}`, { jobId: job.id });
    return result;
  } catch (error) {
    logger.error(`❌ Error processing job ${queueType}/${type}:`, error);
    throw error;
  }
};

// Add job to queue
const addJob = async (queueType, jobType, data, options = {}) => {
  // console.log(`📤 Attempting to add job to ${queueType} queue:`, {
  //   jobType,
  //   data: JSON.stringify(data).substring(0, 100) + '...',
  //   options,
  // });

  const queue = queues[queueType];
  
  if (!queue) {
    logger.error(`❌ Queue ${queueType} not found! Available queues:`, Object.keys(queues));
    throw new Error(`Queue ${queueType} not found`);
  }

  const jobOptions = {
    attempts: queueConfigs[queueType]?.options?.attempts || 3,
    backoff: queueConfigs[queueType]?.options?.backoff,
    removeOnComplete: queueConfigs[queueType]?.options?.removeOnComplete || false,
    removeOnFail: queueConfigs[queueType]?.options?.removeOnFail || false,
    delay: options.delay,
    priority: options.priority,
    jobId: options.jobId,
    ...options,
  };

  logger.info(`📝 Job options for ${queueType}/${jobType}:`, jobOptions);

  try {
    const job = await queue.add(jobType, {
      type: jobType,
      data,
      timestamp: new Date(),
    }, jobOptions);

    logger.info(`✅ Job added successfully: ${queueType}/${jobType} - Job ID: ${job.id}`);
    
    // Get queue status
    const counts = await queue.getJobCounts();
    logger.info(`📊 Queue ${queueType} status after add:`, counts);
    
    logger.info(`Job added: ${queueType}/${jobType} - Job ID: ${job.id}`);
    return job;
  } catch (error) {
    logger.error(`❌ Failed to add job to ${queueType}:`, error);
    throw error;
  }
};

// Add recurring job
const addRecurringJob = async (queueType, jobType, data, cronPattern) => {
  const queue = queues[queueType];
  if (!queue) {
    throw new Error(`Queue ${queueType} not found`);
  }

  const job = await queue.add(jobType, {
    type: jobType,
    data,
    recurring: true,
  }, {
    repeat: {
      pattern: cronPattern,
      tz: 'Asia/Kolkata',
    },
  });

  logger.info(`Recurring job added: ${queueType}/${jobType} - Pattern: ${cronPattern}`);
  return job;
};

// Add scheduled job
const addScheduledJob = async (queueType, jobType, data, scheduledAt) => {
  const delay = scheduledAt.getTime() - Date.now();
  if (delay < 0) {
    throw new Error('Scheduled time must be in future');
  }

  return addJob(queueType, jobType, data, { delay });
};

// Process job (utility function for services)
const processJob = async (jobType, data, options = {}) => {
  const [queueType, ...rest] = jobType.split(':');
  const actualJobType = rest.join(':') || jobType;

  return addJob(queueType || 'default', actualJobType, data, options);
};

// Get queue stats
const getQueueStats = async (queueType) => {
  const queue = queues[queueType];
  if (!queue) {
    throw new Error(`Queue ${queueType} not found`);
  }

  const counts = await queue.getJobCounts();
  
  return {
    waiting: counts.waiting || 0,
    active: counts.active || 0,
    completed: counts.completed || 0,
    failed: counts.failed || 0,
    delayed: counts.delayed || 0,
    total: (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0),
  };
};

// Get all queue stats
const getAllQueueStats = async () => {
  const stats = {};
  for (const [key, queue] of Object.entries(queues)) {
    try {
      stats[key] = await getQueueStats(key);
    } catch (error) {
      logger.error(`Error getting stats for ${key}:`, error);
      stats[key] = { error: error.message };
    }
  }
  return stats;
};

// Pause queue
const pauseQueue = async (queueType) => {
  const queue = queues[queueType];
  if (!queue) {
    throw new Error(`Queue ${queueType} not found`);
  }
  await queue.pause();
  logger.info(`Queue paused: ${queueType}`);
};

// Resume queue
const resumeQueue = async (queueType) => {
  const queue = queues[queueType];
  if (!queue) {
    throw new Error(`Queue ${queueType} not found`);
  }
  await queue.resume();
  logger.info(`Queue resumed: ${queueType}`);
};

// Clean queue
const cleanQueue = async (queueType, grace = 24 * 60 * 60 * 1000) => {
  const queue = queues[queueType];
  if (!queue) {
    throw new Error(`Queue ${queueType} not found`);
  }
  
  await queue.clean(grace);
  logger.info(`Queue cleaned: ${queueType}`);
};

// Get job
const getJob = async (queueType, jobId) => {
  const queue = queues[queueType];
  if (!queue) {
    throw new Error(`Queue ${queueType} not found`);
  }
  return queue.getJob(jobId);
};

// Remove job
const removeJob = async (queueType, jobId) => {
  const queue = queues[queueType];
  if (!queue) {
    throw new Error(`Queue ${queueType} not found`);
  }
  const job = await queue.getJob(jobId);
  if (job) {
    await job.remove();
    logger.info(`Job removed: ${queueType}/${jobId}`);
  }
};

// Close only the workers (used by app.js graceful shutdown)
const closeWorkers = async () => {
  const results = await Promise.allSettled(
    Object.entries(workers).map(([key, worker]) => worker.close()),
  );

  results.forEach((result, index) => {
    const key = Object.keys(workers)[index];
    if (result.status === 'rejected') {
      logger.error(`❌ Error closing worker ${key}:`, result.reason);
    }
  });

  logger.info('✅ All workers closed');
};

// Graceful shutdown — does NOT call process.exit(); app.js owns the lifecycle.
const gracefulShutdown = async () => {
  logger.info('🛑 Shutting down BullMQ...');

  // Close workers first so no job is left mid-flight, then queues
  await closeWorkers();

  const queueShutdownPromises = Object.entries(queues).map(async ([key, queue]) => {
    try {
      await queue.close();
      logger.info(`✅ Queue ${key} closed`);
    } catch (error) {
      logger.error(`❌ Error closing queue ${key}:`, error);
    }
  });

  await Promise.all(queueShutdownPromises);
  logger.info('✅ All queues closed');
};

// NOTE: Queue initialization is now done in app.js (after Redis connects) so
// BullMQ reuses the single shared Redis client instead of a second connection.
// Signal handling also lives in app.js to avoid double shutdown / abrupt exits.

module.exports = {
  queues,
  workers,
  initializeQueues,
  closeWorkers,
  addJob,
  addRecurringJob,
  addScheduledJob,
  processJob,
  getQueueStats,
  getAllQueueStats,
  pauseQueue,
  resumeQueue,
  cleanQueue,
  getJob,
  removeJob,
  gracefulShutdown,
};