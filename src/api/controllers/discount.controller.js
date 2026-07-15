const DiscountService = require('../../services/discount.service');
const catchAsync = require('../../utils/catchAsync');
const {ApiResponse} = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');

class DiscountController {
  /**
   * Create discount
   */
  createDiscount = catchAsync(async (req, res) => {
    const discount = await DiscountService.createDiscount(req.body, req.admin?._id || req.user?._id);
    
    return ApiResponse.success(res, 201, 'Discount created successfully', { discount });
  });

  /**
   * Get discount by ID or code
   */
  getDiscount = catchAsync(async (req, res) => {
    const { identifier } = req.params;
    
    const discount = await DiscountService.getDiscount(identifier);
    
    return ApiResponse.success(res, 200, 'Discount retrieved successfully', { discount });
  });

  /**
   * Get all discounts
   */
  getAllDiscounts = catchAsync(async (req, res) => {
    const { page = 1, limit = 20, ...filters } = req.query;
    
    const discounts = await DiscountService.getAllDiscounts(
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Discounts retrieved successfully', discounts);
  });

  /**
   * Update discount
   */
  updateDiscount = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const discount = await DiscountService.updateDiscount(id, req.body, req.admin?._id || req.user?._id);
    
    return ApiResponse.success(res, 200, 'Discount updated successfully', { discount });
  });

  /**
   * Delete discount
   */
  deleteDiscount = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const result = await DiscountService.deleteDiscount(id, req.admin?._id || req.user?._id);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Validate discount
   */
  validateDiscount = catchAsync(async (req, res) => {
    const { code } = req.params;
    const { amount, productIds, rentalMonths, vendorId } = req.body;

    if (!amount) {
      throw new AppError('Order amount is required', 400);
    }

    const result = await DiscountService.validateDiscount(
      code,
      req.user?._id,
      { amount, productIds, rentalMonths, vendorId }
    );
    
    return ApiResponse.success(res, 200, 'Discount validated successfully', result);
  });

  /**
   * Apply discount
   */
  applyDiscount = catchAsync(async (req, res) => {
    const { code } = req.params;
    const { amount, productIds, rentalMonths, vendorId, rentalId } = req.body;

    if (!amount) {
      throw new AppError('Order amount is required', 400);
    }

    const result = await DiscountService.applyDiscount(
      code,
      req.user._id,
      { amount, productIds, rentalMonths, vendorId, rentalId }
    );
    
    return ApiResponse.success(res, 200, result.message, result);
  });

  /**
   * Get publicly displayable discounts (storefront / product page)
   */
  getPublicDiscounts = catchAsync(async (req, res) => {
    const { productId, categoryId } = req.query;

    const discounts = await DiscountService.getPublicDiscounts({ productId, categoryId });

    return ApiResponse.success(res, 200, 'Public discounts retrieved successfully', { discounts });
  });

  /**
   * Get applicable discounts for current order
   */
  getApplicableDiscounts = catchAsync(async (req, res) => {
    const { amount, productIds, rentalMonths, vendorId } = req.body;

    if (!amount) {
      throw new AppError('Order amount is required', 400);
    }

    const discounts = await DiscountService.getApplicableDiscounts(
      req.user._id,
      { amount, productIds, rentalMonths, vendorId }
    );
    
    return ApiResponse.success(res, 200, 'Applicable discounts retrieved successfully', { discounts });
  });

  /**
   * Get discount analytics
   */
  getDiscountAnalytics = catchAsync(async (req, res) => {
    const { startDate, endDate } = req.query;
    
    const analytics = await DiscountService.getDiscountAnalytics(startDate, endDate);
    
    return ApiResponse.success(res, 200, 'Discount analytics retrieved successfully', analytics);
  });

  /**
   * Bulk create discounts
   */
  bulkCreateDiscounts = catchAsync(async (req, res) => {
    const { discounts } = req.body;
    
    if (!Array.isArray(discounts)) {
      throw new AppError('Discounts must be an array', 400);
    }

    const results = await DiscountService.bulkCreateDiscounts(
      discounts,
      req.admin?._id || req.user?._id
    );
    
    return ApiResponse.success(res, 200, 'Bulk discount creation completed', results);
  });

  /**
   * Export discounts
   */
  exportDiscounts = catchAsync(async (req, res) => {
    const { format = 'json' } = req.query;
    
    const data = await DiscountService.exportDiscounts(format);
    
    if (format === 'csv') {
      const { Parser } = require('json2csv');
      const parser = new Parser();
      const csv = parser.parse(data);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=discounts-export.csv');
      return res.send(csv);
    }
    
    return ApiResponse.success(res, 200, 'Discounts exported successfully', { discounts: data });
  });

  /**
   * Import discounts
   */
  importDiscounts = catchAsync(async (req, res) => {
    const { discounts } = req.body;
    
    if (!Array.isArray(discounts)) {
      throw new AppError('Discounts must be an array', 400);
    }

    const results = await DiscountService.importDiscounts(
      discounts,
      req.admin?._id || req.user?._id
    );
    
    return ApiResponse.success(res, 200, 'Discounts imported successfully', results);
  });

  /**
   * Toggle discount status
   */
  toggleDiscountStatus = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!['active', 'inactive', 'disabled'].includes(status)) {
      throw new AppError('Invalid status', 400);
    }

    const discount = await DiscountService.updateDiscount(
      id,
      { status },
      req.admin?._id || req.user?._id
    );
    
    return ApiResponse.success(res, 200, `Discount ${status} successfully`, { discount });
  });

  /**
   * Get discount usage history
   */
  getDiscountUsage = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    
    const discount = await DiscountService.getDiscount(id);
    
    const usage = discount.usageHistory || [];
    const total = usage.length;
    const skip = (page - 1) * limit;
    
    const paginatedUsage = usage
      .sort((a, b) => new Date(b.usedAt) - new Date(a.usedAt))
      .slice(skip, skip + parseInt(limit));

    return ApiResponse.success(res, 200, 'Discount usage retrieved successfully', {
      usage: paginatedUsage,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  });

  /**
   * Get discount statistics
   */
  getDiscountStats = catchAsync(async (req, res) => {
    const stats = await Discount.aggregate([
      {
        $group: {
          _id: null,
          totalDiscounts: { $sum: 1 },
          activeDiscounts: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
          },
          totalUsage: { $sum: '$usageCount' },
          averageUsage: { $avg: '$usageCount' },
          byType: {
            $push: {
              type: '$type',
              count: 1
            }
          }
        }
      }
    ]);

    return ApiResponse.success(res, 200, 'Discount statistics retrieved successfully', stats[0] || {});
  });

  /**
   * Check expiring discounts (admin only)
   */
  checkExpiringDiscounts = catchAsync(async (req, res) => {
    const { days = 7 } = req.query;
    
    const count = await DiscountService.checkExpiringDiscounts(parseInt(days));
    
    return ApiResponse.success(res, 200, `Found ${count} expiring discounts`, { count });
  });

  /**
   * Deactivate expired discounts (cron job)
   */
  deactivateExpiredDiscounts = catchAsync(async (req, res) => {
    const count = await DiscountService.deactivateExpiredDiscounts();
    
    return ApiResponse.success(res, 200, `Deactivated ${count} expired discounts`);
  });
}

module.exports = new DiscountController();