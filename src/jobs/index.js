
const { Queue, Worker } = require('bullmq');
const logger = require('../config/logger');
const { createBullConnection } = require('../config/redis');

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
      attempts: 2,
      backoff: 10000,
    },
  },

  // The queues below are all used by real call sites but had no config here, so every
  // addJob() for them threw "Queue <name> not found" and the job was silently lost:
  //   audit (8 call sites) · vendor (4) · maintenance (3) · product (2)
  //   analytics (1) · whatsapp (1) · admin (1) · backup (1)
  'audit': {
    name: 'audit-queue',
    concurrency: 3,
    options: {
      attempts: 2,
      backoff: 10000,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    },
  },
  'vendor': {
    name: 'vendor-queue',
    concurrency: 3,
    options: {
      attempts: 3,
      backoff: 15000,
    },
  },
  'maintenance': {
    name: 'maintenance-queue',
    concurrency: 2,
    options: {
      attempts: 3,
      backoff: 30000,
    },
  },
  'product': {
    name: 'product-queue',
    concurrency: 5,
    options: {
      attempts: 3,
      backoff: 10000,
    },
  },
  'analytics': {
    name: 'analytics-queue',
    concurrency: 1,
    options: {
      attempts: 2,
      backoff: 60000,
    },
  },
  'whatsapp': {
    name: 'whatsapp-queue',
    concurrency: 3,
    options: {
      attempts: 3,
      backoff: 20000,
    },
  },
  'admin': {
    name: 'admin-queue',
    concurrency: 2,
    options: {
      attempts: 2,
      backoff: 15000,
    },
  },
  'backup': {
    name: 'backup-queue',
    concurrency: 1,
    options: {
      attempts: 1,
      backoff: 60000,
    },
  },

  // Found by scripts/test-jobs.js: these two ARE used by real call sites —
  // processJob('kyc:review-reminder') in events/user.events.js and
  // processJob('support:create-ticket') in events/rental.events.js — but had no
  // config, so addJob() logged "Queue <name> not found" and silently dropped
  // them. They now enqueue and are handled (or warned about) like the rest.
  'kyc': {
    name: 'kyc-queue',
    concurrency: 2,
    options: {
      attempts: 2,
      backoff: 30000,
    },
  },
  'support': {
    name: 'support-queue',
    concurrency: 2,
    options: {
      attempts: 2,
      backoff: 30000,
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PHYSICAL QUEUES — 4 instead of 16
//
// 16 logical queues used to mean 16 BullMQ Workers, and a Worker long-polls
// Redis whenever its queue is empty. Upstash bills PER COMMAND, so that was
// ~8M requests/month for an idle app (16 workers x 12 polls/min at the old 5s
// drainDelay) — which is what exhausted the 500k allowance.
//
// All 16 logical names still exist, so every addJob() call site is unchanged;
// they are now grouped onto 4 physical queues, so we run 4 Workers.
// ─────────────────────────────────────────────────────────────────────────────
const physicalQueueConfig = {
  messaging: { name: 'messaging-queue', concurrency: 10 },
  commerce: { name: 'commerce-queue', concurrency: 5 },
  ops: { name: 'ops-queue', concurrency: 3 },
  system: { name: 'system-queue', concurrency: 2 },
};

const QUEUE_GROUPS = {
  // messaging — user-facing comms, individually fast
  email: 'messaging',
  sms: 'messaging',
  whatsapp: 'messaging',
  notification: 'messaging',

  // commerce — money and stock movements
  payment: 'commerce',
  rental: 'commerce',
  delivery: 'commerce',
  product: 'commerce',

  // ops — back-office and vendor lifecycle
  vendor: 'ops',
  maintenance: 'ops',
  admin: 'ops',
  analytics: 'ops',
  report: 'ops',
  kyc: 'ops',
  support: 'ops',

  // system — plumbing
  audit: 'system',
  cleanup: 'system',
  backup: 'system',
  default: 'system',
};

// Queue lookups accept BOTH a logical name ('email') and a physical one
// ('messaging'), so every existing caller keeps working untouched.
const resolvePhysicalName = (queueType) =>
  physicalQueueConfig[queueType] ? queueType : QUEUE_GROUPS[queueType];

const resolveQueue = (queueType) => {
  const physical = resolvePhysicalName(queueType);
  return physical ? queues[physical] : undefined;
};

const getQueue = (queueType) => resolveQueue(queueType);

// Web processes set ENABLE_QUEUE_WORKERS=false so the API tier does ZERO queue
// polling; the standalone worker process (src/worker.js) leaves it enabled.
// Defaults to enabled so nothing changes for anyone who has not opted in.
const workersEnabled = process.env.ENABLE_QUEUE_WORKERS !== 'false';

const WORKER_OPTIONS = {
  // ── Upstash bills PER COMMAND, so idle polling is what blew the limit ──
  // drainDelay is the single biggest lever: a Worker long-polls the wait list
  // when its queue is empty, and the default is 5 SECONDS. At 120s an idle
  // worker polls 24x less often.
  drainDelay: 120, // seconds (BullMQ default: 5)
  lockDuration: 60000, // lock heartbeat every 30s instead of 15s
  stalledInterval: 120000, // stalled checks twice as rare
  maxStalledCount: 2, // one recovery attempt before failing
};

// NOTE: BullMQ gets its own connection (see initializeQueues) — it must not
// share the app client, because Worker commands BLOCK it.

// Initialize all queues (call AFTER Redis is connected — see app.js startServer)
let isInitialized = false;
const initializeQueues = () => {
  if (isInitialized) return queues;

  logger.info('🔧 Initializing BullMQ queues...');

  // BullMQ gets its OWN connection rather than borrowing the app client.
  //
  // Two reasons:
  //   1. A Worker issues BLOCKING commands. Sharing the app client meant every
  //      cache GET/SET queued behind an in-flight block, which is a large part
  //      of why some API calls felt slow.
  //   2. BullMQ requires maxRetriesPerRequest:null (never reject a queued
  //      command). That setting is actively harmful for app commands, so the
  //      two use cases get their own clients now (see config/redis.js).
  const connection = createBullConnection();

  Object.entries(physicalQueueConfig).forEach(([key, config]) => {
    try {
      // A Queue is always created (the web tier still needs to ADD jobs).
      queues[key] = new Queue(config.name, { connection });

      // Keep the event handled — an unhandled 'error' would crash the process.
      queues[key].on('error', (error) => {
        logger.debug(`Queue ${key} error: ${error?.message || error?.code || error}`);
      });

      // A Worker is NOT created when workers are disabled, so this process
      // never polls Redis. Jobs are still enqueued and picked up by the
      // dedicated worker process.
      if (!workersEnabled) return;

      workers[key] = new Worker(
        config.name,
        async (job) => {
          // The logical queue is carried in the payload, because 4 physical
          // queues now fan out to 16 different processors.
          const logical = job.data?.queueType;

          logger.info(`⚙️ Processing job from ${logical || 'unknown'} queue:`, {
            jobId: job.id,
            type: job.data?.type,
          });

          try {
            const result = await processJobByType(logical, job);
            logger.info(`✅ Job ${job.id} from ${logical || 'unknown'} completed`);
            return result;
          } catch (error) {
            logger.error(`❌ Job ${job.id} from ${logical || 'unknown'} failed:`, error);
            throw error;
          }
        },
        {
          connection,
          concurrency: config.concurrency,
          ...WORKER_OPTIONS,
        }
      );

      workers[key].on('completed', (job) => {
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

      // The listener must stay attached — an unhandled 'error' event would
      // crash the process. Debug level because the Redis client already logs
      // the same connection error once.
      workers[key].on('error', (err) => {
        logger.debug(`Worker ${key} error: ${err?.message || err?.code || err}`);
      });

      workers[key].on('stalled', (job) => {
        logger.warn(`⚠️ Job ${job.id} (${key}) stalled — will be retried`);
      });

      workers[key].on('active', (job) => {
        logger.info(`🔄 Job ${job.id} (${key}) started processing`);
      });
    } catch (error) {
      logger.error(`❌ Failed to initialize queue ${key}:`, error);
    }
  });

  // Latch only once the queues actually exist. Setting the flag up front meant
  // that any failure in here left `queues` empty for the life of the process
  // with no way to retry — which presents as every addJob() failing with
  // "Queue <name> not found".
  isInitialized = Object.keys(queues).length > 0;

  logger.info(
    `🎯 BullMQ initialized: ${Object.keys(queues).length} physical queues, ` +
      `${Object.keys(workers).length} workers (from ${Object.keys(QUEUE_GROUPS).length} logical queues)`,
  );
  return queues;
};

// Process job by type
const processJobByType = async (queueType, job) => {
  const { type, data } = job.data;

  // Jobs enqueued before this change carry no queueType; fall back to the
  // generic handler rather than guessing from the physical queue.
  const key = queueType || 'default';
  
  // console.log(`🔄 Processing ${queueType} job: ${type}`, { jobId: job.id, data });

  try {
    let result;
    switch (key) {
      case 'email': {
        const emailModule = require('./email.jobs');
        result = await emailModule.process(type, data);
        break;
      }
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
    logger.error(`❌ Error processing job ${queueType || 'default'}/${type}:`, error);
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

  // Best-effort by default.
  //
  // Queues are an enhancement, never the business operation itself. This used to
  // `throw` whenever the queue was missing or Redis was unreachable, which turned
  // already-committed work into a 500. The clearest example: POST
  // /products/admin/:id/approve saved the approval, then threw on
  // addJob('email','send',...) and answered "Something went wrong!". The admin saw an
  // error for an approval that had in fact succeeded — and the approval email was lost
  // too. 37 call sites use the email queue and 32 the notification queue, so a single
  // Redis blip took out a large slice of the API.
  //
  // Pass { required: true } when a caller genuinely must not continue without the job
  // being enqueued.
  const required = options.required === true;

  const queue = resolveQueue(queueType);

  if (!queue) {
    logger.error(
      `❌ Queue ${queueType} not found (logical names: ${Object.keys(QUEUE_GROUPS).join(', ')}) — dropped ${queueType}/${jobType}${required ? '' : ' (best-effort)'}`,
    );
    if (!required) return null;
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
    // `required` is our own control flag — keep it out of the BullMQ job options
    ...Object.fromEntries(Object.entries(options).filter(([k]) => k !== 'required')),
  };

  logger.debug(`📝 Job options for ${queueType}/${jobType}:`, jobOptions);

  try {
    const job = await queue.add(jobType, {
      type: jobType,
      data,
      timestamp: new Date(),
      // Carried in the payload so the shared worker routes to the right
      // processor — 4 physical queues fan out to 16 logical ones.
      queueType,
    }, jobOptions);

    logger.info(`✅ Job added: ${queueType}/${jobType} - Job ID: ${job.id}`);
    return job;
  } catch (error) {
    logger.error(`❌ Failed to add job to ${queueType}:`, error);
    if (!required) return null;
    throw error;
  }
};

// Add recurring job
const addRecurringJob = async (queueType, jobType, data, cronPattern) => {
  const queue = resolveQueue(queueType);
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
  const queue = resolveQueue(queueType);
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
  for (const key of Object.keys(queues)) {
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
  const queue = resolveQueue(queueType);
  if (!queue) {
    throw new Error(`Queue ${queueType} not found`);
  }
  await queue.pause();
  logger.info(`Queue paused: ${queueType}`);
};

// Resume queue
const resumeQueue = async (queueType) => {
  const queue = resolveQueue(queueType);
  if (!queue) {
    throw new Error(`Queue ${queueType} not found`);
  }
  await queue.resume();
  logger.info(`Queue resumed: ${queueType}`);
};

// Clean queue
const cleanQueue = async (queueType, grace = 24 * 60 * 60 * 1000) => {
  const queue = resolveQueue(queueType);
  if (!queue) {
    throw new Error(`Queue ${queueType} not found`);
  }
  
  await queue.clean(grace);
  logger.info(`Queue cleaned: ${queueType}`);
};

// Get job
const getJob = async (queueType, jobId) => {
  const queue = resolveQueue(queueType);
  if (!queue) {
    throw new Error(`Queue ${queueType} not found`);
  }
  return queue.getJob(jobId);
};

// Remove job
const removeJob = async (queueType, jobId) => {
  const queue = resolveQueue(queueType);
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
    Object.values(workers).map((worker) => worker.close()),
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
  QUEUE_GROUPS,
  physicalQueueConfig,
  workersEnabled,
  getQueue,
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