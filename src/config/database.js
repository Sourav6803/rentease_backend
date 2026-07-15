const mongoose = require('mongoose');
const logger = require('./logger');

const connectDB = async () => {
  console.log("hello form database.js")
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE) || 100,
      minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE) || 10,
      socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT_MS) || 45000,
      connectTimeoutMS: parseInt(process.env.MONGODB_CONNECTION_TIMEOUT_MS) || 30000,
      serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS) || 5000,
      retryWrites: true,
      retryReads: true
    });

    logger.info(`MongoDB Connected: ${conn.connection.host}`);

    // Handle connection events
    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
    });

    return conn;
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

module.exports = connectDB;