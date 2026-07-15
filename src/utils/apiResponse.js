/**
 * Standard API response formatter
 */
class ApiResponse {
  /**
   * Success response
   */
  static success(res, statusCode = 200, message = 'Success', data = null, meta = null) {
    const response = {
      success: true,
      message,
      timestamp: new Date().toISOString(),
    };

    if (data !== null) response.data = data;
    if (meta !== null) response.meta = meta;

    return res.status(statusCode).json(response);
  }

  /**
   * Error response
   */
  static error(res, statusCode = 500, message = 'Error', errors = null) {
    const response = {
      success: false,
      message,
      timestamp: new Date().toISOString(),
    };

    if (errors !== null) response.errors = errors;

    return res.status(statusCode).json(response);
  }

  /**
   * Created response (201)
   */
  static created(res, message = 'Resource created successfully', data = null) {
    return this.success(res, 201, message, data);
  }

  /**
   * No content response (204)
   */
  static noContent(res) {
    return res.status(204).send();
  }

  /**
   * Paginated response
   */
  static paginated(res, data, page, limit, total, message = 'Success') {
    const totalPages = Math.ceil(total / limit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;

    const meta = {
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages,
        hasNext,
        hasPrev,
        nextPage: hasNext ? page + 1 : null,
        prevPage: hasPrev ? page - 1 : null,
      },
      timestamp: new Date().toISOString(),
    };

    return this.success(res, 200, message, data, meta);
  }

  /**
   * List response with metadata
   */
  static list(res, data, total = null, message = 'Success') {
    const meta = {
      count: Array.isArray(data) ? data.length : 0,
      timestamp: new Date().toISOString(),
    };

    if (total !== null) meta.total = total;

    return this.success(res, 200, message, data, meta);
  }

  /**
   * Download file response
   */
  static download(res, filePath, fileName) {
    return res.download(filePath, fileName);
  }

  /**
   * File response
   */
  static file(res, fileData, contentType, fileName) {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(fileData);
  }

  /**
   * Stream response
   */
  static stream(res, stream, contentType) {
    res.setHeader('Content-Type', contentType);
    return stream.pipe(res);
  }

  /**
   * Validation error response
   */
  static validationError(res, errors) {
    return this.error(res, 422, 'Validation failed', errors);
  }

  /**
   * Unauthorized response
   */
  static unauthorized(res, message = 'Unauthorized access') {
    return this.error(res, 401, message);
  }

  /**
   * Forbidden response
   */
  static forbidden(res, message = 'Forbidden access') {
    return this.error(res, 403, message);
  }

  /**
   * Not found response
   */
  static notFound(res, message = 'Resource not found') {
    return this.error(res, 404, message);
  }

  /**
   * Too many requests response
   */
  static tooManyRequests(res, message = 'Too many requests') {
    return this.error(res, 429, message);
  }
}

// Wrapper for async controller functions
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

module.exports = {
  ApiResponse,
  catchAsync
};