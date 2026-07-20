// // const Bull = require('bull');
// const {Queue} = require('bullmq');
// const logger = require('../config/logger');
// const { getRedisClient } = require('../config/redis');

// // Job queues
// const queues = {};

// // Queue configurations
// const queueConfigs = {
//   // Email jobs
//   'email': {
//     name: 'email-queue',
//     concurrency: 5,
//     options: {
//       attempts: 3,
//       backoff: {
//         type: 'exponential',
//         delay: 60000, // 1 minute
//       },
//       removeOnComplete: 100, // Keep last 100 completed jobs
//       removeOnFail: 500, // Keep last 500 failed jobs
//     },
//   },
  
//   // SMS jobs
//   'sms': {
//     name: 'sms-queue',
//     concurrency: 3,
//     options: {
//       attempts: 3,
//       backoff: 2000,
//       removeOnComplete: true,
//     },
//   },
  
//   // Notification jobs
//   'notification': {
//     name: 'notification-queue',
//     concurrency: 10,
//     options: {
//       attempts: 3,
//       backoff: 5000,
//     },
//   },
  
//   // Payment jobs
//   'payment': {
//     name: 'payment-queue',
//     concurrency: 2,
//     options: {
//       attempts: 5,
//       backoff: {
//         type: 'exponential',
//         delay: 30000,
//       },
//     },
//   },
  
//   // Rental jobs
//   'rental': {
//     name: 'rental-queue',
//     concurrency: 3,
//     options: {
//       attempts: 3,
//       backoff: 60000,
//     },
//   },
  
//   // Delivery jobs
//   'delivery': {
//     name: 'delivery-queue',
//     concurrency: 2,
//     options: {
//       attempts: 3,
//       backoff: 30000,
//     },
//   },
  
//   // Report generation jobs
//   'report': {
//     name: 'report-queue',
//     concurrency: 1,
//     options: {
//       attempts: 2,
//       backoff: 60000,
//     },
//   },
  
//   // Cleanup jobs
//   'cleanup': {
//     name: 'cleanup-queue',
//     concurrency: 1,
//     options: {
//       attempts: 1,
//       repeat: {
//         cron: '0 0 * * *', // Daily at midnight
//       },
//     },
//   },
  
//   // Default queue for misc jobs
//   'default': {
//     name: 'default-queue',
//     concurrency: 5,
//     options: {
//       attempts: 2,
//       backoff: 10000,
//     },
//   },
// };

// // Initialize all queues
// // const initializeQueues = () => {
// //   const redisConfig = process.env.REDIS_URL
// //     ? { redis: process.env.REDIS_URL }
// //     : {
// //         redis: {
// //           host: process.env.REDIS_HOST || 'localhost',
// //           port: parseInt(process.env.REDIS_PORT) || 6379,
// //           password: process.env.REDIS_PASSWORD,
// //           db: parseInt(process.env.REDIS_DB) || 0,
// //           tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
// //         },
// //       };

// //   Object.entries(queueConfigs).forEach(([key, config]) => {
// //     queues[key] = new Bull(config.name, redisConfig);
    
// //     // Set default job options
// //     // queues[key].defaultJobOptions = config.options;
// //     queues[key] = new Bull(config.name, {
// //     ...redisConfig,
// //     defaultJobOptions: config.options,
// // });
    
// //     // Set concurrency
// //     queues[key].process(config.concurrency, (job) => {
// //       return processJobByType(key, job);
// //     });

// //     // Event handlers
// //     queues[key].on('completed', (job, result) => {
// //       logger.info(`Job ${job.id} (${key}) completed successfully`);
// //     });

// //     queues[key].on('failed', (job, error) => {
// //       logger.error(`Job ${job.id} (${key}) failed:`, error);
// //     });

// //     queues[key].on('stalled', (job) => {
// //       logger.warn(`Job ${job.id} (${key}) stalled`);
// //     });

// //     logger.info(`Queue initialized: ${key}`);
// //   });

// //   return queues;
// // };

// // Process job by type


// const initializeQueues = () => {
//   const redisConfig = process.env.REDIS_URL
//     ? { redis: process.env.REDIS_URL }
//     : {
//         redis: {
//           host: process.env.REDIS_HOST || 'localhost',
//           port: parseInt(process.env.REDIS_PORT) || 6379,
//           password: process.env.REDIS_PASSWORD,
//           db: parseInt(process.env.REDIS_DB) || 0,
//           tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
//         },
//       };

//   Object.entries(queueConfigs).forEach(([key, config]) => {
//     // Create queue with default job options in one go
//     queues[key] = new Queue(config.name, {
//       ...redisConfig,
//       defaultJobOptions: config.options,
//     });
    
//     // Set concurrency and processor
//     queues[key].process(config.concurrency, (job) => {
//       return processJobByType(key, job);
//     });

//     // Event handlers
//     queues[key].on('completed', (job, result) => {
//       logger.info(`Job ${job.id} (${key}) completed successfully`);
//     });

//     queues[key].on('failed', (job, error) => {
//       logger.error(`Job ${job.id} (${key}) failed:`, error);
//     });

//     queues[key].on('stalled', (job) => {
//       logger.warn(`Job ${job.id} (${key}) stalled`);
//     });

//     logger.info(`Queue initialized: ${key}`);
//   });

//   return queues;
// };

// const processJobByType = async (queueType, job) => {
//   const { type, data } = job.data;
  
//   logger.debug(`Processing ${queueType} job: ${type}`, { jobId: job.id, data });

//   try {
//     switch (queueType) {
//       case 'email':
//         return await require('./email.jobs').process(type, data);
//       case 'sms':
//         return await require('./sms.jobs').process(type, data);
//       case 'notification':
//         return await require('./notification.jobs').process(type, data);
//       case 'payment':
//         return await require('./payment.jobs').process(type, data);
//       case 'rental':
//         return await require('./rental.jobs').process(type, data);
//       case 'delivery':
//         return await require('./delivery.jobs').process(type, data);
//       case 'report':
//         return await require('./report.jobs').process(type, data);
//       case 'cleanup':
//         return await require('./cleanup.jobs').process(type, data);
//       default:
//         return await require('./default.jobs').process(type, data);
//     }
//   } catch (error) {
//     logger.error(`Error processing job ${queueType}/${type}:`, error);
//     throw error;
//   }
// };

// // Add job to queue
// const addJob = async (queueType, jobType, data, options = {}) => {
//   const queue = queues[queueType];
  
//   if (!queue) {
//     throw new Error(`Queue ${queueType} not found`);
//   }

//   const jobOptions = {
//     attempts: queueConfigs[queueType]?.options?.attempts || 3,
//     backoff: queueConfigs[queueType]?.options?.backoff,
//     removeOnComplete: queueConfigs[queueType]?.options?.removeOnComplete || false,
//     removeOnFail: queueConfigs[queueType]?.options?.removeOnFail || false,
//     delay: options.delay,
//     priority: options.priority,
//     jobId: options.jobId,
//     ...options,
//   };

//   console.log(`Adding job to queue: ${queueType}/${jobType}`, { data, options: jobOptions })

//   const job = await queue.add(
//     { type: jobType, data, timestamp: new Date() },
//     jobOptions
//   );

//   console.log(`Job added: ${queueType}/${jobType} - Job ID: ${job.id}`)

//   logger.info(`Job added: ${queueType}/${jobType} - Job ID: ${job.id}`);
//   return job;
// };

// // Add recurring job
// const addRecurringJob = async (queueType, jobType, data, cronPattern) => {
//   const queue = queues[queueType];
//   if (!queue) {
//     throw new Error(`Queue ${queueType} not found`);
//   }

//   const job = await queue.add(
//     { type: jobType, data, recurring: true },
//     {
//       repeat: {
//         cron: cronPattern,
//         tz: 'Asia/Kolkata',
//       },
//     }
//   );

//   logger.info(`Recurring job added: ${queueType}/${jobType} - Pattern: ${cronPattern}`);
//   return job;
// };

// // Add scheduled job
// const addScheduledJob = async (queueType, jobType, data, scheduledAt) => {
//   const delay = scheduledAt.getTime() - Date.now();
//   if (delay < 0) {
//     throw new Error('Scheduled time must be in future');
//   }

//   return addJob(queueType, jobType, data, { delay });
// };

// // Process job (utility function for services)
// const processJob = async (jobType, data, options = {}) => {
//   const [queueType, ...rest] = jobType.split(':');
//   const actualJobType = rest.join(':') || jobType;

//   return addJob(queueType || 'default', actualJobType, data, options);
// };

// // Get queue stats
// const getQueueStats = async (queueType) => {
//   const queue = queues[queueType];
//   if (!queue) {
//     throw new Error(`Queue ${queueType} not found`);
//   }

//   const [waiting, active, completed, failed, delayed] = await Promise.all([
//     queue.getWaitingCount(),
//     queue.getActiveCount(),
//     queue.getCompletedCount(),
//     queue.getFailedCount(),
//     queue.getDelayedCount(),
//   ]);

//   return {
//     waiting,
//     active,
//     completed,
//     failed,
//     delayed,
//     total: waiting + active + delayed,
//   };
// };

// // Get all queue stats
// const getAllQueueStats = async () => {
//   const stats = {};
//   for (const [key, queue] of Object.entries(queues)) {
//     stats[key] = await getQueueStats(key);
//   }
//   return stats;
// };

// // Pause queue
// const pauseQueue = async (queueType) => {
//   const queue = queues[queueType];
//   if (!queue) {
//     throw new Error(`Queue ${queueType} not found`);
//   }
//   await queue.pause();
//   logger.info(`Queue paused: ${queueType}`);
// };

// // Resume queue
// const resumeQueue = async (queueType) => {
//   const queue = queues[queueType];
//   if (!queue) {
//     throw new Error(`Queue ${queueType} not found`);
//   }
//   await queue.resume();
//   logger.info(`Queue resumed: ${queueType}`);
// };

// // Clean queue
// const cleanQueue = async (queueType, grace = 24 * 60 * 60 * 1000) => {
//   const queue = queues[queueType];
//   if (!queue) {
//     throw new Error(`Queue ${queueType} not found`);
//   }
  
//   await queue.clean(grace);
//   logger.info(`Queue cleaned: ${queueType}`);
// };

// // Get job
// const getJob = async (queueType, jobId) => {
//   const queue = queues[queueType];
//   if (!queue) {
//     throw new Error(`Queue ${queueType} not found`);
//   }
//   return queue.getJob(jobId);
// };

// // Remove job
// const removeJob = async (queueType, jobId) => {
//   const queue = queues[queueType];
//   if (!queue) {
//     throw new Error(`Queue ${queueType} not found`);
//   }
//   const job = await queue.getJob(jobId);
//   if (job) {
//     await job.remove();
//     logger.info(`Job removed: ${queueType}/${jobId}`);
//   }
// };

// // Initialize all queues
// const queues_initialized = initializeQueues();

// module.exports = {
//   queues: queues_initialized,
//   addJob,
//   addRecurringJob,
//   addScheduledJob,
//   processJob,
//   getQueueStats,
//   getAllQueueStats,
//   pauseQueue,
//   resumeQueue,
//   cleanQueue,
//   getJob,
//   removeJob,
// };




const { Queue, Worker } = require('bullmq');
const logger = require('../config/logger');
const Redis = require('ioredis');

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

// Create Redis connection
const createRedisConnection = () => {
  // console.log('🔧 Creating Redis connection for BullMQ...');
  
  if (process.env.REDIS_URL) {
    // For Upstash or any Redis URL
    const url = new URL(process.env.REDIS_URL);
    const config = {
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      password: url.password,
      tls: url.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 10000,
      retryStrategy: (times) => {
        const delay = Math.min(times * 100, 3000);
        console.log(`🔄 Redis retry attempt ${times} with delay ${delay}ms`);
        return delay;
      },
    };
    
    // console.log('📡 Redis config (from URL):', {
    //   host: config.host,
    //   port: config.port,
    //   tls: !!config.tls,
    // });
    
    return new Redis(config);
  }
  
  // Local Redis config
  const config = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB) || 0,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10000,
    retryStrategy: (times) => {
      const delay = Math.min(times * 100, 3000);
      console.log(`🔄 Redis retry attempt ${times} with delay ${delay}ms`);
      return delay;
    },
  };
  
  // console.log('📡 Redis config:', {
  //   host: config.host,
  //   port: config.port,
  //   tls: !!config.tls,
  // });
  
  return new Redis(config);
};

// Initialize all queues
const initializeQueues = () => {
  // console.log('🔧 Initializing BullMQ queues...');
  
  const connection = createRedisConnection();

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
          console.log(`⚙️ Processing job from ${key} queue:`, {
            jobId: job.id,
            type: job.data.type,
            data: job.data.data,
          });
          
          try {
            const result = await processJobByType(key, job);
            console.log(`✅ Job ${job.id} from ${key} completed`);
            return result;
          } catch (error) {
            console.error(`❌ Job ${job.id} from ${key} failed:`, error);
            throw error;
          }
        },
        {
          connection,
          concurrency: config.concurrency,
        }
      );

      // Worker event handlers
      workers[key].on('completed', (job, result) => {
        // console.log(`✅ Job ${job.id} (${key}) completed successfully`);
        // logger.info(`Job ${job.id} (${key}) completed successfully`);
      });

      workers[key].on('failed', (job, error) => {
        console.error(`❌ Job ${job.id} (${key}) failed:`, {
          error: error.message,
          data: job?.data,
        });
        logger.error(`Job ${job.id} (${key}) failed:`, error);
      });

      workers[key].on('stalled', (job) => {
        // console.warn(`⚠️ Job ${job.id} (${key}) stalled`);
        // logger.warn(`Job ${job.id} (${key}) stalled`);
      });

      workers[key].on('active', (job) => {
        console.log(`🔄 Job ${job.id} (${key}) started processing`);
      });

      workers[key].on('progress', (job, progress) => {
        // console.log(`📊 Job ${job.id} (${key}) progress: ${progress}%`);
      });

      // Queue event handlers
      queues[key].on('error', (error) => {
        // console.error(`🔴 Queue ${key} error:`, error.message);
      });

      // console.log(`✅ Queue initialized: ${key}`);
    } catch (error) {
      console.error(`❌ Failed to initialize queue ${key}:`, error);
    }
  });

  console.log('🎯 All BullMQ queues initialized successfully!');
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
        console.log('📧 Loading email jobs module');
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
    console.error(`❌ Error processing job ${queueType}/${type}:`, error);
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
    console.error(`❌ Queue ${queueType} not found! Available queues:`, Object.keys(queues));
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

  console.log(`📝 Job options for ${queueType}/${jobType}:`, jobOptions);

  try {
    const job = await queue.add(jobType, {
      type: jobType,
      data,
      timestamp: new Date(),
    }, jobOptions);

    console.log(`✅ Job added successfully: ${queueType}/${jobType} - Job ID: ${job.id}`);
    
    // Get queue status
    const counts = await queue.getJobCounts();
    console.log(`📊 Queue ${queueType} status after add:`, counts);
    
    logger.info(`Job added: ${queueType}/${jobType} - Job ID: ${job.id}`);
    return job;
  } catch (error) {
    console.error(`❌ Failed to add job to ${queueType}:`, error);
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
      console.error(`Error getting stats for ${key}:`, error);
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

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('🛑 Shutting down gracefully...');
  
  // Close all workers
  const workerShutdownPromises = Object.entries(workers).map(async ([key, worker]) => {
    try {
      console.log(`🔄 Closing worker ${key}...`);
      await worker.close();
      console.log(`✅ Worker ${key} closed`);
    } catch (error) {
      console.error(`❌ Error closing worker ${key}:`, error);
    }
  });
  
  // Close all queues
  const queueShutdownPromises = Object.entries(queues).map(async ([key, queue]) => {
    try {
      console.log(`🔄 Closing queue ${key}...`);
      await queue.close();
      console.log(`✅ Queue ${key} closed`);
    } catch (error) {
      console.error(`❌ Error closing queue ${key}:`, error);
    }
  });
  
  await Promise.all([...workerShutdownPromises, ...queueShutdownPromises]);
  console.log('✅ All queues and workers closed');
  process.exit(0);
};

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Initialize all queues
console.log('🚀 Starting BullMQ queue initialization...');
const queues_initialized = initializeQueues();

// Check Redis connection
// setTimeout(async () => {
//   try {
//     const stats = await getAllQueueStats();
//     // console.log('📊 Initial queue stats:', stats);
//   } catch (error) {
//     console.error('❌ Error getting initial stats:', error);
//   }
// }, 2000);

module.exports = {
  queues: queues_initialized,
  workers,
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