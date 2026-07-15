
class AppError extends Error {
  constructor(message, statusCode, errors = null, isOperational = true) {
    super(message);
    
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = isOperational;
    this.errors = errors;
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Create 400 Bad Request error
   */
  static badRequest(message = 'Bad request', errors = null) {
    return new AppError(message, 400, errors);
  }

  /**
   * Create 401 Unauthorized error
   */
  static unauthorized(message = 'Unauthorized access') {
    return new AppError(message, 401);
  }

  /**
   * Create 403 Forbidden error
   */
  static forbidden(message = 'Forbidden access') {
    return new AppError(message, 403);
  }

  /**
   * Create 404 Not Found error
   */
  static notFound(message = 'Resource not found') {
    return new AppError(message, 404);
  }

  /**
   * Create 409 Conflict error
   */
  static conflict(message = 'Resource conflict') {
    return new AppError(message, 409);
  }

  /**
   * Create 422 Unprocessable Entity error
   */
  static unprocessableEntity(message = 'Validation failed', errors = null) {
    return new AppError(message, 422, errors);
  }

  /**
   * Create 429 Too Many Requests error
   */
  static tooManyRequests(message = 'Too many requests') {
    return new AppError(message, 429);
  }

  /**
   * Create 500 Internal Server error
   */
  static internal(message = 'Internal server error') {
    return new AppError(message, 500, null, false);
  }

  /**
   * Create 503 Service Unavailable error
   */
  static serviceUnavailable(message = 'Service temporarily unavailable') {
    return new AppError(message, 503, null, false);
  }

  /**
   * Convert to JSON for logging
   */
  toJSON() {
    return {
      message: this.message,
      statusCode: this.statusCode,
      status: this.status,
      errors: this.errors,
      isOperational: this.isOperational,
      stack: this.stack
    };
  }
}

module.exports = AppError;