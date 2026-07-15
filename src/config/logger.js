const winston = require('winston');
const path = require('path');

const logDir = process.env.LOG_DIR || 'logs';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`,
  ),
);

const transports = [
  new winston.transports.Console(),
  new winston.transports.File({
    filename: path.join(logDir, 'error.log'),
    level: 'error',
    maxsize: 20 * 1024 * 1024, // 20MB
    maxFiles: 7,
  }),
  new winston.transports.File({
    filename: path.join(logDir, 'combined.log'),
    maxsize: 20 * 1024 * 1024,
    maxFiles: 7,
  }),
  new winston.transports.File({
    filename: path.join(logDir, 'http.log'),
    level: 'http',
    maxsize: 20 * 1024 * 1024,
    maxFiles: 7,
  }),
];

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format,
  transports,
});

module.exports = logger;