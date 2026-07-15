// services/vendorAnalytics.service.js
const { Vendor, User, Product, Rental, Review, Payment } = require('../models');
const mongoose = require('mongoose');
const moment = require('moment');

class VendorAnalyticsService {
  getDateRange(period) {
    const end = new Date();
    let start;
    
    switch(period) {
      case '7d': start = moment().subtract(7, 'days').toDate(); break;
      case '30d': start = moment().subtract(30, 'days').toDate(); break;
      case '90d': start = moment().subtract(90, 'days').toDate(); break;
      case '1y': start = moment().subtract(1, 'year').toDate(); break;
      default: start = moment().subtract(30, 'days').toDate();
    }
    
    return { start, end };
  }

  async getOverview(vendorId, period) {
    const dateRange = this.getDateRange(period);
    
    const [revenue, rentals, products, ratings] = await Promise.all([
      this.getRevenueOverview(vendorId, dateRange),
      this.getRentalOverview(vendorId, dateRange),
      this.getProductOverview(vendorId),
      this.getRatingOverview(vendorId, dateRange)
    ]);
    
    // Calculate growth rates
    const previousPeriod = {
      start: moment(dateRange.start).subtract(moment(dateRange.end).diff(dateRange.start), 'ms').toDate(),
      end: dateRange.start
    };
    
    const previousRevenue = await this.getRevenueTotal(vendorId, previousPeriod);
    const previousRentals = await this.getRentalCount(vendorId, previousPeriod);
    
    return {
      period,
      kpi: {
        revenue: {
          current: revenue.total,
          previous: previousRevenue,
          growth: previousRevenue ? ((revenue.total - previousRevenue) / previousRevenue) * 100 : 0
        },
        rentals: {
          current: rentals.total,
          previous: previousRentals,
          growth: previousRentals ? ((rentals.total - previousRentals) / previousRentals) * 100 : 0
        },
        activeProducts: products.active,
        averageRating: ratings.average,
        totalCustomers: rentals.uniqueCustomers
      },
      revenueByDay: revenue.daily,
      rentalsByStatus: rentals.byStatus,
      recentActivity: await this.getRecentActivity(vendorId, dateRange)
    };
  }

  async getRevenueTotal(vendorId, dateRange) {
    const result = await Payment.aggregate([
      { $match: { vendor: vendorId, status: 'success', createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    return result[0]?.total || 0;
  }

  
  async getRentalCount(vendorId, dateRange) {
    const result = await Rental.aggregate([
        { 
        $match: { 
            vendor: vendorId, 
            createdAt: { $gte: dateRange.start, $lte: dateRange.end } 
        } 
        },
        { $count: 'count' }
    ]);
    return result[0]?.count || 0;
  }

  async getRevenueOverview(vendorId, dateRange) {
    const result = await Payment.aggregate([
      { $match: { vendor: vendorId, status: 'success', createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
      {
        $facet: {
          total: [{ $group: { _id: null, amount: { $sum: '$amount' } } }],
          daily: [
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                amount: { $sum: '$amount' },
                count: { $sum: 1 }
              }
            },
            { $sort: { _id: 1 } }
          ],
          byType: [
            { $group: { _id: '$type', amount: { $sum: '$amount' }, count: { $sum: 1 } } }
          ],
          byMethod: [
            { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } }
          ]
        }
      }
    ]);
    
    return {
      total: result[0]?.total[0]?.amount || 0,
      daily: result[0]?.daily || [],
      byType: result[0]?.byType || [],
      byMethod: result[0]?.byMethod || []
    };
  }

  async getRentalOverview(vendorId, dateRange) {
    const result = await Rental.aggregate([
      { $match: { vendor: vendorId, createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
      {
        $facet: {
          total: [{ $group: { _id: null, count: { $sum: 1 } } }],
          uniqueCustomers: [{ $group: { _id: '$user' } }, { $count: 'count' }],
          byStatus: [
            { $group: { _id: '$status', count: { $sum: 1 } } }
          ],
          byMonth: [
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
                count: { $sum: 1 }
              }
            },
            { $sort: { _id: 1 } }
          ]
        }
      }
    ]);
    
    return {
      total: result[0]?.total[0]?.count || 0,
      uniqueCustomers: result[0]?.uniqueCustomers[0]?.count || 0,
      byStatus: result[0]?.byStatus || [],
      byMonth: result[0]?.byMonth || []
    };
  }

  async getProductOverview(vendorId) {
    const result = await Product.aggregate([
      { $match: { vendor: vendorId } },
      {
        $facet: {
          total: [{ $count: 'count' }],
          active: [
            { $match: { 'status.isActive': true } },
            { $count: 'count' }
          ],
          outOfStock: [
            { $match: { 'inventory.availableQuantity': 0 } },
            { $count: 'count' }
          ],
          lowStock: [
            { $match: { 'inventory.availableQuantity': { $lt: 5 } } },
            { $count: 'count' }
          ]
        }
      }
    ]);
    
    return {
      total: result[0]?.total[0]?.count || 0,
      active: result[0]?.active[0]?.count || 0,
      outOfStock: result[0]?.outOfStock[0]?.count || 0,
      lowStock: result[0]?.lowStock[0]?.count || 0
    };
  }

  async getRatingOverview(vendorId, dateRange) {
    const result = await Review.aggregate([
      { $match: { vendor: vendorId, createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
      {
        $group: {
          _id: null,
          average: { $avg: '$ratings.overall' },
          total: { $sum: 1 },
          distribution: {
            $push: '$ratings.overall'
          }
        }
      }
    ]);
    
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (result[0]?.distribution) {
      result[0].distribution.forEach(r => distribution[r]++);
    }
    
    return {
      average: result[0]?.average || 0,
      total: result[0]?.total || 0,
      distribution
    };
  }

  async getRecentActivity(vendorId, dateRange) {
    const recentRentals = await Rental.find({ vendor: vendorId })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('user', 'profile.firstName profile.lastName')
      .populate('product', 'basicInfo.name')
      .lean();
    
    return recentRentals.map(r => ({
      id: r._id,
      type: 'rental',
      action: `New rental order`,
      customer: `${r.user?.profile?.firstName || ''} ${r.user?.profile?.lastName || ''}`,
      product: r.product?.basicInfo?.name,
      amount: r.rentalDetails?.totalAmount,
      status: r.status,
      time: r.createdAt
    }));
  }

  async getSalesReport(vendorId, period) {
    const dateRange = this.getDateRange(period);
    
    const [revenue, rentals, topProducts] = await Promise.all([
      this.getRevenueOverview(vendorId, dateRange),
      this.getRentalOverview(vendorId, dateRange),
      this.getTopProducts(vendorId, dateRange, 10)
    ]);
    
    // Calculate monthly trends
    const monthlyTrends = await Payment.aggregate([
      { 
        $match: { 
          vendor: vendorId, 
          status: 'success',
          createdAt: { $gte: dateRange.start, $lte: dateRange.end }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          revenue: { $sum: '$amount' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    return {
      period,
      summary: {
        totalRevenue: revenue.total,
        totalOrders: rentals.total,
        averageOrderValue: rentals.total ? revenue.total / rentals.total : 0,
        uniqueCustomers: rentals.uniqueCustomers
      },
      dailyRevenue: revenue.daily,
      monthlyTrends,
      topProducts,
      revenueByType: revenue.byType,
      revenueByMethod: revenue.byMethod
    };
  }

  async getTopProducts(vendorId, dateRange, limit = 10) {
    const result = await Rental.aggregate([
      { $match: { vendor: vendorId, createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
      {
        $group: {
          _id: '$product',
          totalRentals: { $sum: 1 },
          totalRevenue: { $sum: '$rentalDetails.totalAmount' },
          uniqueCustomers: { $addToSet: '$user' }
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $project: {
          productId: '$_id',
          name: '$product.basicInfo.name',
          category: '$product.category',
          monthlyRent: '$product.pricing.monthlyRent',
          totalRentals: 1,
          totalRevenue: 1,
          uniqueCustomers: { $size: '$uniqueCustomers' },
          image: { $arrayElemAt: ['$product.media.images.url', 0] }
        }
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: limit }
    ]);
    
    return result;
  }

  async getProductPerformance(vendorId, period, limit = 10) {
    const dateRange = this.getDateRange(period);
    
    const [topProducts, categoryBreakdown, inventoryStatus] = await Promise.all([
      this.getTopProducts(vendorId, dateRange, limit),
      this.getCategoryBreakdown(vendorId, dateRange),
      this.getInventoryStatus(vendorId)
    ]);
    
    // Get product views (would need product analytics collection)
    const productViews = await this.getProductViews(vendorId, dateRange);
    
    return {
      period,
      topProducts: topProducts.map(p => ({
        ...p,
        views: productViews[p.productId] || 0,
        conversionRate: productViews[p.productId] ? (p.totalRentals / productViews[p.productId]) * 100 : 0
      })),
      categoryBreakdown,
      inventoryStatus,
      totalProducts: await Product.countDocuments({ vendor: vendorId }),
      activeProducts: await Product.countDocuments({ vendor: vendorId, 'status.isActive': true })
    };
  }

  async getCategoryBreakdown(vendorId, dateRange) {
    const result = await Rental.aggregate([
      { $match: { vendor: vendorId, createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $lookup: {
          from: 'categories',
          localField: 'product.category',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: '$category' },
      {
        $group: {
          _id: '$category.name',
          totalRentals: { $sum: 1 },
          totalRevenue: { $sum: '$rentalDetails.totalAmount' }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);
    
    return result;
  }

  async getInventoryStatus(vendorId) {
    const result = await Product.aggregate([
      { $match: { vendor: vendorId } },
      {
        $group: {
          _id: null,
          totalInventory: { $sum: '$inventory.totalQuantity' },
          availableInventory: { $sum: '$inventory.availableQuantity' },
          rentedInventory: { $sum: '$inventory.rentedQuantity' },
          lowStockProducts: {
            $sum: { $cond: [{ $lt: ['$inventory.availableQuantity', 5] }, 1, 0] }
          },
          outOfStockProducts: {
            $sum: { $cond: [{ $eq: ['$inventory.availableQuantity', 0] }, 1, 0] }
          }
        }
      }
    ]);
    
    const stats = result[0] || { totalInventory: 0, availableInventory: 0, rentedInventory: 0, lowStockProducts: 0, outOfStockProducts: 0 };
    
    return {
      ...stats,
      utilizationRate: stats.totalInventory ? (stats.rentedInventory / stats.totalInventory) * 100 : 0
    };
  }

  async getProductViews(vendorId, dateRange) {
    // This would query a product_views collection
    // For now, return mock data based on rental counts
    const rentals = await Rental.aggregate([
      { $match: { vendor: vendorId, createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
      { $group: { _id: '$product', count: { $sum: 1 } } }
    ]);
    
    const views = {};
    rentals.forEach(r => {
      views[r._id] = r.count * 10; // Assume 10 views per rental
    });
    
    return views;
  }

  async getCustomerInsights(vendorId, period) {
    const dateRange = this.getDateRange(period);
    
    const customerData = await Rental.aggregate([
      { $match: { vendor: vendorId, createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
      {
        $group: {
          _id: '$user',
          totalSpent: { $sum: '$rentalDetails.totalAmount' },
          totalRentals: { $sum: 1 },
          lastRental: { $max: '$createdAt' },
          firstRental: { $min: '$createdAt' },
          products: { $addToSet: '$product' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          customerId: '$_id',
          name: { $concat: ['$user.profile.firstName', ' ', '$user.profile.lastName'] },
          email: '$user.email',
          phone: '$user.phone',
          totalSpent: 1,
          totalRentals: 1,
          lastRental: 1,
          firstRental: 1,
          uniqueProducts: { $size: '$products' }
        }
      },
      { $sort: { totalSpent: -1 } }
    ]);
    
    // Calculate segments
    const segments = {
      vip: customerData.filter(c => c.totalSpent > 50000),
      frequent: customerData.filter(c => c.totalRentals >= 3 && c.totalSpent <= 50000),
      regular: customerData.filter(c => c.totalRentals === 2 && c.totalSpent <= 25000),
      new: customerData.filter(c => c.totalRentals === 1 && c.totalSpent <= 10000)
    };
    
    // Calculate repeat rate
    const repeatCustomers = customerData.filter(c => c.totalRentals > 1).length;
    const repeatRate = customerData.length ? (repeatCustomers / customerData.length) * 100 : 0;
    
    // Calculate average LTV
    const avgLTV = customerData.length ? customerData.reduce((sum, c) => sum + c.totalSpent, 0) / customerData.length : 0;
    
    // Get top customers
    const topCustomers = customerData.slice(0, 10);
    
    // Get recent customers
    const recentCustomers = await Rental.aggregate([
      { $match: { vendor: vendorId } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$user', lastOrder: { $first: '$createdAt' } } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' }
    ]);
    
    return {
      period,
      summary: {
        totalCustomers: customerData.length,
        repeatCustomers,
        repeatRate,
        avgLTV,
        vipCount: segments.vip.length,
        frequentCount: segments.frequent.length
      },
      segments,
      topCustomers,
      customerList: customerData
    };
  }
}

module.exports = new VendorAnalyticsService();