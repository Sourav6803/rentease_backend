const Bull = require('bull');
const logger = require('../config/logger');
const { getRedisClient } = require('../config/redis');

// Job queues
const queues = {};

// Queue configurations
const queueConfigs = {
  // Email jobs
  'email': {
    name: 'email-queue',
    concurrency: 5,
    options: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 60000, // 1 minute
      },
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 500, // Keep last 500 failed jobs
    },
  },
  
  // SMS jobs
  'sms': {
    name: 'sms-queue',
    concurrency: 3,
    options: {
      attempts: 3,
      backoff: 2000,
      removeOnComplete: true,
    },
  },
  
  // Notification jobs
  'notification': {
    name: 'notification-queue',
    concurrency: 10,
    options: {
      attempts: 3,
      backoff: 5000,
    },
  },
  
  // Payment jobs
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
  
  // Rental jobs
  'rental': {
    name: 'rental-queue',
    concurrency: 3,
    options: {
      attempts: 3,
      backoff: 60000,
    },
  },
  
  // Delivery jobs
  'delivery': {
    name: 'delivery-queue',
    concurrency: 2,
    options: {
      attempts: 3,
      backoff: 30000,
    },
  },
  
  // Report generation jobs
  'report': {
    name: 'report-queue',
    concurrency: 1,
    options: {
      attempts: 2,
      backoff: 60000,
    },
  },
  
  // Cleanup jobs
  'cleanup': {
    name: 'cleanup-queue',
    concurrency: 1,
    options: {
      attempts: 1,
      repeat: {
        cron: '0 0 * * *', // Daily at midnight
      },
    },
  },
  
  // Default queue for misc jobs
  'default': {
    name: 'default-queue',
    concurrency: 5,
    options: {
      attempts: 2,
      backoff: 10000,
    },
  },
};

// Initialize all queues
const initializeQueues = () => {
  const redisConfig = {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB) || 0,
    },
  };

  Object.entries(queueConfigs).forEach(([key, config]) => {
    queues[key] = new Bull(config.name, redisConfig);
    
    // Set default job options
    queues[key].defaultJobOptions = config.options;
    
    // Set concurrency
    queues[key].process(config.concurrency, (job) => {
      return processJobByType(key, job);
    });

    // Event handlers
    queues[key].on('completed', (job, result) => {
      logger.info(`Job ${job.id} (${key}) completed successfully`);
    });

    queues[key].on('failed', (job, error) => {
      logger.error(`Job ${job.id} (${key}) failed:`, error);
    });

    queues[key].on('stalled', (job) => {
      logger.warn(`Job ${job.id} (${key}) stalled`);
    });

    logger.info(`Queue initialized: ${key}`);
  });

  return queues;
};

// Process job by type
const processJobByType = async (queueType, job) => {
  const { type, data } = job.data;
  
  logger.debug(`Processing ${queueType} job: ${type}`, { jobId: job.id, data });

  try {
    switch (queueType) {
      case 'email':
        return await require('./email.jobs').process(type, data);
      case 'sms':
        return await require('./sms.jobs').process(type, data);
      case 'notification':
        return await require('./notification.jobs').process(type, data);
      case 'payment':
        return await require('./payment.jobs').process(type, data);
      case 'rental':
        return await require('./rental.jobs').process(type, data);
      case 'delivery':
        return await require('./delivery.jobs').process(type, data);
      case 'report':
        return await require('./report.jobs').process(type, data);
      case 'cleanup':
        return await require('./cleanup.jobs').process(type, data);
      default:
        return await require('./default.jobs').process(type, data);
    }
  } catch (error) {
    logger.error(`Error processing job ${queueType}/${type}:`, error);
    throw error;
  }
};

// Add job to queue
const addJob = async (queueType, jobType, data, options = {}) => {
  const queue = queues[queueType];
  if (!queue) {
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

  const job = await queue.add(
    { type: jobType, data, timestamp: new Date() },
    jobOptions
  );

  logger.info(`Job added: ${queueType}/${jobType} - Job ID: ${job.id}`);
  return job;
};

// Add recurring job
const addRecurringJob = async (queueType, jobType, data, cronPattern) => {
  const queue = queues[queueType];
  if (!queue) {
    throw new Error(`Queue ${queueType} not found`);
  }

  const job = await queue.add(
    { type: jobType, data, recurring: true },
    {
      repeat: {
        cron: cronPattern,
        tz: 'Asia/Kolkata',
      },
    }
  );

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

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + delayed,
  };
};

// Get all queue stats
const getAllQueueStats = async () => {
  const stats = {};
  for (const [key, queue] of Object.entries(queues)) {
    stats[key] = await getQueueStats(key);
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

// Initialize all queues
const queues_initialized = initializeQueues();

module.exports = {
  queues: queues_initialized,
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
};