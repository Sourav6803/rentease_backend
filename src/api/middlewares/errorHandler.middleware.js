const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const { getRedisClient } = require('../../config/redis');

// Handle different types of errors
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
  const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new AppError(message, 400);
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map(el => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 400, errors);
};

const handleJWTError = () => new AppError('Invalid token. Please log in again!', 401);
const handleJWTExpiredError = () => new AppError('Your token has expired! Please log in again.', 401);
const handleRateLimitError = () => new AppError('Too many requests, please try again later.', 429);

// Send error response for development - FIXED: Don't try to render views
const sendErrorDev = (err, req, res) => {
  // Log error
  logger.error(err);

  // API error response (always return JSON, never try to render)
  return res.status(err.statusCode).json({
    success: false,
    error: {
      message: err.message,
      statusCode: err.statusCode,
      status: err.status,
      errors: err.errors,
      stack: err.stack,
    },
    message: err.message,
    timestamp: new Date().toISOString(),
  });
};

// Send error response for production
const sendErrorProd = async (err, req, res) => {
  // Log error to file and monitoring service
  logger.error(err);

  // Store error in Redis for analytics (if needed)
  try {
    const redisClient = getRedisClient();
    if (redisClient) {
      const key = `error:${Date.now()}`;
      await redisClient.setex(key, 86400, JSON.stringify({
        message: err.message,
        statusCode: err.statusCode,
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
      }));
    }
  } catch (redisError) {
    // Ignore Redis errors
  }

  // Always return JSON response, never try to render views
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors: err.errors,
      timestamp: new Date().toISOString(),
    });
  }

  // Programming or other unknown error: don't leak error details
  return res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    timestamp: new Date().toISOString(),
  });
};

// Main error handler middleware
const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Add request context to error - FIXED: Don't try to modify req.query
  const errorContext = {
    method: req.method,
    url: req.url,
    ip: req.ip,
    user: req.user?._id,
    timestamp: new Date().toISOString()
  };

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, req, res);
  } else {
    let error = { ...err };
    error.message = err.message;
    error.errors = err.errors;

    // Handle specific MongoDB errors
    if (error.name === 'CastError') error = handleCastErrorDB(error);
    if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    if (error.name === 'ValidationError') error = handleValidationErrorDB(error);
    if (error.name === 'JsonWebTokenError') error = handleJWTError();
    if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();
    if (error.name === 'RateLimitError') error = handleRateLimitError();

    sendErrorProd(error, req, res);
  }
};

// 404 handler
const notFound = (req, res, next) => {
  const error = new AppError(`Can't find ${req.originalUrl} on this server!`, 404);
  next(error);
};

// Async error wrapper
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

// Unhandled rejection handler
const handleUnhandledRejection = (server) => {
  process.on('unhandledRejection', (err) => {
    logger.error('UNHANDLED REJECTION! 💥 Shutting down...');
    logger.error(err.name, err.message);
    server.close(() => {
      process.exit(1);
    });
  });
};

// Uncaught exception handler
const handleUncaughtException = () => {
  process.on('uncaughtException', (err) => {
    logger.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
    logger.error(err.name, err.message);
    process.exit(1);
  });
};

module.exports = {
  errorHandler,
  notFound,
  catchAsync,
  handleUnhandledRejection,
  handleUncaughtException
};