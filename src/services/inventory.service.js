const { Inventory, Product, Rental, Maintenance } = require('../models');
const  AppError  = require('../utils/AppError');
const { addJob } = require('../jobs');
const { eventEmitter, EVENTS } = require('../events');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

class InventoryService {
  constructor() {
    this.redisClient = getRedisClient();
    this.defaultTTL = 1800; // 30 minutes
    
    // Inventory status thresholds
    this.thresholds = {
      lowStock: 5,
      criticalStock: 2,
      maintenanceDue: 30, // days
      warrantyExpiring: 90 // days
    };
  }

  /**
   * Generate unique SKU
   */
  generateSKU(productId, sequence) {
    const product = productId.toString().slice(-6);
    const timestamp = Date.now().toString().slice(-4);
    const seq = String(sequence).padStart(4, '0');
    return `INV-${product}-${timestamp}-${seq}`;
  }

  /**
   * Generate QR code for inventory item
   */
  async generateQRCode(inventoryId, sku) {
    try {
      const data = JSON.stringify({
        id: inventoryId,
        sku,
        url: `${process.env.API_URL}/api/v1/inventory/track/${inventoryId}`
      });
      
      const qrCode = await QRCode.toDataURL(data);
      return qrCode;
    } catch (error) {
      logger.error('Error generating QR code:', error);
      return null;
    }
  }

  /**
   * Calculate depreciation
   */
  calculateDepreciation(purchasePrice, purchaseDate, currentDate = new Date()) {
    const monthsSincePurchase = Math.floor(
      (currentDate - new Date(purchaseDate)) / (1000 * 60 * 60 * 24 * 30)
    );
    
    // Straight-line depreciation over 36 months (3 years)
    const monthlyDepreciation = purchasePrice / 36;
    const depreciatedValue = Math.max(0, purchasePrice - (monthlyDepreciation * monthsSincePurchase));
    
    return {
      originalValue: purchasePrice,
      currentValue: Math.round(depreciatedValue),
      monthsUsed: monthsSincePurchase,
      depreciationRate: ((purchasePrice - depreciatedValue) / purchasePrice) * 100
    };
  }

  /**
   * Create inventory items for a product
   */
  async createInventoryItems(productId, vendorId, quantity, purchaseInfo = {}) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const product = await Product.findOne({
        _id: productId,
        vendor: vendorId
      }).session(session);

      if (!product) {
        throw new AppError('Product not found or unauthorized', 404);
      }

      const items = [];
      const currentCount = await Inventory.countDocuments({ product: productId });

      for (let i = 0; i < quantity; i++) {
        const sequence = currentCount + i + 1;
        const sku = this.generateSKU(productId, sequence);
        
        // Generate QR code
        const qrCode = await this.generateQRCode(null, sku);

        items.push({
          product: productId,
          sku,
          qrCode,
          status: 'available',
          location: purchaseInfo.location || {
            warehouse: 'MAIN',
            shelf: 'A1',
            city: purchaseInfo.city || 'Unknown'
          },
          condition: {
            status: 'new',
            lastInspectionDate: new Date()
          },
          purchaseInfo: {
            date: purchaseInfo.date || new Date(),
            price: purchaseInfo.price || product.pricing?.monthlyRent * 12,
            from: purchaseInfo.from || 'Direct Purchase',
            invoiceNumber: purchaseInfo.invoiceNumber || `INV-${Date.now()}-${i}`,
            warrantyExpiry: purchaseInfo.warrantyExpiry || 
              new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year default
          },
          depreciation: this.calculateDepreciation(
            purchaseInfo.price || product.pricing?.monthlyRent * 12,
            purchaseInfo.date || new Date()
          )
        });
      }

      const inventoryItems = await Inventory.insertMany(items, { session });

      // Update product inventory count
      product.inventory.totalQuantity += quantity;
      product.inventory.availableQuantity += quantity;
      await product.save({ session });

      await session.commitTransaction();

      // Emit event
      eventEmitter.emit('inventory:created', {
        productId,
        vendorId,
        quantity,
        items: inventoryItems.map(i => i._id)
      });

      return inventoryItems;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in createInventoryItems:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get inventory item by ID
   */
  async getInventoryItem(inventoryId, vendorId = null) {
    try {
      const cacheKey = `inventory:${inventoryId}`;
      
      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const query = { _id: inventoryId };
      if (vendorId) {
        query.vendor = vendorId;
      }

      const item = await Inventory.findById(inventoryId)
        .populate({
          path: 'product',
          populate: {
            path: 'vendor',
            select: 'business.name'
          }
        })
        .populate({
          path: 'currentRental',
          select: 'rentalNumber user startDate endDate'
        })
        .populate({
          path: 'rentalHistory.rental',
          select: 'rentalNumber'
        })
        .populate({
          path: 'maintenanceHistory',
          options: { sort: { createdAt: -1 }, limit: 5 }
        })
        .lean();

      if (!item) {
        throw new AppError('Inventory item not found', 404);
      }

      // Update depreciation
      if (item.purchaseInfo?.date) {
        item.depreciation = this.calculateDepreciation(
          item.purchaseInfo.price,
          item.purchaseInfo.date
        );
      }

      // Check warranty status
      if (item.purchaseInfo?.warrantyExpiry) {
        item.warrantyStatus = new Date() < new Date(item.purchaseInfo.warrantyExpiry) 
          ? 'active' 
          : 'expired';
      }

      // Cache the result
      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, 300, JSON.stringify(item));
      }

      return item;
    } catch (error) {
      logger.error('Error in getInventoryItem:', error);
      throw error;
    }
  }

  /**
   * Get product inventory
   */
  async getProductInventory(productId, vendorId, page = 1, limit = 20, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      // Verify product ownership
      const product = await Product.findOne({
        _id: productId,
        vendor: vendorId
      });

      if (!product) {
        throw new AppError('Product not found or unauthorized', 404);
      }

      const query = { product: productId };
      
      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.condition) {
        query['condition.status'] = filters.condition;
      }

      if (filters.location) {
        if (filters.location.city) {
          query['location.city'] = filters.location.city;
        }
        if (filters.location.warehouse) {
          query['location.warehouse'] = filters.location.warehouse;
        }
      }

      const [items, total] = await Promise.all([
        Inventory.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Inventory.countDocuments(query)
      ]);

      // Get status summary
      const summary = await Inventory.aggregate([
        { $match: { product: productId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      const statusSummary = {
        total: await Inventory.countDocuments({ product: productId }),
        available: 0,
        rented: 0,
        maintenance: 0,
        damaged: 0,
        retired: 0
      };

      summary.forEach(s => {
        statusSummary[s._id] = s.count;
      });

      return {
        items,
        summary: statusSummary,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getProductInventory:', error);
      throw error;
    }
  }

  /**
   * Update inventory item
   */
  async updateInventoryItem(inventoryId, vendorId, updateData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const item = await Inventory.findOne({
        _id: inventoryId
      }).populate('product').session(session);

      if (!item) {
        throw new AppError('Inventory item not found', 404);
      }

      // Verify vendor owns the product
      if (item.product.vendor.toString() !== vendorId.toString()) {
        throw new AppError('Unauthorized to update this inventory item', 403);
      }

      // Update fields
      const allowedUpdates = ['location', 'condition', 'purchaseInfo'];
      
      allowedUpdates.forEach(field => {
        if (updateData[field]) {
          item[field] = { ...item[field], ...updateData[field] };
        }
      });

      // If condition is updated, update inspection date
      if (updateData.condition?.status) {
        item.condition.lastInspectionDate = new Date();
      }

      await item.save({ session });

      await session.commitTransaction();

      // Invalidate cache
      await this.invalidateInventoryCache(inventoryId);

      return item;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in updateInventoryItem:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Update inventory item status
   */
  async updateStatus(inventoryId, vendorId, status, reason = '') {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const item = await Inventory.findOne({
        _id: inventoryId
      }).populate('product').session(session);

      if (!item) {
        throw new AppError('Inventory item not found', 404);
      }

      // Verify vendor owns the product
      if (item.product.vendor.toString() !== vendorId.toString()) {
        throw new AppError('Unauthorized to update this inventory item', 403);
      }

      const oldStatus = item.status;
      
      // Validate status transition
      this.validateStatusTransition(oldStatus, status);

      // Update status
      item.status = status;
      
      // Add to history
      item.statusHistory = item.statusHistory || [];
      item.statusHistory.push({
        status,
        reason,
        changedBy: vendorId,
        changedAt: new Date()
      });

      // Handle special cases
      if (status === 'rented' && !item.currentRental) {
        throw new AppError('Cannot mark as rented without current rental', 400);
      }

      if (status === 'available') {
        item.currentRental = null;
      }

      if (status === 'maintenance') {
        item.condition.nextInspectionDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      }

      if (status === 'retired') {
        item.retiredAt = new Date();
        item.retiredReason = reason;
      }

      await item.save({ session });

      // Update product available quantity
      const product = await Product.findById(item.product._id).session(session);
      
      if (oldStatus === 'available' && status !== 'available') {
        product.inventory.availableQuantity -= 1;
      } else if (oldStatus !== 'available' && status === 'available') {
        product.inventory.availableQuantity += 1;
      }
      
      await product.save({ session });

      await session.commitTransaction();

      // Emit event
      if (status === 'maintenance') {
        eventEmitter.emit('inventory:maintenance-required', {
          inventoryId: item._id,
          productId: item.product._id,
          vendorId,
          reason
        });
      }

      if (status === 'low_stock') {
        eventEmitter.emit(EVENTS.VENDOR.INVENTORY_LOW, {
          vendorId,
          productId: item.product._id,
          productName: item.product.basicInfo.name,
          quantity: product.inventory.availableQuantity,
          criticalLevel: this.thresholds.criticalStock
        });
      }

      // Invalidate cache
      await this.invalidateInventoryCache(inventoryId);

      return item;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in updateStatus:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Validate status transition
   */
  validateStatusTransition(oldStatus, newStatus) {
    const validTransitions = {
      'available': ['rented', 'maintenance', 'damaged', 'retired'],
      'rented': ['available', 'maintenance', 'damaged'],
      'maintenance': ['available', 'damaged', 'retired'],
      'damaged': ['maintenance', 'retired'],
      'retired': []
    };

    if (!validTransitions[oldStatus]?.includes(newStatus)) {
      throw new AppError(`Invalid status transition from ${oldStatus} to ${newStatus}`, 400);
    }
  }

  /**
   * Transfer inventory between locations
   */
  async transferInventory(inventoryId, vendorId, transferData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { fromLocation, toLocation, reason } = transferData;

      const item = await Inventory.findOne({
        _id: inventoryId
      }).populate('product').session(session);

      if (!item) {
        throw new AppError('Inventory item not found', 404);
      }

      // Verify vendor owns the product
      if (item.product.vendor.toString() !== vendorId.toString()) {
        throw new AppError('Unauthorized to transfer this inventory item', 403);
      }

      // Record transfer history
      item.transferHistory = item.transferHistory || [];
      item.transferHistory.push({
        from: fromLocation || item.location,
        to: toLocation,
        reason,
        transferredBy: vendorId,
        transferredAt: new Date()
      });

      // Update location
      item.location = toLocation;

      await item.save({ session });

      await session.commitTransaction();

      // Invalidate cache
      await this.invalidateInventoryCache(inventoryId);

      return item;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in transferInventory:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Perform inventory audit
   */
  async performAudit(vendorId, auditData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { productId, expectedCount, actualCount, discrepancies, notes } = auditData;

      const product = await Product.findOne({
        _id: productId,
        vendor: vendorId
      }).session(session);

      if (!product) {
        throw new AppError('Product not found or unauthorized', 404);
      }

      const audit = {
        productId,
        expectedCount,
        actualCount,
        discrepancies: discrepancies || [],
        notes,
        conductedBy: vendorId,
        conductedAt: new Date()
      };

      // Update inventory records based on audit
      if (discrepancies && discrepancies.length > 0) {
        for (const disc of discrepancies) {
          const item = await Inventory.findOne({
            sku: disc.sku,
            product: productId
          }).session(session);

          if (item) {
            if (disc.action === 'mark_lost') {
              item.status = 'retired';
              item.retiredReason = 'Lost during audit';
            } else if (disc.action === 'update_condition') {
              item.condition.status = disc.condition;
              item.condition.notes = disc.notes;
            }
            await item.save({ session });
          }
        }
      }

      // Update product inventory count
      product.inventory.totalQuantity = actualCount;
      product.inventory.availableQuantity = actualCount - 
        (await Inventory.countDocuments({ 
          product: productId, 
          status: { $in: ['rented', 'maintenance'] } 
        }).session(session));
      
      await product.save({ session });

      await session.commitTransaction();

      return audit;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in performAudit:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get inventory analytics
   */
  async getInventoryAnalytics(vendorId, filters = {}) {
    try {
      const match = { 'product.vendor': vendorId };

      if (filters.productId) {
        match['product._id'] = filters.productId;
      }

      const analytics = await Inventory.aggregate([
        {
          $lookup: {
            from: 'products',
            localField: 'product',
            foreignField: '_id',
            as: 'product'
          }
        },
        { $unwind: '$product' },
        { $match: match },
        {
          $facet: {
            overview: [
              {
                $group: {
                  _id: null,
                  totalItems: { $sum: 1 },
                  totalValue: { $sum: '$purchaseInfo.price' },
                  averageValue: { $avg: '$purchaseInfo.price' },
                  availableCount: {
                    $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] }
                  },
                  rentedCount: {
                    $sum: { $cond: [{ $eq: ['$status', 'rented'] }, 1, 0] }
                  },
                  maintenanceCount: {
                    $sum: { $cond: [{ $eq: ['$status', 'maintenance'] }, 1, 0] }
                  },
                  damagedCount: {
                    $sum: { $cond: [{ $eq: ['$status', 'damaged'] }, 1, 0] }
                  },
                  retiredCount: {
                    $sum: { $cond: [{ $eq: ['$status', 'retired'] }, 1, 0] }
                  }
                }
              }
            ],
            byProduct: [
              {
                $group: {
                  _id: '$product._id',
                  productName: { $first: '$product.basicInfo.name' },
                  totalItems: { $sum: 1 },
                  available: {
                    $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] }
                  },
                  rented: {
                    $sum: { $cond: [{ $eq: ['$status', 'rented'] }, 1, 0] }
                  },
                  value: { $sum: '$purchaseInfo.price' }
                }
              },
              { $sort: { totalItems: -1 } }
            ],
            byLocation: [
              {
                $group: {
                  _id: {
                    city: '$location.city',
                    warehouse: '$location.warehouse'
                  },
                  count: { $sum: 1 },
                  value: { $sum: '$purchaseInfo.price' }
                }
              },
              { $sort: { count: -1 } }
            ],
            byCondition: [
              {
                $group: {
                  _id: '$condition.status',
                  count: { $sum: 1 }
                }
              }
            ],
            ageAnalysis: [
              {
                $project: {
                  age: {
                    $floor: {
                      $divide: [
                        { $subtract: [new Date(), '$purchaseInfo.date'] },
                        1000 * 60 * 60 * 24 * 30
                      ]
                    }
                  },
                  value: '$purchaseInfo.price'
                }
              },
              {
                $bucket: {
                  groupBy: '$age',
                  boundaries: [0, 6, 12, 24, 36, 100],
                  default: '36+',
                  output: {
                    count: { $sum: 1 },
                    value: { $sum: '$value' }
                  }
                }
              }
            ],
            warrantyStatus: [
              {
                $project: {
                  warrantyActive: {
                    $gt: ['$purchaseInfo.warrantyExpiry', new Date()]
                  }
                }
              },
              {
                $group: {
                  _id: '$warrantyActive',
                  count: { $sum: 1 }
                }
              }
            ]
          }
        }
      ]);

      return analytics[0];
    } catch (error) {
      logger.error('Error in getInventoryAnalytics:', error);
      throw error;
    }
  }

  /**
   * Get low stock alerts
   */
  async getLowStockAlerts(vendorId) {
    try {
      const products = await Product.find({ vendor: vendorId })
        .select('basicInfo.name inventory.availableQuantity inventory.totalQuantity pricing.monthlyRent');

      const alerts = [];

      for (const product of products) {
        const available = product.inventory.availableQuantity;
        const total = product.inventory.totalQuantity;

        if (available <= this.thresholds.criticalStock) {
          alerts.push({
            productId: product._id,
            productName: product.basicInfo.name,
            level: 'critical',
            available,
            total,
            message: `Critical low stock! Only ${available} items left`
          });
        } else if (available <= this.thresholds.lowStock) {
          alerts.push({
            productId: product._id,
            productName: product.basicInfo.name,
            level: 'low',
            available,
            total,
            message: `Low stock: ${available} items remaining`
          });
        }
      }

      return alerts;
    } catch (error) {
      logger.error('Error in getLowStockAlerts:', error);
      throw error;
    }
  }

  /**
   * Get maintenance due items
   */
  async getMaintenanceDueItems(vendorId) {
    try {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      const items = await Inventory.find({
        'product.vendor': vendorId,
        $or: [
          { 'condition.nextInspectionDate': { $lte: thirtyDaysFromNow } },
          { status: 'maintenance' }
        ]
      })
      .populate('product', 'basicInfo.name')
      .sort({ 'condition.nextInspectionDate': 1 })
      .lean();

      return items.map(item => ({
        inventoryId: item._id,
        sku: item.sku,
        productName: item.product.basicInfo.name,
        status: item.status,
        lastInspection: item.condition.lastInspectionDate,
        nextInspection: item.condition.nextInspectionDate,
        daysUntilDue: item.condition.nextInspectionDate ? 
          Math.ceil((item.condition.nextInspectionDate - new Date()) / (1000 * 60 * 60 * 24)) : null
      }));
    } catch (error) {
      logger.error('Error in getMaintenanceDueItems:', error);
      throw error;
    }
  }

  /**
   * Schedule maintenance for inventory items
   */
  async scheduleMaintenance(vendorId, scheduleData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { inventoryIds, scheduledDate, type, notes } = scheduleData;

      const items = await Inventory.find({
        _id: { $in: inventoryIds }
      }).populate('product').session(session);

      // Verify all items belong to vendor
      for (const item of items) {
        if (item.product.vendor.toString() !== vendorId.toString()) {
          throw new AppError(`Unauthorized to schedule maintenance for item ${item.sku}`, 403);
        }
      }

      const maintenanceRecords = [];

      for (const item of items) {
        // Create maintenance request
        const maintenance = await Maintenance.create([{
          inventory: item._id,
          product: item.product._id,
          vendor: vendorId,
          issueType: 'scheduled_maintenance',
          priority: 'medium',
          status: 'scheduled',
          description: {
            issue: `Scheduled maintenance - ${type}`,
            notes
          },
          schedule: {
            scheduledDate: new Date(scheduledDate)
          },
          metadata: {
            createdBy: vendorId,
            source: 'inventory'
          }
        }], { session });

        // Update inventory status
        item.status = 'maintenance';
        item.condition.nextInspectionDate = new Date(scheduledDate);
        await item.save({ session });

        maintenanceRecords.push(maintenance[0]);
      }

      await session.commitTransaction();

      return maintenanceRecords;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in scheduleMaintenance:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get inventory value report
   */
  async getInventoryValueReport(vendorId) {
    try {
      const items = await Inventory.find({ 'product.vendor': vendorId })
        .populate('product', 'basicInfo.name')
        .lean();

      const report = {
        totalItems: items.length,
        totalValue: 0,
        depreciatedValue: 0,
        byProduct: {},
        byStatus: {
          available: { count: 0, value: 0 },
          rented: { count: 0, value: 0 },
          maintenance: { count: 0, value: 0 },
          damaged: { count: 0, value: 0 },
          retired: { count: 0, value: 0 }
        }
      };

      items.forEach(item => {
        const value = item.purchaseInfo?.price || 0;
        const depreciated = this.calculateDepreciation(
          value,
          item.purchaseInfo?.date || new Date()
        ).currentValue;

        report.totalValue += value;
        report.depreciatedValue += depreciated;

        // By product
        const productId = item.product._id.toString();
        if (!report.byProduct[productId]) {
          report.byProduct[productId] = {
            productName: item.product.basicInfo.name,
            count: 0,
            value: 0,
            depreciated: 0
          };
        }
        report.byProduct[productId].count++;
        report.byProduct[productId].value += value;
        report.byProduct[productId].depreciated += depreciated;

        // By status
        if (report.byStatus[item.status]) {
          report.byStatus[item.status].count++;
          report.byStatus[item.status].value += value;
        }
      });

      return report;
    } catch (error) {
      logger.error('Error in getInventoryValueReport:', error);
      throw error;
    }
  }

  /**
   * Bulk import inventory items
   */
  async bulkImport(vendorId, items) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const results = {
        successful: [],
        failed: []
      };

      for (const item of items) {
        try {
          const { productId, quantity, purchaseInfo } = item;

          // Verify product belongs to vendor
          const product = await Product.findOne({
            _id: productId,
            vendor: vendorId
          }).session(session);

          if (!product) {
            results.failed.push({
              productId,
              reason: 'Product not found or unauthorized'
            });
            continue;
          }

          const created = await this.createInventoryItems(
            productId,
            vendorId,
            quantity,
            purchaseInfo
          );

          results.successful.push(...created.map(c => c._id));
        } catch (error) {
          results.failed.push({
            ...item,
            reason: error.message
          });
        }
      }

      await session.commitTransaction();

      return results;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in bulkImport:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Export inventory data
   */
  async exportInventory(vendorId, format = 'json') {
    try {
      const items = await Inventory.find({ 'product.vendor': vendorId })
        .populate('product', 'basicInfo.name basicInfo.sku')
        .lean();

      if (format === 'csv') {
        return items.map(item => ({
          SKU: item.sku,
          Product: item.product.basicInfo.name,
          Status: item.status,
          Condition: item.condition?.status,
          Location: `${item.location?.city} - ${item.location?.warehouse} - ${item.location?.shelf}`,
          'Purchase Date': item.purchaseInfo?.date,
          'Purchase Price': item.purchaseInfo?.price,
          'Warranty Expiry': item.purchaseInfo?.warrantyExpiry,
          'Last Inspection': item.condition?.lastInspectionDate,
          'Next Inspection': item.condition?.nextInspectionDate
        }));
      }

      return items;
    } catch (error) {
      logger.error('Error in exportInventory:', error);
      throw error;
    }
  }

  /**
   * Invalidate inventory cache
   */
  async invalidateInventoryCache(inventoryId) {
    try {
      if (this.redisClient) {
        const patterns = [
          `inventory:${inventoryId}`,
          `inventory:${inventoryId}:*`,
          'inventory:product:*',
          'inventory:analytics:*',
          'inventory:alerts:*'
        ];
        
        for (const pattern of patterns) {
          const keys = await this.redisClient.keys(pattern);
          if (keys.length > 0) {
            await this.redisClient.del(keys);
          }
        }
      }
    } catch (error) {
      logger.error('Error invalidating inventory cache:', error);
    }
  }
}

module.exports = new InventoryService();