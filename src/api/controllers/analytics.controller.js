const AnalyticsService = require('../../services/analytics.service');
const catchAsync = require('../../utils/catchAsync');
const {ApiResponse} = require('../../utils/apiResponse');
const {AppError} = require('../../utils/AppError');
const logger = require('../../config/logger');
const { User, Rental, Payment } = require('../../models');

class AnalyticsController {
  /**
   * Get platform overview
   */
  getPlatformOverview = catchAsync(async (req, res) => {
    const { period = '30d' } = req.query;
    
    const analytics = await AnalyticsService.getPlatformOverview(period);
    
    return ApiResponse.success(res, 200, 'Platform analytics retrieved successfully', analytics);
  });

  /**
   * Get user analytics
   */
  getUserAnalytics = catchAsync(async (req, res) => {
    const { period = '30d' } = req.query;
    
    const dateRange = AnalyticsService.getDateRange(period);
    const analytics = await AnalyticsService.getUserAnalytics(dateRange);
    
    // return ApiResponse.success(res, 200, 'User analytics retrieved successfully', analytics);
    return ApiResponse.success(res, 200, 'User analytics retrieved successfully', analytics);
    
  });

  /**
   * Get vendor analytics
   */
  getVendorAnalytics = catchAsync(async (req, res) => {
    const { period = '30d' } = req.query;
    
    const dateRange = AnalyticsService.getDateRange(period);
    const analytics = await AnalyticsService.getVendorAnalytics(dateRange);
    
    return ApiResponse.success(res, 200, 'Vendor analytics retrieved successfully', analytics);
  });

  /**
   * Get product analytics
   */
  getProductAnalytics = catchAsync(async (req, res) => {
    const { period = '30d' } = req.query;
    
    const dateRange = AnalyticsService.getDateRange(period);
    const analytics = await AnalyticsService.getProductAnalytics(dateRange);
    
    return ApiResponse.success(res, 200, 'Product analytics retrieved successfully', analytics);
  });

  /**
   * Get rental analytics
   */
  getRentalAnalytics = catchAsync(async (req, res) => {
    const { period = '30d' } = req.query;
    
    const dateRange = AnalyticsService.getDateRange(period);
    const analytics = await AnalyticsService.getRentalAnalytics(dateRange);
    
    return ApiResponse.success(res, 200, 'Rental analytics retrieved successfully', analytics);
  });

  /**
   * Get revenue analytics
   */
  getRevenueAnalytics = catchAsync(async (req, res) => {
    const { period = '30d' } = req.query;
    
    const dateRange = AnalyticsService.getDateRange(period);
    const analytics = await AnalyticsService.getRevenueAnalytics(dateRange);
    
    return ApiResponse.success(res, 200, 'Revenue analytics retrieved successfully', analytics);
  });

  /**
   * Get inventory analytics
   */
  getInventoryAnalytics = catchAsync(async (req, res) => {
    const { vendorId } = req.query;
    
    const analytics = await AnalyticsService.getInventoryAnalytics(vendorId);
    
    return ApiResponse.success(res, 200, 'Inventory analytics retrieved successfully', analytics);
  });

  /**
   * Get customer analytics
   */
  getCustomerAnalytics = catchAsync(async (req, res) => {
    const analytics = await AnalyticsService.getCustomerAnalytics();
    
    return ApiResponse.success(res, 200, 'Customer analytics retrieved successfully', analytics);
  });

  /**
   * Get performance metrics
   */
  getPerformanceMetrics = catchAsync(async (req, res) => {
    const metrics = await AnalyticsService.getPerformanceMetrics();
    
    return ApiResponse.success(res, 200, 'Performance metrics retrieved successfully', metrics);
  });

  /**
   * Get growth metrics
   */
  getGrowthMetrics = catchAsync(async (req, res) => {
    const { period = '30d' } = req.query;
    
    const dateRange = AnalyticsService.getDateRange(period);
    const metrics = await AnalyticsService.getGrowthMetrics(dateRange);
    
    return ApiResponse.success(res, 200, 'Growth metrics retrieved successfully', metrics);
  });

  /**
   * Get retention analytics
   */
  getRetentionAnalytics = catchAsync(async (req, res) => {
    const retention = await AnalyticsService.getUserRetention();
    
    return ApiResponse.success(res, 200, 'Retention analytics retrieved successfully', { cohorts: retention });
  });

  /**
   * Get conversion funnel
   */
  getConversionFunnel = catchAsync(async (req, res) => {
    const { period = '30d' } = req.query;
    
    const dateRange = AnalyticsService.getDateRange(period);
    const funnel = await AnalyticsService.getRentalConversionRate(dateRange);
    
    return ApiResponse.success(res, 200, 'Conversion funnel retrieved successfully', funnel);
  });

  /**
   * Get dashboard summary
   */
  getDashboardSummary = catchAsync(async (req, res) => {
    const { period = '30d' } = req.query;
    
    const [
      overview,
      revenue,
      topProducts,
      recentActivity
    ] = await Promise.all([
      AnalyticsService.getPlatformOverview(period),
      AnalyticsService.getRevenueAnalytics(AnalyticsService.getDateRange(period)),
      AnalyticsService.getProductAnalytics(AnalyticsService.getDateRange(period)),
      this.getRecentActivity()
    ]);

    return ApiResponse.success(res, 200, 'Dashboard summary retrieved successfully', {
      overview,
      revenue: revenue.overview?.[0],
      topProducts: topProducts.topRented,
      recentActivity
    });
  });

  /**
   * Get recent activity
   */
  async getRecentActivity() {
    const [recentUsers, recentRentals, recentPayments] = await Promise.all([
      User.find().sort({ createdAt: -1 }).limit(5).select('profile.firstName profile.lastName createdAt').lean(),
      Rental.find().populate('user', 'profile.firstName profile.lastName').sort({ createdAt: -1 }).limit(5).lean(),
      Payment.find({ status: 'success' }).populate('user', 'profile.firstName profile.lastName').sort({ createdAt: -1 }).limit(5).lean()
    ]);

    return {
      users: recentUsers.map(u => ({
        type: 'user',
        action: 'joined',
        user: `${u.profile.firstName} ${u.profile.lastName}`,
        time: u.createdAt
      })),
      rentals: recentRentals.map(r => ({
        type: 'rental',
        action: 'created',
        user: `${r.user?.profile?.firstName || ''} ${r.user?.profile?.lastName || ''}`,
        details: `Rental #${r.rentalNumber}`,
        time: r.createdAt
      })),
      payments: recentPayments.map(p => ({
        type: 'payment',
        action: 'received',
        user: `${p.user?.profile?.firstName || ''} ${p.user?.profile?.lastName || ''}`,
        details: `₹${p.amount}`,
        time: p.createdAt
      }))
    };
  }

  /**
   * Export analytics data
   */
  exportAnalytics = catchAsync(async (req, res) => {
    const { type, period = '30d', format = 'json' } = req.query;
    
    if (!type) {
      throw new AppError('Analytics type is required', 400);
    }

    const dateRange = AnalyticsService.getDateRange(period);
    let data;

    switch (type) {
      case 'users':
        data = await AnalyticsService.getUserAnalytics(dateRange);
        break;
      case 'vendors':
        data = await AnalyticsService.getVendorAnalytics(dateRange);
        break;
      case 'products':
        data = await AnalyticsService.getProductAnalytics(dateRange);
        break;
      case 'rentals':
        data = await AnalyticsService.getRentalAnalytics(dateRange);
        break;
      case 'revenue':
        data = await AnalyticsService.getRevenueAnalytics(dateRange);
        break;
      default:
        throw new AppError('Invalid analytics type', 400);
    }

    if (format === 'csv') {
      // Flatten data for CSV export
      const flattened = this.flattenForCSV(data);
      const { Parser } = require('json2csv');
      const parser = new Parser();
      const csv = parser.parse(flattened);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${type}-analytics-${period}.csv`);
      return res.send(csv);
    }

    return ApiResponse.success(res, 200, 'Analytics exported successfully', data);
  });

  /**
   * Flatten nested objects for CSV export
   */
  flattenForCSV(obj, prefix = '') {
    let result = [];
    
    const flatten = (obj, prefix) => {
      if (Array.isArray(obj)) {
        obj.forEach(item => {
          if (typeof item === 'object') {
            flatten(item, prefix);
          } else {
            result.push({ [prefix]: item });
          }
        });
      } else if (typeof obj === 'object' && obj !== null) {
        Object.entries(obj).forEach(([key, value]) => {
          const newPrefix = prefix ? `${prefix}.${key}` : key;
          if (typeof value === 'object' && value !== null) {
            flatten(value, newPrefix);
          } else {
            result.push({ [newPrefix]: value });
          }
        });
      }
    };

    flatten(obj, prefix);
    return result;
  }

  /**
   * Invalidate analytics cache (admin only)
   */
  invalidateCache = catchAsync(async (req, res) => {
    await AnalyticsService.invalidateAnalyticsCache();
    
    return ApiResponse.success(res, 200, 'Analytics cache invalidated successfully');
  });
}

module.exports = new AnalyticsController();