// ====================================
// DEPENDENCIES
// ====================================
const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const session = require('express-session');
const {MongoStore} = require('connect-mongo');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const fs = require('fs');

// ====================================
// LOCAL IMPORTS
// ====================================
const config = require('./config/env');
const logger = require('./config/logger');
const connectDB = require('./config/database');
const { connectRedis } = require('./config/redis');
const { initElasticsearch } = require('./config/elasticsearch');
const { initializeSocket } = require('./socket');
// const { setupAssociations } = require('./models');
const { errorHandler, notFound } = require('./api/middlewares/errorHandler.middleware');
const { apiLimiter, authLimiter } = require('./api/middlewares/rateLimiter.middleware');
const { eventEmitter, EVENTS } = require('./events');
const { queues } = require('./jobs');

// Import routes
const routes = require('./api/routes');

const { cacheResponse } = require('./api/middlewares/cache.middleware');

// ====================================
// INITIALIZE EXPRESS APP
// ====================================
const app = express();
const server = http.createServer(app);

// ====================================
// SECURITY MIDDLEWARE
// ====================================

// Set security HTTP headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// Enable CORS
app.use(cors({
  origin: config.CORS_ORIGIN.split(','),
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
}));

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Data sanitization against NoSQL query injection
app.use(
  mongoSanitize(),
);

// app.use(cacheResponse());

// Data sanitization against XSS
app.use(xss());

// Prevent parameter pollution
app.use(hpp({
  whitelist: [
    'price',
    'rating',
    'duration',
    'page',
    'limit',
    'sort',
    'fields',
  ],
}));

// Compression middleware
// app.use(compression());

// ====================================
// STATIC FILES
// ====================================
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// ====================================
// LOGGING MIDDLEWARE
// ====================================
if (config.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    skip: (req, res) => res.statusCode < 400,
    stream: { write: (message) => logger.info(message.trim()) },
  }));
}


// app.js or server.js
app.use((err, req, res, next) => {
  console.error(err.stack);
  
  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: err.errors
    });
  }
  
  // Default error response
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});
// ====================================
// RATE LIMITING
// ====================================
// Apply rate limiting to all routes
app.use('/api', apiLimiter);

// Stricter rate limiting for auth routes
app.use('/api/v1/auth', authLimiter);

// ====================================
// SESSION CONFIGURATION
// ====================================
app.use(session({
  secret: config.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,

  store: MongoStore.create({
    mongoUrl: config.MONGODB_URI,
    ttl: 24 * 60 * 60, // 1 day
    autoRemove: 'native',
    collectionName: 'sessions',
    touchAfter: 24 * 3600
  }),

  cookie: {
    secure: config.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: config.NODE_ENV === 'production' ? 'strict' : 'lax'
  }
}));

// ====================================
// REQUEST ID MIDDLEWARE
// ====================================
app.use((req, res, next) => {
  req.id = require('crypto').randomBytes(16).toString('hex');
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ====================================
// HEALTH CHECK ENDPOINT
// ====================================
app.get('/health', (req, res) => {
  const healthcheck = {
    uptime: process.uptime(),
    message: 'OK',
    timestamp: Date.now(),
    environment: config.NODE_ENV,
    services: {
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      redis: global.redisClient ? 'connected' : 'disconnected',
      elasticsearch: global.esClient ? 'connected' : 'disconnected',
    },
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
  };

  try {
    res.status(200).json(healthcheck);
  } catch (error) {
    healthcheck.message = error;
    res.status(503).json(healthcheck);
  }
});

// ====================================
// API DOCUMENTATION (Swagger)
// ====================================
if (config.NODE_ENV !== 'production') {
  try {
    const swaggerDocument = YAML.load(
      path.join(__dirname, 'docs', 'swagger.yaml')
    );

    app.use(
      '/api-docs',
      swaggerUi.serve,
      swaggerUi.setup(swaggerDocument, {
        explorer: true,
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'RentEase API Documentation',
      })
    );

    logger.info('✅ Swagger docs available at /api-docs');
  } catch (error) {
    logger.warn(`Swagger documentation not available: ${error.message}`);
  }
}

// ====================================
// API ROUTES
// ====================================
app.use('/api/v1', routes);

// ====================================
// ERROR HANDLING MIDDLEWARE
// ====================================
// 404 handler
app.use(notFound);

// Global error handler
app.use(errorHandler);

// ====================================
// UNHANDLED REJECTIONS/EXCEPTIONS
// ====================================
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application continues running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌❌❌ UNHANDLED REJECTION ❌❌❌');
  console.error('Reason:', reason);
  console.error('Reason stack:', reason?.stack);
  console.error('Promise:', promise);
  
  // Log to file as well
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  
  // Don't exit, but log details
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // Gracefully shutdown
  gracefulShutdown('UNCAUGHT EXCEPTION');
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received');
  gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received');
  gracefulShutdown('SIGINT');
});

// ====================================
// GRACEFUL SHUTDOWN
// ====================================
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} - Starting graceful shutdown...`);

  try {
    // Stop accepting new requests
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // Close socket connections
    if (global.io) {
      await new Promise((resolve) => {
        global.io.close(() => {
          logger.info('Socket.io server closed');
          resolve();
        });
      });
    }

    // Close database connection
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');

    // Close Redis connection
    if (global.redisClient) {
      await global.redisClient.quit();
      logger.info('Redis connection closed');
    }

    // Close Elasticsearch connection
    if (global.esClient) {
      // Elasticsearch client doesn't have a close method
      logger.info('Elasticsearch connection closed');
    }

    // Wait for all jobs to complete (with timeout)
    await Promise.race([
      Promise.all(Object.values(queues).map(queue => queue.close())),
      new Promise(resolve => setTimeout(resolve, 10000)), // 10 second timeout
    ]);
    logger.info('All queues closed');

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// ====================================
// START SERVER FUNCTION
// ====================================
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    logger.info('✅ MongoDB connected successfully');

    // Setup model associations
    // setupAssociations();
    // logger.info('✅ Model associations setup completed');

    // Connect to Redis
    const redisClient = await connectRedis();
    if (redisClient) {
      global.redisClient = redisClient;
      logger.info('✅ Redis connected successfully');
    } else {
      logger.warn('⚠️ Redis connection failed - running without Redis');
    }

    // Connect to Elasticsearch
    // const esClient = await initElasticsearch();
    // if (esClient) {
    //   global.esClient = esClient;
    //   logger.info('✅ Elasticsearch connected successfully');
    // } else {
    //   logger.warn('⚠️ Elasticsearch connection failed - running without Elasticsearch');
    // }

    // Initialize Socket.io
    const io = initializeSocket(server);
    global.io = io;
    logger.info('✅ Socket.io initialized successfully');

    // Log event emitter events in development
    if (config.NODE_ENV === 'development') {
      // eventEmitter.onAny((event, data) => {
      //   logger.debug(`Event emitted: ${event}`, data);
      // });
    }

    // Start server
    server.listen(config.PORT, () => {
      logger.info(`
      =====================================
      🚀 RentEase Server Started!
      =====================================
      Environment: ${config.NODE_ENV}
      Port: ${config.PORT}
      API URL: http://localhost:${config.PORT}/api/v1
      Health Check: http://localhost:${config.PORT}/health
      Socket.io: ws://localhost:${config.PORT}
      =====================================
      Database: ${mongoose.connection.host}
      Redis: ${config.REDIS_HOST}:${config.REDIS_PORT}
      =====================================
      `);
    });

    // Emit server started event
    eventEmitter.emit(EVENTS.SYSTEM.INFO, {
      type: 'server_started',
      timestamp: new Date(),
      environment: config.NODE_ENV,
      port: config.PORT,
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// ====================================
// INITIALIZE DATABASE INDEXES (Optional)
// ====================================
const createIndexes = async () => {
  if (config.NODE_ENV === 'production') {
    try {
      logger.info('Creating database indexes...');
      const { setupIndexes } = require('./models');
      await setupIndexes();
      logger.info('✅ Database indexes created successfully');
    } catch (error) {
      logger.error('Error creating indexes:', error);
    }
  }
};

// ====================================
// START THE SERVER
// ====================================
// if (require.main === module) {
//   startServer();
//   createIndexes();
// }

startServer();
createIndexes();

// ====================================
// EXPORT FOR TESTING
// ====================================
module.exports = { app, server };