const { Discount, Product, Category, User, Rental } = require('../models');
const AppError = require('../utils/AppError');
const { addJob } = require('../jobs');
const { eventEmitter } = require('../events');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const moment = require('moment');

class DiscountService {
  constructor() {
    this.redisClient = getRedisClient();
    this.defaultTTL = 1800; // 30 minutes
  }

  /**
   * Generate unique discount code
   */
  generateDiscountCode(name, length = 8) {
    // Create base code from name
    const baseCode = name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .substring(0, 4);
    
    // Add random characters
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let randomPart = '';
    for (let i = 0; i < length - baseCode.length; i++) {
      randomPart += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    
    return baseCode + randomPart;
  }

  /**
   * Create discount
   */
  async createDiscount(discountData, createdBy) {
    try {
      const {
        name,
        description,
        type,
        value,
        maxDiscountAmount,
        minOrderValue,
        applicableOn,
        userEligibility,
        usageLimits,
        validity,
        stackable = false,
        priority = 0,
        displayConditions,
        metadata,
        code
      } = discountData;

      // Generate unique code if not provided
      const discountCode = code || this.generateDiscountCode(name);

      // Check if code already exists
      const existingDiscount = await Discount.findOne({ code: discountCode });
      if (existingDiscount) {
        throw new AppError('Discount code already exists', 409);
      }

      // Validate dates
      if (new Date(validity.startDate) >= new Date(validity.endDate)) {
        throw new AppError('End date must be after start date', 400);
      }

      // Validate value based on type
      if (type === 'percentage' && (value < 0 || value > 100)) {
        throw new AppError('Percentage discount must be between 0 and 100', 400);
      }

      if (type === 'fixed' && value < 0) {
        throw new AppError('Fixed discount must be positive', 400);
      }

      // Create discount
      const discount = await Discount.create({
        code: discountCode,
        name,
        description,
        type,
        value,
        maxDiscountAmount,
        minOrderValue,
        applicableOn,
        userEligibility: userEligibility || {
          userType: 'all'
        },
        usageLimits: usageLimits || {
          perUser: 1,
          global: null
        },
        validity: {
          startDate: new Date(validity.startDate),
          endDate: new Date(validity.endDate),
          timezone: validity.timezone || 'Asia/Kolkata'
        },
        stackable,
        priority,
        displayConditions: displayConditions || {
          showOnCheckout: true,
          showOnProduct: false,
          autoApply: false
        },
        metadata: {
          createdBy,
          ...metadata
        },
        status: new Date() >= new Date(validity.startDate) ? 'active' : 'inactive'
      });

      // Emit event
      eventEmitter.emit('discount:created', {
        discountId: discount._id,
        code: discount.code,
        name: discount.name,
        createdBy
      });

      return discount;
    } catch (error) {
      logger.error('Error in createDiscount:', error);
      throw error;
    }
  }

  /**
   * Get discount by ID or code
   */
  async getDiscount(identifier) {
    try {
      const cacheKey = `discount:${identifier}`;
      
      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      // Check if identifier is MongoDB ObjectId or code
      const isObjectId = mongoose.Types.ObjectId.isValid(identifier);
      
      const query = isObjectId 
        ? { _id: identifier }
        : { code: identifier.toUpperCase() };
      
      const discount = await Discount.findOne(query).lean();

      if (!discount) {
        throw new AppError('Discount not found', 404);
      }

      // Update status based on validity
      discount.status = this.getDiscountStatus(discount);

      // Cache the result
      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, 300, JSON.stringify(discount));
      }

      return discount;
    } catch (error) {
      logger.error('Error in getDiscount:', error);
      throw error;
    }
  }

  /**
   * Get all discounts
   */
  async getAllDiscounts(page = 1, limit = 20, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = {};
      
      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.type) {
        query.type = filters.type;
      }

      if (filters.search) {
        query.$or = [
          { code: new RegExp(filters.search, 'i') },
          { name: new RegExp(filters.search, 'i') }
        ];
      }

      if (filters.active) {
        const now = new Date();
        query['validity.startDate'] = { $lte: now };
        query['validity.endDate'] = { $gte: now };
      }

      const [discounts, total] = await Promise.all([
        Discount.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Discount.countDocuments(query)
      ]);

      // Update status for each discount
      discounts.forEach(d => {
        d.status = this.getDiscountStatus(d);
      });

      return {
        discounts,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getAllDiscounts:', error);
      throw error;
    }
  }

  /**
   * Update discount
   */
  async updateDiscount(discountId, updateData, updatedBy) {
    try {
      const discount = await Discount.findById(discountId);

      if (!discount) {
        throw new AppError('Discount not found', 404);
      }

      // If code is being updated, check uniqueness
      if (updateData.code && updateData.code !== discount.code) {
        const existingDiscount = await Discount.findOne({ code: updateData.code });
        if (existingDiscount) {
          throw new AppError('Discount code already exists', 409);
        }
      }

      // Update fields
      Object.assign(discount, updateData);
      discount.metadata.updatedBy = updatedBy;
      discount.metadata.updatedAt = new Date();

      // Recalculate status
      discount.status = this.getDiscountStatus(discount);

      await discount.save();

      // Invalidate cache
      await this.invalidateDiscountCache(discountId);

      // Emit event
      eventEmitter.emit('discount:updated', {
        discountId: discount._id,
        code: discount.code,
        updatedBy,
        changes: Object.keys(updateData)
      });

      return discount;
    } catch (error) {
      logger.error('Error in updateDiscount:', error);
      throw error;
    }
  }

  /**
   * Delete discount
   */
  async deleteDiscount(discountId, deletedBy) {
    try {
      const discount = await Discount.findById(discountId);

      if (!discount) {
        throw new AppError('Discount not found', 404);
      }

      // Soft delete
      discount.status = 'disabled';
      discount.metadata.deletedBy = deletedBy;
      discount.metadata.deletedAt = new Date();
      await discount.save();

      // Invalidate cache
      await this.invalidateDiscountCache(discountId);

      // Emit event
      eventEmitter.emit('discount:deleted', {
        discountId: discount._id,
        code: discount.code,
        deletedBy
      });

      return { message: 'Discount disabled successfully' };
    } catch (error) {
      logger.error('Error in deleteDiscount:', error);
      throw error;
    }
  }

  /**
   * Validate discount for user and order
   */
  async validateDiscount(code, userId, orderDetails) {
    try {
      const { amount, productIds, rentalMonths, vendorId } = orderDetails;

      // Get discount
      const discount = await Discount.findOne({ code: code.toUpperCase() });

      if (!discount) {
        return { valid: false, reason: 'Invalid discount code' };
      }

      // Check if discount is active
      const status = this.getDiscountStatus(discount);
      if (status !== 'active') {
        return { valid: false, reason: 'Discount is not active' };
      }

      // Check global usage limit
      if (discount.usageLimits.global && discount.usageCount >= discount.usageLimits.global) {
        return { valid: false, reason: 'Discount usage limit exceeded' };
      }

      // Check minimum order value
      if (discount.minOrderValue && amount < discount.minOrderValue) {
        return { 
          valid: false, 
          reason: `Minimum order value of ₹${discount.minOrderValue} required` 
        };
      }

      // Check user eligibility
      const userEligible = await this.checkUserEligibility(discount, userId);
      if (!userEligible.eligible) {
        return { valid: false, reason: userEligible.reason };
      }

      // Check applicable on
      const applicable = await this.checkApplicability(discount, { productIds, rentalMonths, vendorId });
      if (!applicable.applicable) {
        return { valid: false, reason: applicable.reason };
      }

      // Calculate discount amount
      const discountAmount = this.calculateDiscountAmount(discount, amount);

      return {
        valid: true,
        discount,
        discountAmount,
        finalAmount: amount - discountAmount
      };
    } catch (error) {
      logger.error('Error in validateDiscount:', error);
      throw error;
    }
  }

  /**
   * Apply discount to order
   */
  async applyDiscount(code, userId, orderDetails) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Validate first
      const validation = await this.validateDiscount(code, userId, orderDetails);
      
      if (!validation.valid) {
        throw new AppError(validation.reason, 400);
      }

      const discount = validation.discount;

      // Update usage count
      discount.usageCount += 1;
      discount.usageHistory.push({
        user: userId,
        usedAt: new Date(),
        discountAmount: validation.discountAmount,
        orderValue: orderDetails.amount,
        metadata: {
          rentalId: orderDetails.rentalId,
          productIds: orderDetails.productIds
        }
      });

      await discount.save({ session });

      await session.commitTransaction();

      // Invalidate cache
      await this.invalidateDiscountCache(discount._id);

      // Emit event
      eventEmitter.emit('discount:applied', {
        discountId: discount._id,
        code: discount.code,
        userId,
        discountAmount: validation.discountAmount,
        orderAmount: orderDetails.amount
      });

      return {
        success: true,
        discountCode: discount.code,
        discountAmount: validation.discountAmount,
        finalAmount: validation.finalAmount,
        message: `Discount of ₹${validation.discountAmount} applied successfully`
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in applyDiscount:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Record a discount redemption inside an existing transaction/session.
   *
   * Use this from flows that already own a mongoose session (e.g. rental
   * creation) so the usage record commits atomically with the order. Unlike
   * applyDiscount, it does NOT open its own transaction.
   */
  async recordUsage(discountId, { userId, rentalId, discountAmount, orderValue }, session) {
    if (!discountId) return null;

    const discount = await Discount.findById(discountId).session(session || null);
    if (!discount) {
      logger.warn(`recordUsage: discount ${discountId} not found`);
      return null;
    }

    discount.usageCount += 1;
    discount.usageHistory.push({
      user: userId,
      rental: rentalId,
      usedAt: new Date(),
      discountAmount,
      orderValue,
      metadata: { rentalId },
    });

    await discount.save({ session });

    // Fire-and-forget cache invalidation + event (safe outside the txn semantics)
    this.invalidateDiscountCache(discount._id).catch(() => {});
    eventEmitter.emit('discount:applied', {
      discountId: discount._id,
      code: discount.code,
      userId,
      rentalId,
      discountAmount,
      orderAmount: orderValue,
    });

    return discount;
  }

  /**
   * Check user eligibility for discount
   */
  async checkUserEligibility(discount, userId) {
    const eligibility = discount.userEligibility;

    // If no eligibility rules, user is eligible
    if (!eligibility || eligibility.userType === 'all') {
      return { eligible: true };
    }

    const user = await User.findById(userId);

    if (!user) {
      return { eligible: false, reason: 'User not found' };
    }

    // Check user type
    if (eligibility.userType === 'new') {
      const rentalCount = await Rental.countDocuments({ user: userId });
      if (rentalCount > 0) {
        return { eligible: false, reason: 'Discount is only for new users' };
      }
    }

    if (eligibility.userType === 'existing') {
      const rentalCount = await Rental.countDocuments({ user: userId });
      if (rentalCount === 0) {
        return { eligible: false, reason: 'Discount is only for existing users' };
      }
    }

    // Check specific users
    if (eligibility.userType === 'specific' && eligibility.userIds) {
      if (!eligibility.userIds.includes(userId)) {
        return { eligible: false, reason: 'Discount is not applicable for this user' };
      }
    }

    // Check minimum rentals completed
    if (eligibility.minRentalsCompleted) {
      const completedRentals = await Rental.countDocuments({ 
        user: userId, 
        status: 'completed' 
      });
      if (completedRentals < eligibility.minRentalsCompleted) {
        return { 
          eligible: false, 
          reason: `Minimum ${eligibility.minRentalsCompleted} completed rentals required` 
        };
      }
    }

    // Check minimum amount spent
    if (eligibility.minAmountSpent) {
      const userStats = await User.findById(userId).select('stats.totalSpent');
      if (userStats?.stats?.totalSpent < eligibility.minAmountSpent) {
        return { 
          eligible: false, 
          reason: `Minimum ₹${eligibility.minAmountSpent} spent required` 
        };
      }
    }

    // Check per-user usage limit
    if (discount.usageLimits.perUser) {
      const userUsage = discount.usageHistory.filter(
        h => h.user.toString() === userId.toString()
      ).length;
      
      if (userUsage >= discount.usageLimits.perUser) {
        return { 
          eligible: false, 
          reason: `You have already used this discount ${userUsage} time(s)` 
        };
      }
    }

    return { eligible: true };
  }

  /**
   * Check if discount is applicable to products
   */
  async checkApplicability(discount, { productIds, rentalMonths, vendorId }) {
    const applicable = discount.applicableOn;

    if (!applicable || applicable.type === 'all') {
      return { applicable: true };
    }

    // Check category applicability
    if (applicable.type === 'category' && applicable.categoryIds?.length > 0) {
      const products = await Product.find({ 
        _id: { $in: productIds },
        category: { $in: applicable.categoryIds }
      });

      if (products.length === 0) {
        return { 
          applicable: false, 
          reason: 'Discount is not applicable for selected products' 
        };
      }
    }

    // Check product applicability
    if (applicable.type === 'product' && applicable.productIds?.length > 0) {
      const hasApplicableProduct = productIds.some(id => 
        applicable.productIds.includes(id.toString())
      );

      if (!hasApplicableProduct) {
        return { 
          applicable: false, 
          reason: 'Discount is not applicable for selected products' 
        };
      }
    }

    // Check vendor applicability
    if (applicable.type === 'vendor' && applicable.vendorIds?.length > 0) {
      if (!applicable.vendorIds.includes(vendorId?.toString())) {
        return { 
          applicable: false, 
          reason: 'Discount is not applicable for this vendor' 
        };
      }
    }

    // Check rental tenure applicability
    if (applicable.type === 'rental_tenure' && applicable.tenureMonths?.length > 0) {
      if (!applicable.tenureMonths.includes(rentalMonths)) {
        return { 
          applicable: false, 
          reason: `Discount is valid for ${applicable.tenureMonths.join(', ')} months tenure only` 
        };
      }
    }

    return { applicable: true };
  }

  /**
   * Calculate discount amount
   */
  calculateDiscountAmount(discount, orderAmount) {
    let discountAmount = 0;

    switch (discount.type) {
      case 'percentage':
        discountAmount = (orderAmount * discount.value) / 100;
        // Apply max discount cap
        if (discount.maxDiscountAmount) {
          discountAmount = Math.min(discountAmount, discount.maxDiscountAmount);
        }
        break;

      case 'fixed':
        discountAmount = Math.min(discount.value, orderAmount);
        break;

      case 'free_delivery':
        // This would be handled separately in rental calculation
        discountAmount = 0;
        break;

      case 'no_deposit':
        // This would be handled separately in rental calculation
        discountAmount = 0;
        break;

      default:
        discountAmount = 0;
    }

    return Math.round(discountAmount * 100) / 100; // Round to 2 decimals
  }

  /**
   * Get discount status based on validity
   */
  getDiscountStatus(discount) {
    const now = new Date();
    const startDate = new Date(discount.validity.startDate);
    const endDate = new Date(discount.validity.endDate);

    if (discount.status === 'disabled') {
      return 'disabled';
    }

    if (now < startDate) {
      return 'inactive';
    }

    if (now > endDate) {
      return 'expired';
    }

    if (discount.usageLimits.global && discount.usageCount >= discount.usageLimits.global) {
      return 'exhausted';
    }

    return 'active';
  }

  /**
   * Get applicable discounts for user/order
   */
  async getApplicableDiscounts(userId, orderDetails) {
    try {
      const { amount, productIds, rentalMonths, vendorId } = orderDetails;
      
      const now = new Date();

      // Get all active discounts
      const discounts = await Discount.find({
        status: 'active',
        'validity.startDate': { $lte: now },
        'validity.endDate': { $gte: now },
        $or: [
          { 'usageLimits.global': null },
          { 'usageLimits.global': { $gt: 0 }, usageCount: { $lt: '$usageLimits.global' } }
        ]
      }).sort({ priority: -1, createdAt: -1 });

      const applicableDiscounts = [];

      for (const discount of discounts) {
        // Check user eligibility
        const userEligible = await this.checkUserEligibility(discount, userId);
        if (!userEligible.eligible) continue;

        // Check applicability
        const applicable = await this.checkApplicability(discount, { 
          productIds, 
          rentalMonths, 
          vendorId 
        });
        if (!applicable.applicable) continue;

        // Check minimum order value
        if (discount.minOrderValue && amount < discount.minOrderValue) continue;

        // Calculate discount amount
        const discountAmount = this.calculateDiscountAmount(discount, amount);

        applicableDiscounts.push({
          ...discount.toObject(),
          discountAmount,
          finalAmount: amount - discountAmount,
          savings: discountAmount
        });
      }

      return applicableDiscounts;
    } catch (error) {
      logger.error('Error in getApplicableDiscounts:', error);
      return [];
    }
  }

  /**
   * Get publicly displayable discounts for storefront surfaces (product page).
   *
   * Returns active, in-validity discounts flagged showOnProduct, optionally
   * filtered to a product/category via applicableOn. Only display-safe fields.
   */
  async getPublicDiscounts({ productId, categoryId } = {}) {
    try {
      const now = new Date();

      const query = {
        status: 'active',
        'validity.startDate': { $lte: now },
        'validity.endDate': { $gte: now },
        'displayConditions.showOnProduct': true,
      };

      // Only surface coupons that apply to everyone or to this product/category.
      const applicable = [{ 'applicableOn.type': 'all' }];
      if (productId) applicable.push({ 'applicableOn.productIds': productId });
      if (categoryId) applicable.push({ 'applicableOn.categoryIds': categoryId });
      query.$or = applicable;

      const discounts = await Discount.find(query)
        .select('code name description type value maxDiscountAmount minOrderValue validity status usageLimits usageCount')
        .sort({ priority: -1, createdAt: -1 })
        .limit(12)
        .lean();

      return discounts
        .filter((d) => this.getDiscountStatus(d) === 'active')
        .map((d) => ({
          code: d.code,
          name: d.name,
          description: d.description,
          type: d.type,
          value: d.value,
          maxDiscountAmount: d.maxDiscountAmount,
          minOrderValue: d.minOrderValue,
          endDate: d.validity?.endDate,
        }));
    } catch (error) {
      logger.error('Error in getPublicDiscounts:', error);
      return [];
    }
  }

  /**
   * Get discount analytics
   */
  async getDiscountAnalytics(startDate, endDate) {
    try {
      const match = {};
      if (startDate || endDate) {
        match.createdAt = {};
        if (startDate) match.createdAt.$gte = new Date(startDate);
        if (endDate) match.createdAt.$lte = new Date(endDate);
      }

      const analytics = await Discount.aggregate([
        { $match: match },
        {
          $facet: {
            overview: [
              {
                $group: {
                  _id: null,
                  totalDiscounts: { $sum: 1 },
                  activeDiscounts: {
                    $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
                  },
                  totalUsage: { $sum: '$usageCount' },
                  totalDiscountAmount: {
                    $sum: {
                      $sum: '$usageHistory.discountAmount'
                    }
                  }
                }
              }
            ],
            byType: [
              {
                $group: {
                  _id: '$type',
                  count: { $sum: 1 },
                  usage: { $sum: '$usageCount' }
                }
              }
            ],
            topDiscounts: [
              {
                $project: {
                  code: 1,
                  name: 1,
                  usageCount: 1,
                  totalSavings: { $sum: '$usageHistory.discountAmount' }
                }
              },
              { $sort: { usageCount: -1 } },
              { $limit: 10 }
            ],
            usageByDay: [
              { $unwind: '$usageHistory' },
              {
                $group: {
                  _id: {
                    year: { $year: '$usageHistory.usedAt' },
                    month: { $month: '$usageHistory.usedAt' },
                    day: { $dayOfMonth: '$usageHistory.usedAt' }
                  },
                  usage: { $sum: 1 },
                  savings: { $sum: '$usageHistory.discountAmount' }
                }
              },
              { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
            ],
            redemptionRate: [
              {
                $group: {
                  _id: null,
                  totalViews: { $sum: '$views' },
                  totalRedemptions: { $sum: '$usageCount' }
                }
              },
              {
                $project: {
                  rate: {
                    $multiply: [
                      { $divide: ['$totalRedemptions', { $max: ['$totalViews', 1] }] },
                      100
                    ]
                  }
                }
              }
            ]
          }
        }
      ]);

      return analytics[0] || {};
    } catch (error) {
      logger.error('Error in getDiscountAnalytics:', error);
      throw error;
    }
  }

  /**
   * Bulk create discounts
   */
  async bulkCreateDiscounts(discountsData, createdBy) {
    const results = {
      successful: [],
      failed: []
    };

    for (const data of discountsData) {
      try {
        const discount = await this.createDiscount(data, createdBy);
        results.successful.push(discount._id);
      } catch (error) {
        results.failed.push({
          name: data.name,
          reason: error.message
        });
      }
    }

    return results;
  }

  /**
   * Export discounts
   */
  async exportDiscounts(format = 'json') {
    try {
      const discounts = await Discount.find()
        .sort({ createdAt: -1 })
        .lean();

      if (format === 'csv') {
        return discounts.map(d => ({
          Code: d.code,
          Name: d.name,
          Type: d.type,
          Value: d.value,
          'Min Order': d.minOrderValue,
          'Max Discount': d.maxDiscountAmount,
          'Start Date': new Date(d.validity.startDate).toLocaleDateString(),
          'End Date': new Date(d.validity.endDate).toLocaleDateString(),
          'Usage Count': d.usageCount,
          'Usage Limit': d.usageLimits.global || 'Unlimited',
          Status: d.status,
          Stackable: d.stackable ? 'Yes' : 'No',
          Priority: d.priority
        }));
      }

      return discounts;
    } catch (error) {
      logger.error('Error in exportDiscounts:', error);
      throw error;
    }
  }

  /**
   * Import discounts
   */
  async importDiscounts(discountsData, createdBy) {
    return this.bulkCreateDiscounts(discountsData, createdBy);
  }

  /**
   * Check expiring discounts
   */
  async checkExpiringDiscounts(days = 7) {
    try {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + days);

      const expiringDiscounts = await Discount.find({
        status: 'active',
        'validity.endDate': { 
          $gte: new Date(), 
          $lte: expiryDate 
        }
      });

      // Send notifications for expiring discounts
      for (const discount of expiringDiscounts) {
        await addJob('notification', 'create', {
          role: 'admin',
          type: 'in_app',
          title: '⚠️ Discount Expiring Soon',
          content: `Discount "${discount.name}" (${discount.code}) expires on ${new Date(discount.validity.endDate).toLocaleDateString()}`,
          data: {
            discountId: discount._id,
            code: discount.code,
            expiryDate: discount.validity.endDate
          }
        });
      }

      return expiringDiscounts.length;
    } catch (error) {
      logger.error('Error in checkExpiringDiscounts:', error);
      throw error;
    }
  }

  /**
   * Deactivate expired discounts
   */
  async deactivateExpiredDiscounts() {
    try {
      const result = await Discount.updateMany(
        {
          status: 'active',
          'validity.endDate': { $lt: new Date() }
        },
        {
          $set: { status: 'expired' }
        }
      );

      logger.info(`Deactivated ${result.modifiedCount} expired discounts`);
      return result.modifiedCount;
    } catch (error) {
      logger.error('Error in deactivateExpiredDiscounts:', error);
      throw error;
    }
  }

  /**
   * Invalidate discount cache
   */
  async invalidateDiscountCache(discountId) {
    try {
      if (this.redisClient) {
        const patterns = [
          `discount:${discountId}`,
          `discount:code:*`,
          'discounts:list:*',
          'discounts:applicable:*'
        ];
        
        for (const pattern of patterns) {
          const keys = await this.redisClient.keys(pattern);
          if (keys.length > 0) {
            await this.redisClient.del(keys);
          }
        }
      }
    } catch (error) {
      logger.error('Error invalidating discount cache:', error);
    }
  }
}

module.exports = new DiscountService();