const mongoose = require('mongoose');

/**
 * MongoDB utility functions
 */
class MongoDBUtils {
  /**
   * Check if ID is valid ObjectId
   */
  isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(id);
  }

  /**
   * Convert string to ObjectId
   */
  toObjectId(id) {
    if (!this.isValidObjectId(id)) {
      throw new Error('Invalid ObjectId');
    }
    return new mongoose.Types.ObjectId(id);
  }

  /**
   * Generate new ObjectId
   */
  generateObjectId() {
    return new mongoose.Types.ObjectId();
  }

  /**
   * Convert string IDs to ObjectIds
   */
  toObjectIds(ids) {
    if (!Array.isArray(ids)) {
      return this.toObjectId(ids);
    }
    return ids.map(id => this.toObjectId(id));
  }

  /**
   * Build query options from request query
   */
  buildQueryOptions(query, defaultSort = '-createdAt') {
    const {
      page = 1,
      limit = 10,
      sort = defaultSort,
      fields,
      populate,
      ...filters
    } = query;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort,
    };

    if (fields) {
      options.select = fields.split(',').join(' ');
    }

    if (populate) {
      options.populate = this.parsePopulate(populate);
    }

    // Remove empty filters
    Object.keys(filters).forEach(key => {
      if (filters[key] === '' || filters[key] === null || filters[key] === undefined) {
        delete filters[key];
      }
    });

    return {
      filters,
      options,
    };
  }

  /**
   * Parse populate string to mongoose populate object
   */
  parsePopulate(populate) {
    if (typeof populate === 'string') {
      return populate.split(',').map(field => ({ path: field.trim() }));
    }
    if (Array.isArray(populate)) {
      return populate.map(field => {
        if (typeof field === 'string') {
          return { path: field };
        }
        return field;
      });
    }
    return populate;
  }

  /**
   * Build filter query from filter object
   */
  buildFilterQuery(filters) {
    const query = {};

    Object.entries(filters).forEach(([key, value]) => {
      // Handle operators
      if (value && typeof value === 'object') {
        Object.entries(value).forEach(([op, val]) => {
          const mongoOp = this.getMongoOperator(op);
          if (mongoOp) {
            if (!query[key]) query[key] = {};
            query[key][mongoOp] = val;
          }
        });
      } else {
        // Direct equality
        query[key] = value;
      }
    });

    return query;
  }

  /**
   * Get MongoDB operator from string
   */
  getMongoOperator(op) {
    const operators = {
      eq: '$eq',
      ne: '$ne',
      gt: '$gt',
      gte: '$gte',
      lt: '$lt',
      lte: '$lte',
      in: '$in',
      nin: '$nin',
      exists: '$exists',
      regex: '$regex',
      options: '$options',
    };
    return operators[op] || null;
  }

  /**
   * Build text search query
   */
  buildTextSearch(searchTerm, fields = []) {
    if (!searchTerm) return {};

    if (fields.length > 0) {
      // Search in specific fields
      const conditions = fields.map(field => ({
        [field]: { $regex: searchTerm, $options: 'i' }
      }));
      return { $or: conditions };
    }

    // Use MongoDB text search
    return { $text: { $search: searchTerm } };
  }

  /**
   * Build date range filter
   */
  buildDateRangeFilter(field, startDate, endDate) {
    const filter = {};
    
    if (startDate || endDate) {
      filter[field] = {};
      if (startDate) {
        filter[field].$gte = new Date(startDate);
      }
      if (endDate) {
        filter[field].$lte = new Date(endDate);
      }
    }

    return filter;
  }

  /**
   * Build location query (GeoJSON)
   */
  buildLocationQuery(field, coordinates, maxDistance, minDistance = 0) {
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return {};
    }

    return {
      [field]: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [coordinates[0], coordinates[1]],
          },
          $maxDistance: maxDistance,
          $minDistance: minDistance,
        },
      },
    };
  }

  /**
   * Build price range filter
   */
  buildPriceRangeFilter(field, minPrice, maxPrice) {
    const filter = {};
    
    if (minPrice || maxPrice) {
      filter[field] = {};
      if (minPrice) {
        filter[field].$gte = minPrice;
      }
      if (maxPrice) {
        filter[field].$lte = maxPrice;
      }
    }

    return filter;
  }

  /**
   * Get pagination metadata
   */
  getPaginationMetadata(total, page, limit) {
    const totalPages = Math.ceil(total / limit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;

    return {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages,
      hasNext,
      hasPrev,
      nextPage: hasNext ? page + 1 : null,
      prevPage: hasPrev ? page - 1 : null,
    };
  }

  /**
   * Create MongoDB aggregation pipeline for rental analytics
   */
  createRentalAnalyticsPipeline(filters = {}) {
    const pipeline = [];

    // Match stage
    const match = {};
    if (filters.startDate || filters.endDate) {
      match.createdAt = {};
      if (filters.startDate) match.createdAt.$gte = new Date(filters.startDate);
      if (filters.endDate) match.createdAt.$lte = new Date(filters.endDate);
    }
    if (filters.status) match.status = filters.status;
    if (filters.vendor) match.vendor = this.toObjectId(filters.vendor);
    
    if (Object.keys(match).length > 0) {
      pipeline.push({ $match: match });
    }

    // Group by month
    pipeline.push({
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
        },
        count: { $sum: 1 },
        totalAmount: { $sum: '$rentalDetails.totalAmount' },
        avgAmount: { $avg: '$rentalDetails.totalAmount' },
        minAmount: { $min: '$rentalDetails.totalAmount' },
        maxAmount: { $max: '$rentalDetails.totalAmount' },
      },
    });

    // Sort by date
    pipeline.push({
      $sort: { '_id.year': 1, '_id.month': 1 },
    });

    // Format output
    pipeline.push({
      $project: {
        _id: 0,
        year: '$_id.year',
        month: '$_id.month',
        count: 1,
        totalAmount: 1,
        avgAmount: 1,
        minAmount: 1,
        maxAmount: 1,
        date: {
          $dateFromParts: {
            year: '$_id.year',
            month: '$_id.month',
            day: 1,
          },
        },
      },
    });

    return pipeline;
  }

  /**
   * Create MongoDB aggregation pipeline for vendor performance
   */
  createVendorPerformancePipeline(vendorId, filters = {}) {
    const pipeline = [];

    // Match rentals for vendor
    pipeline.push({
      $match: {
        vendor: this.toObjectId(vendorId),
      },
    });

    // Apply date filters
    if (filters.startDate || filters.endDate) {
      const dateMatch = {};
      if (filters.startDate) dateMatch.$gte = new Date(filters.startDate);
      if (filters.endDate) dateMatch.$lte = new Date(filters.endDate);
      pipeline.push({
        $match: { createdAt: dateMatch },
      });
    }

    // Group by product
    pipeline.push({
      $group: {
        _id: '$product',
        rentalCount: { $sum: 1 },
        totalRevenue: { $sum: '$rentalDetails.totalAmount' },
        avgRentalValue: { $avg: '$rentalDetails.totalAmount' },
        completedCount: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
        },
        cancelledCount: {
          $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] },
        },
      },
    });

    // Lookup product details
    pipeline.push({
      $lookup: {
        from: 'products',
        localField: '_id',
        foreignField: '_id',
        as: 'product',
      },
    });

    pipeline.push({
      $unwind: '$product',
    });

    // Project final fields
    pipeline.push({
      $project: {
        productId: '$_id',
        productName: '$product.basicInfo.name',
        rentalCount: 1,
        totalRevenue: 1,
        avgRentalValue: 1,
        completedCount: 1,
        cancelledCount: 1,
        completionRate: {
          $multiply: [
            { $divide: ['$completedCount', { $max: ['$rentalCount', 1] }] },
            100,
          ],
        },
      },
    });

    // Sort by revenue
    pipeline.push({
      $sort: { totalRevenue: -1 },
    });

    return pipeline;
  }

  /**
   * Get collection stats
   */
  async getCollectionStats(collectionName) {
    const conn = mongoose.connection;
    const stats = await conn.db.command({ collStats: collectionName });
    
    return {
      count: stats.count,
      size: stats.size,
      avgObjSize: stats.avgObjSize,
      storageSize: stats.storageSize,
      totalIndexSize: stats.totalIndexSize,
      indexes: stats.indexSizes,
    };
  }

  /**
   * List all indexes on collection
   */
  async listIndexes(collectionName) {
    const collection = mongoose.connection.collection(collectionName);
    return collection.indexes();
  }

  /**
   * Create index if not exists
   */
  async createIndexIfNotExists(collectionName, indexSpec, options = {}) {
    const collection = mongoose.connection.collection(collectionName);
    const indexes = await collection.indexes();
    
    const indexExists = indexes.some(index => {
      return Object.keys(indexSpec).every(field => index.key[field]);
    });

    if (!indexExists) {
      return collection.createIndex(indexSpec, options);
    }
    
    return null;
  }

  /**
   * Drop index
   */
  async dropIndex(collectionName, indexName) {
    const collection = mongoose.connection.collection(collectionName);
    return collection.dropIndex(indexName);
  }

  /**
   * Check if collection exists
   */
  async collectionExists(collectionName) {
    const collections = await mongoose.connection.db.listCollections().toArray();
    return collections.some(col => col.name === collectionName);
  }

  /**
   * Get database stats
   */
  async getDatabaseStats() {
    const conn = mongoose.connection;
    const stats = await conn.db.stats();
    
    return {
      database: stats.db,
      collections: stats.collections,
      objects: stats.objects,
      avgObjSize: stats.avgObjSize,
      dataSize: stats.dataSize,
      storageSize: stats.storageSize,
      indexes: stats.indexes,
      indexSize: stats.indexSize,
      totalSize: stats.dataSize + stats.indexSize,
    };
  }

  /**
   * Run aggregation with pagination
   */
  async aggregateWithPagination(model, pipeline, page = 1, limit = 10) {
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await model.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    const skip = (page - 1) * limit;
    const paginatedPipeline = [
      ...pipeline,
      { $skip: skip },
      { $limit: limit },
    ];

    const data = await model.aggregate(paginatedPipeline);

    return {
      data,
      pagination: this.getPaginationMetadata(total, page, limit),
    };
  }

  /**
   * Bulk write with error handling
   */
  async bulkWriteWithRetry(model, operations, options = {}) {
    const maxRetries = options.maxRetries || 3;
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          const result = await model.bulkWrite(operations, {
            ...options,
            session,
          });

          await session.commitTransaction();
          return result;
        } catch (error) {
          await session.abortTransaction();
          throw error;
        } finally {
          session.endSession();
        }
      } catch (error) {
        lastError = error;
        if (error.code !== 112) { // Not a write conflict
          throw error;
        }
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, i)));
      }
    }

    throw lastError;
  }

  /**
   * Convert MongoDB document to plain object
   */
  toPlainObject(doc) {
    if (!doc) return null;
    
    if (Array.isArray(doc)) {
      return doc.map(d => d.toObject ? d.toObject() : d);
    }
    
    return doc.toObject ? doc.toObject() : doc;
  }

  /**
   * Sanitize MongoDB document (remove internal fields)
   */
  sanitizeDocument(doc) {
    const obj = this.toPlainObject(doc);
    
    if (!obj) return obj;
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeDocument(item));
    }
    
    const { __v, _id, ...rest } = obj;
    
    // Convert _id to id
    if (_id) {
      rest.id = _id.toString();
    }
    
    // Recursively sanitize nested objects
    Object.keys(rest).forEach(key => {
      if (rest[key] && typeof rest[key] === 'object') {
        rest[key] = this.sanitizeDocument(rest[key]);
      }
    });
    
    return rest;
  }
}

module.exports = new MongoDBUtils();