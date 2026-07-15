// const { User, Vendor, Product, Rental, Payment, Review, Inventory, Maintenance } = require('../models');
// const { AppError } = require('../utils/AppError');
// const { getRedisClient } = require('../config/redis');
// const logger = require('../config/logger');
// const mongoose = require('mongoose');
// const moment = require('moment');

// class AnalyticsService {
//   constructor() {
//     this.redisClient = getRedisClient();
//     this.cacheTTL = 1800; // 30 minutes
//   }

//   /**
//    * Get platform overview analytics
//    */
//   async getPlatformOverview(period = '30d') {
//     try {
//       const cacheKey = `analytics:platform:overview:${period}`;
      
//       // Try cache first
//       if (this.redisClient) {
//         const cached = await this.redisClient.get(cacheKey);
//         if (cached) {
//           return JSON.parse(cached);
//         }
//       }

//       const dateRange = this.getDateRange(period);
      
//       const [
//         userStats,
//         vendorStats,
//         productStats,
//         rentalStats,
//         revenueStats,
//         growthMetrics
//       ] = await Promise.all([
//         this.getUserAnalytics(dateRange),
//         this.getVendorAnalytics(dateRange),
//         this.getProductAnalytics(dateRange),
//         this.getRentalAnalytics(dateRange),
//         this.getRevenueAnalytics(dateRange),
//         this.getGrowthMetrics(dateRange)
//       ]);

//       const analytics = {
//         period,
//         dateRange,
//         users: userStats,
//         vendors: vendorStats,
//         products: productStats,
//         rentals: rentalStats,
//         revenue: revenueStats,
//         growth: growthMetrics,
//         timestamp: new Date()
//       };

//       // Cache the result
//       if (this.redisClient) {
//         await this.redisClient.setex(cacheKey, this.cacheTTL, JSON.stringify(analytics));
//       }

//       return analytics;
//     } catch (error) {
//       logger.error('Error in getPlatformOverview:', error);
//       throw error;
//     }
//   }

//   /**
//    * Get user analytics
//    */
//   async getUserAnalytics(dateRange = null) {
//     try {
//       const matchStage = dateRange ? {
//         createdAt: { $gte: dateRange.start, $lte: dateRange.end }
//       } : {};

//       const analytics = await User.aggregate([
//         {
//           $facet: {
//             overview: [
//               {
//                 $group: {
//                   _id: null,
//                   totalUsers: { $sum: 1 },
//                   activeUsers: {
//                     $sum: { $cond: [{ $eq: ['$status.isActive', true] }, 1, 0] }
//                   },
//                   verifiedUsers: {
//                     $sum: { $cond: [{ $eq: ['$verification.email', true] }, 1, 0] }
//                   },
//                   kycApproved: {
//                     $sum: { $cond: [{ $eq: ['$verification.kyc.status', 'approved'] }, 1, 0] }
//                   }
//                 }
//               }
//             ],
//             byRole: [
//               {
//                 $group: {
//                   _id: '$role',
//                   count: { $sum: 1 }
//                 }
//               }
//             ],
//             dailySignups: [
//               {
//                 $match: matchStage
//               },
//               {
//                 $group: {
//                   _id: {
//                     year: { $year: '$createdAt' },
//                     month: { $month: '$createdAt' },
//                     day: { $dayOfMonth: '$createdAt' }
//                   },
//                   count: { $sum: 1 }
//                 }
//               },
//               { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
//             ],
//             retention: await this.getUserRetention(),
//             geography: [
//               {
//                 $lookup: {
//                   from: 'addresses',
//                   localField: '_id',
//                   foreignField: 'user',
//                   as: 'addresses'
//                 }
//               },
//               { $unwind: '$addresses' },
//               {
//                 $group: {
//                   _id: '$addresses.city',
//                   count: { $sum: 1 }
//                 }
//               },
//               { $sort: { count: -1 } },
//               { $limit: 10 }
//             ]
//           }
//         }
//       ]);

//       return analytics[0] || {};
//     } catch (error) {
//       logger.error('Error in getUserAnalytics:', error);
//       throw error;
//     }
//   }

//   /**
//    * Get user retention metrics
//    */
//   async getUserRetention() {
//     try {
//       const cohorts = await User.aggregate([
//         {
//           $group: {
//             _id: {
//               year: { $year: '$createdAt' },
//               month: { $month: '$createdAt' }
//             },
//             users: { $push: '$_id' },
//             count: { $sum: 1 }
//           }
//         },
//         { $sort: { '_id.year': 1, '_id.month': 1 } },
//         { $limit: 12 }
//       ]);

//       const retention = [];

//       for (const cohort of cohorts) {
//         const cohortUsers = cohort.users;
//         const monthlyRetention = [];

//         for (let i = 0; i < 6; i++) {
//           const monthDate = moment()
//             .year(cohort._id.year)
//             .month(cohort._id.month - 1)
//             .add(i, 'months')
//             .toDate();

//           const endDate = moment(monthDate).endOf('month').toDate();

//           const activeInMonth = await Rental.countDocuments({
//             user: { $in: cohortUsers },
//             createdAt: { $lte: endDate }
//           });

//           monthlyRetention.push({
//             month: i,
//             activeUsers: activeInMonth,
//             retentionRate: cohort.count ? (activeInMonth / cohort.count) * 100 : 0
//           });
//         }

//         retention.push({
//           cohort: `${cohort._id.year}-${cohort._id.month}`,
//           totalUsers: cohort.count,
//           monthlyRetention
//         });
//       }

//       return retention;
//     } catch (error) {
//       logger.error('Error in getUserRetention:', error);
//       return [];
//     }
//   }

//   /**
//    * Get vendor analytics
//    */
//   async getVendorAnalytics(dateRange = null) {
//     try {
//       const matchStage = dateRange ? {
//         createdAt: { $gte: dateRange.start, $lte: dateRange.end }
//       } : {};

//       const analytics = await Vendor.aggregate([
//         {
//           $facet: {
//             overview: [
//               {
//                 $group: {
//                   _id: null,
//                   totalVendors: { $sum: 1 },
//                   activeVendors: {
//                     $sum: { $cond: [{ $eq: ['$status.isActive', true] }, 1, 0] }
//                   },
//                   verifiedVendors: {
//                     $sum: { $cond: [{ $eq: ['$verification.status', 'verified'] }, 1, 0] }
//                   },
//                   pendingVendors: {
//                     $sum: { $cond: [{ $eq: ['$verification.status', 'pending'] }, 1, 0] }
//                   }
//                 }
//               }
//             ],
//             byPlan: [
//               {
//                 $group: {
//                   _id: '$subscription.plan',
//                   count: { $sum: 1 },
//                   avgRating: { $avg: '$performance.rating.average' }
//                 }
//               }
//             ],
//             topPerformers: [
//               {
//                 $match: {
//                   'performance.rating.average': { $gt: 0 }
//                 }
//               },
//               {
//                 $sort: { 'performance.rating.average': -1, 'performance.metrics.completedRentals': -1 }
//               },
//               { $limit: 10 },
//               {
//                 $lookup: {
//                   from: 'users',
//                   localField: 'user',
//                   foreignField: '_id',
//                   as: 'user'
//                 }
//               },
//               { $unwind: '$user' },
//               {
//                 $project: {
//                   businessName: '$business.name',
//                   ownerName: { $concat: ['$user.profile.firstName', ' ', '$user.profile.lastName'] },
//                   rating: '$performance.rating.average',
//                   completedRentals: '$performance.metrics.completedRentals',
//                   revenue: '$performance.metrics.totalRevenue'
//                 }
//               }
//             ],
//             dailyRegistrations: [
//               {
//                 $match: matchStage
//               },
//               {
//                 $group: {
//                   _id: {
//                     year: { $year: '$createdAt' },
//                     month: { $month: '$createdAt' },
//                     day: { $dayOfMonth: '$createdAt' }
//                   },
//                   count: { $sum: 1 }
//                 }
//               },
//               { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
//             ]
//           }
//         }
//       ]);

//       return analytics[0] || {};
//     } catch (error) {
//       logger.error('Error in getVendorAnalytics:', error);
//       throw error;
//     }
//   }

//   /**
//    * Get product analytics
//    */
//   async getProductAnalytics(dateRange = null) {
//     try {
//       const matchStage = dateRange ? {
//         createdAt: { $gte: dateRange.start, $lte: dateRange.end }
//       } : {};

//       const analytics = await Product.aggregate([
//         {
//           $facet: {
//             overview: [
//               {
//                 $group: {
//                   _id: null,
//                   totalProducts: { $sum: 1 },
//                   activeProducts: {
//                     $sum: { $cond: [{ $eq: ['$status.isActive', true] }, 1, 0] }
//                   },
//                   avgPrice: { $avg: '$pricing.monthlyRent' },
//                   avgRating: { $avg: '$ratings.average' },
//                   totalInventory: { $sum: '$inventory.totalQuantity' },
//                   availableInventory: { $sum: '$inventory.availableQuantity' }
//                 }
//               }
//             ],
//             byCategory: [
//               {
//                 $lookup: {
//                   from: 'categories',
//                   localField: 'category',
//                   foreignField: '_id',
//                   as: 'category'
//                 }
//               },
//               { $unwind: '$category' },
//               {
//                 $group: {
//                   _id: '$category.name',
//                   count: { $sum: 1 },
//                   avgPrice: { $avg: '$pricing.monthlyRent' },
//                   totalRentals: { $sum: '$rentalCount' }
//                 }
//               },
//               { $sort: { count: -1 } }
//             ],
//             topRented: [
//               {
//                 $lookup: {
//                   from: 'rentals',
//                   localField: '_id',
//                   foreignField: 'product',
//                   as: 'rentals'
//                 }
//               },
//               {
//                 $project: {
//                   name: '$basicInfo.name',
//                   rentalCount: { $size: '$rentals' },
//                   revenue: {
//                     $sum: '$rentals.rentalDetails.totalAmount'
//                   },
//                   avgRating: '$ratings.average'
//                 }
//               },
//               { $sort: { rentalCount: -1 } },
//               { $limit: 10 }
//             ],
//             priceDistribution: [
//               {
//                 $bucket: {
//                   groupBy: '$pricing.monthlyRent',
//                   boundaries: [0, 1000, 2000, 3000, 5000, 10000, 20000],
//                   default: '20000+',
//                   output: {
//                     count: { $sum: 1 }
//                   }
//                 }
//               }
//             ],
//             conditionDistribution: [
//               {
//                 $group: {
//                   _id: '$condition',
//                   count: { $sum: 1 }
//                 }
//               }
//             ],
//             dailyAdditions: [
//               {
//                 $match: matchStage
//               },
//               {
//                 $group: {
//                   _id: {
//                     year: { $year: '$createdAt' },
//                     month: { $month: '$createdAt' },
//                     day: { $dayOfMonth: '$createdAt' }
//                   },
//                   count: { $sum: 1 }
//                 }
//               },
//               { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
//             ]
//           }
//         }
//       ]);

//       return analytics[0] || {};
//     } catch (error) {
//       logger.error('Error in getProductAnalytics:', error);
//       throw error;
//     }
//   }

//   /**
//    * Get rental analytics
//    */
//   async getRentalAnalytics(dateRange = null) {
//     try {
//       const matchStage = dateRange ? {
//         createdAt: { $gte: dateRange.start, $lte: dateRange.end }
//       } : {};

//       const analytics = await Rental.aggregate([
//         {
//           $facet: {
//             overview: [
//               {
//                 $match: matchStage
//               },
//               {
//                 $group: {
//                   _id: null,
//                   totalRentals: { $sum: 1 },
//                   activeRentals: {
//                     $sum: { $cond: [{ $in: ['$status', ['active', 'confirmed']] }, 1, 0] }
//                   },
//                   completedRentals: {
//                     $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
//                   },
//                   cancelledRentals: {
//                     $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
//                   },
//                   overdueRentals: {
//                     $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0] }
//                   },
//                   avgTenure: { $avg: '$rentalDetails.tenureMonths' },
//                   totalRevenue: { $sum: '$rentalDetails.totalAmount' },
//                   avgRentalValue: { $avg: '$rentalDetails.totalAmount' }
//                 }
//               }
//             ],
//             byStatus: [
//               {
//                 $match: matchStage
//               },
//               {
//                 $group: {
//                   _id: '$status',
//                   count: { $sum: 1 },
//                   revenue: { $sum: '$rentalDetails.totalAmount' }
//                 }
//               }
//             ],
//             byMonth: [
//               {
//                 $match: matchStage
//               },
//               {
//                 $group: {
//                   _id: {
//                     year: { $year: '$createdAt' },
//                     month: { $month: '$createdAt' }
//                   },
//                   count: { $sum: 1 },
//                   revenue: { $sum: '$rentalDetails.totalAmount' }
//                 }
//               },
//               { $sort: { '_id.year': 1, '_id.month': 1 } }
//             ],
//             byTenure: [
//               {
//                 $group: {
//                   _id: '$rentalDetails.tenureMonths',
//                   count: { $sum: 1 },
//                   avgValue: { $avg: '$rentalDetails.totalAmount' }
//                 }
//               },
//               { $sort: { _id: 1 } }
//             ],
//             conversionRate: await this.getRentalConversionRate(dateRange),
//             peakDays: [
//               {
//                 $match: matchStage
//               },
//               {
//                 $group: {
//                   _id: { $dayOfWeek: '$createdAt' },
//                   count: { $sum: 1 }
//                 }
//               },
//               { $sort: { count: -1 } }
//             ]
//           }
//         }
//       ]);

//       return analytics[0] || {};
//     } catch (error) {
//       logger.error('Error in getRentalAnalytics:', error);
//       throw error;
//     }
//   }

//   /**
//    * Get rental conversion rate
//    */
//   async getRentalConversionRate(dateRange) {
//     try {
//       const pipeline = [
//         {
//           $facet: {
//             views: [
//               { $match: { 'views.lastViewed': { $gte: dateRange.start, $lte: dateRange.end } } },
//               { $group: { _id: null, count: { $sum: '$views.count' } } }
//             ],
//             carts: [
//               { $match: { 'cart.addedAt': { $gte: dateRange.start, $lte: dateRange.end } } },
//               { $group: { _id: null, count: { $sum: 1 } } }
//             ],
//             rentals: [
//               { $match: { createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
//               { $group: { _id: null, count: { $sum: 1 } } }
//             ]
//           }
//         }
//       ];

//       // This would need cart tracking collection
//       return {
//         viewToCart: 0,
//         cartToRental: 0,
//         overall: 0
//       };
//     } catch (error) {
//       logger.error('Error in getRentalConversionRate:', error);
//       return {
//         viewToCart: 0,
//         cartToRental: 0,
//         overall: 0
//       };
//     }
//   }

//   /**
//    * Get revenue analytics
//    */
//   async getRevenueAnalytics(dateRange = null) {
//     try {
//       const matchStage = dateRange ? {
//         createdAt: { $gte: dateRange.start, $lte: dateRange.end },
//         status: 'success'
//       } : { status: 'success' };

//       const analytics = await Payment.aggregate([
//         {
//           $facet: {
//             overview: [
//               {
//                 $match: matchStage
//               },
//               {
//                 $group: {
//                   _id: null,
//                   totalRevenue: { $sum: '$amount' },
//                   totalTransactions: { $sum: 1 },
//                   avgTransaction: { $avg: '$amount' },
//                   minTransaction: { $min: '$amount' },
//                   maxTransaction: { $max: '$amount' }
//                 }
//               }
//             ],
//             byType: [
//               {
//                 $match: matchStage
//               },
//               {
//                 $group: {
//                   _id: '$type',
//                   amount: { $sum: '$amount' },
//                   count: { $sum: 1 }
//                 }
//               }
//             ],
//             byMethod: [
//               {
//                 $match: matchStage
//               },
//               {
//                 $group: {
//                   _id: '$method',
//                   amount: { $sum: '$amount' },
//                   count: { $sum: 1 }
//                 }
//               }
//             ],
//             daily: [
//               {
//                 $match: matchStage
//               },
//               {
//                 $group: {
//                   _id: {
//                     year: { $year: '$createdAt' },
//                     month: { $month: '$createdAt' },
//                     day: { $dayOfMonth: '$createdAt' }
//                   },
//                   revenue: { $sum: '$amount' },
//                   transactions: { $sum: 1 }
//                 }
//               },
//               { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
//             ],
//             monthly: [
//               {
//                 $match: matchStage
//               },
//               {
//                 $group: {
//                   _id: {
//                     year: { $year: '$createdAt' },
//                     month: { $month: '$createdAt' }
//                   },
//                   revenue: { $sum: '$amount' }
//                 }
//               },
//               { $sort: { '_id.year': 1, '_id.month': 1 } }
//             ],
//             byHour: [
//               {
//                 $match: matchStage
//               },
//               {
//                 $group: {
//                   _id: { $hour: '$createdAt' },
//                   amount: { $sum: '$amount' },
//                   count: { $sum: 1 }
//                 }
//               },
//               { $sort: { _id: 1 } }
//             ]
//           }
//         }
//       ]);

//       // Calculate growth rates
//       const currentPeriod = analytics[0]?.overview[0] || { totalRevenue: 0 };
//       const previousPeriod = await this.getPreviousPeriodRevenue(dateRange);

//       analytics[0].growth = {
//         revenue: previousPeriod.totalRevenue ? 
//           ((currentPeriod.totalRevenue - previousPeriod.totalRevenue) / previousPeriod.totalRevenue) * 100 : 0,
//         transactions: previousPeriod.totalTransactions ?
//           ((currentPeriod.totalTransactions - previousPeriod.totalTransactions) / previousPeriod.totalTransactions) * 100 : 0
//       };

//       return analytics[0] || {};
//     } catch (error) {
//       logger.error('Error in getRevenueAnalytics:', error);
//       throw error;
//     }
//   }

//   /**
//    * Get previous period revenue for comparison
//    */
//   async getPreviousPeriodRevenue(dateRange) {
//     if (!dateRange) return { totalRevenue: 0, totalTransactions: 0 };

//     const periodLength = dateRange.end - dateRange.start;
//     const previousStart = new Date(dateRange.start - periodLength);
//     const previousEnd = new Date(dateRange.start);

//     const result = await Payment.aggregate([
//       {
//         $match: {
//           createdAt: { $gte: previousStart, $lte: previousEnd },
//           status: 'success'
//         }
//       },
//       {
//         $group: {
//           _id: null,
//           totalRevenue: { $sum: '$amount' },
//           totalTransactions: { $sum: 1 }
//         }
//       }
//     ]);

//     return result[0] || { totalRevenue: 0, totalTransactions: 0 };
//   }

//   /**
//    * Get growth metrics
//    */
//   async getGrowthMetrics(dateRange) {
//     try {
//       const current = await this.getPeriodMetrics(dateRange);
//       const previous = await this.getPeriodMetrics(this.getPreviousPeriod(dateRange));

//       const metrics = {
//         users: {
//           current: current.users,
//           previous: previous.users,
//           growth: previous.users ? ((current.users - previous.users) / previous.users) * 100 : 0
//         },
//         vendors: {
//           current: current.vendors,
//           previous: previous.vendors,
//           growth: previous.vendors ? ((current.vendors - previous.vendors) / previous.vendors) * 100 : 0
//         },
//         rentals: {
//           current: current.rentals,
//           previous: previous.rentals,
//           growth: previous.rentals ? ((current.rentals - previous.rentals) / previous.rentals) * 100 : 0
//         },
//         revenue: {
//           current: current.revenue,
//           previous: previous.revenue,
//           growth: previous.revenue ? ((current.revenue - previous.revenue) / previous.revenue) * 100 : 0
//         }
//       };

//       // Calculate CAGR if period is long enough
//       if (dateRange) {
//         const years = (dateRange.end - dateRange.start) / (1000 * 60 * 60 * 24 * 365);
//         if (years >= 1) {
//           metrics.cagr = {
//             revenue: (Math.pow(current.revenue / previous.revenue, 1 / years) - 1) * 100
//           };
//         }
//       }

//       return metrics;
//     } catch (error) {
//       logger.error('Error in getGrowthMetrics:', error);
//       return {};
//     }
//   }

//   /**
//    * Get metrics for a specific period
//    */
//   async getPeriodMetrics(dateRange) {
//     const [users, vendors, rentals, revenue] = await Promise.all([
//       User.countDocuments({ createdAt: { $gte: dateRange.start, $lte: dateRange.end } }),
//       Vendor.countDocuments({ createdAt: { $gte: dateRange.start, $lte: dateRange.end } }),
//       Rental.countDocuments({ createdAt: { $gte: dateRange.start, $lte: dateRange.end } }),
//       Payment.aggregate([
//         {
//           $match: {
//             createdAt: { $gte: dateRange.start, $lte: dateRange.end },
//             status: 'success'
//           }
//         },
//         { $group: { _id: null, total: { $sum: '$amount' } } }
//       ])
//     ]);

//     return {
//       users,
//       vendors,
//       rentals,
//       revenue: revenue[0]?.total || 0
//     };
//   }

//   /**
//    * Get inventory analytics
//    */
//   async getInventoryAnalytics(vendorId = null) {
//     try {
//       const matchStage = vendorId ? { 'product.vendor': vendorId } : {};

//       const analytics = await Inventory.aggregate([
//         {
//           $lookup: {
//             from: 'products',
//             localField: 'product',
//             foreignField: '_id',
//             as: 'product'
//           }
//         },
//         { $unwind: '$product' },
//         { $match: matchStage },
//         {
//           $facet: {
//             overview: [
//               {
//                 $group: {
//                   _id: null,
//                   totalItems: { $sum: 1 },
//                   totalValue: { $sum: '$purchaseInfo.price' },
//                   available: {
//                     $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] }
//                   },
//                   rented: {
//                     $sum: { $cond: [{ $eq: ['$status', 'rented'] }, 1, 0] }
//                   },
//                   maintenance: {
//                     $sum: { $cond: [{ $eq: ['$status', 'maintenance'] }, 1, 0] }
//                   }
//                 }
//               }
//             ],
//             byStatus: [
//               {
//                 $group: {
//                   _id: '$status',
//                   count: { $sum: 1 },
//                   value: { $sum: '$purchaseInfo.price' }
//                 }
//               }
//             ],
//             byCondition: [
//               {
//                 $group: {
//                   _id: '$condition.status',
//                   count: { $sum: 1 }
//                 }
//               }
//             ],
//             utilizationRate: await this.getInventoryUtilization(),
//             turnoverRate: await this.getInventoryTurnover(vendorId),
//             aging: [
//               {
//                 $project: {
//                   age: {
//                     $floor: {
//                       $divide: [
//                         { $subtract: [new Date(), '$purchaseInfo.date'] },
//                         1000 * 60 * 60 * 24 * 30
//                       ]
//                     }
//                   },
//                   value: '$purchaseInfo.price'
//                 }
//               },
//               {
//                 $bucket: {
//                   groupBy: '$age',
//                   boundaries: [0, 3, 6, 12, 24, 36],
//                   default: '36+',
//                   output: {
//                     count: { $sum: 1 },
//                     value: { $sum: '$value' }
//                   }
//                 }
//               }
//             ]
//           }
//         }
//       ]);

//       return analytics[0] || {};
//     } catch (error) {
//       logger.error('Error in getInventoryAnalytics:', error);
//       throw error;
//     }
//   }

//   /**
//    * Get inventory utilization rate
//    */
//   async getInventoryUtilization() {
//     try {
//       const result = await Inventory.aggregate([
//         {
//           $group: {
//             _id: null,
//             total: { $sum: 1 },
//             rented: {
//               $sum: { $cond: [{ $eq: ['$status', 'rented'] }, 1, 0] }
//             }
//           }
//         },
//         {
//           $project: {
//             utilizationRate: { $multiply: [{ $divide: ['$rented', '$total'] }, 100] }
//           }
//         }
//       ]);

//       return result[0]?.utilizationRate || 0;
//     } catch (error) {
//       logger.error('Error in getInventoryUtilization:', error);
//       return 0;
//     }
//   }

//   /**
//    * Get inventory turnover rate
//    */
//   async getInventoryTurnover(vendorId = null) {
//     try {
//       const matchStage = vendorId ? { vendor: vendorId } : {};

//       const result = await Rental.aggregate([
//         { $match: matchStage },
//         {
//           $group: {
//             _id: '$product',
//             count: { $sum: 1 }
//           }
//         },
//         {
//           $group: {
//             _id: null,
//             avgTurnover: { $avg: '$count' }
//           }
//         }
//       ]);

//       return result[0]?.avgTurnover || 0;
//     } catch (error) {
//       logger.error('Error in getInventoryTurnover:', error);
//       return 0;
//     }
//   }

//   /**
//    * Get customer analytics
//    */
//   async getCustomerAnalytics() {
//     try {
//       const analytics = await User.aggregate([
//         {
//           $lookup: {
//             from: 'rentals',
//             localField: '_id',
//             foreignField: 'user',
//             as: 'rentals'
//           }
//         },
//         {
//           $lookup: {
//             from: 'reviews',
//             localField: '_id',
//             foreignField: 'user',
//             as: 'reviews'
//           }
//         },
//         {
//           $facet: {
//             segments: [
//               {
//                 $project: {
//                   totalSpent: { $sum: '$rentals.rentalDetails.totalAmount' },
//                   rentalCount: { $size: '$rentals' },
//                   reviewCount: { $size: '$reviews' },
//                   lastActive: '$stats.lastActive'
//                 }
//               },
//               {
//                 $bucket: {
//                   groupBy: '$totalSpent',
//                   boundaries: [0, 5000, 10000, 25000, 50000, 100000],
//                   default: '100000+',
//                   output: {
//                     count: { $sum: 1 },
//                     avgRentals: { $avg: '$rentalCount' }
//                   }
//                 }
//               }
//             ],
//             repeatRate: [
//               {
//                 $project: {
//                   isRepeat: { $gt: [{ $size: '$rentals' }, 1] }
//                 }
//               },
//               {
//                 $group: {
//                   _id: null,
//                   total: { $sum: 1 },
//                   repeat: { $sum: { $cond: ['$isRepeat', 1, 0] } }
//                 }
//               },
//               {
//                 $project: {
//                   rate: { $multiply: [{ $divide: ['$repeat', '$total'] }, 100] }
//                 }
//               }
//             ],
//             averageLTV: [
//               {
//                 $group: {
//                   _id: null,
//                   avgLTV: { $avg: { $sum: '$rentals.rentalDetails.totalAmount' } }
//                 }
//               }
//             ],
//             churnRate: await this.getChurnRate()
//           }
//         }
//       ]);

//       return analytics[0] || {};
//     } catch (error) {
//       logger.error('Error in getCustomerAnalytics:', error);
//       throw error;
//     }
//   }

//   /**
//    * Get churn rate
//    */
//   async getChurnRate() {
//     try {
//       const threeMonthsAgo = moment().subtract(3, 'months').toDate();
//       const sixMonthsAgo = moment().subtract(6, 'months').toDate();

//       const [previousCustomers, currentCustomers] = await Promise.all([
//         User.countDocuments({
//           createdAt: { $lte: threeMonthsAgo },
//           'stats.lastActive': { $lt: threeMonthsAgo }
//         }),
//         User.countDocuments({
//           createdAt: { $lte: threeMonthsAgo },
//           'stats.lastActive': { $gte: threeMonthsAgo }
//         })
//       ]);

//       const total = previousCustomers + currentCustomers;
//       const churnRate = total ? (previousCustomers / total) * 100 : 0;

//       return {
//         churned: previousCustomers,
//         active: currentCustomers,
//         rate: churnRate,
//         period: '3months'
//       };
//     } catch (error) {
//       logger.error('Error in getChurnRate:', error);
//       return { churned: 0, active: 0, rate: 0 };
//     }
//   }

//   /**
//    * Get performance metrics
//    */
//   async getPerformanceMetrics() {
//     try {
//       const [
//         avgResponseTime,
//         fulfillmentRate,
//         satisfactionScore,
//         slaCompliance
//       ] = await Promise.all([
//         this.getAverageResponseTime(),
//         this.getFulfillmentRate(),
//         this.getSatisfactionScore(),
//         this.getSLACompliance()
//       ]);

//       return {
//         averageResponseTime: avgResponseTime,
//         fulfillmentRate,
//         customerSatisfaction: satisfactionScore,
//         slaCompliance,
//         timestamp: new Date()
//       };
//     } catch (error) {
//       logger.error('Error in getPerformanceMetrics:', error);
//       throw error;
//     }
//   }

//   /**
//    * Get average response time
//    */
//   async getAverageResponseTime() {
//     try {
//       // This would need a support ticket system
//       return {
//         firstResponse: 120, // minutes
//         resolution: 480, // minutes
//         byPriority: {
//           high: 60,
//           medium: 180,
//           low: 360
//         }
//       };
//     } catch (error) {
//       logger.error('Error in getAverageResponseTime:', error);
//       return null;
//     }
//   }

//   /**
//    * Get fulfillment rate
//    */
//   async getFulfillmentRate() {
//     try {
//       const result = await Rental.aggregate([
//         {
//           $group: {
//             _id: null,
//             total: { $sum: 1 },
//             completed: {
//               $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
//             },
//             cancelled: {
//               $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
//             }
//           }
//         },
//         {
//           $project: {
//             rate: { $multiply: [{ $divide: ['$completed', '$total'] }, 100] }
//           }
//         }
//       ]);

//       return result[0]?.rate || 0;
//     } catch (error) {
//       logger.error('Error in getFulfillmentRate:', error);
//       return 0;
//     }
//   }

//   /**
//    * Get satisfaction score
//    */
//   async getSatisfactionScore() {
//     try {
//       const result = await Review.aggregate([
//         {
//           $group: {
//             _id: null,
//             avgRating: { $avg: '$ratings.overall' },
//             totalReviews: { $sum: 1 },
//             distribution: {
//               $push: '$ratings.overall'
//             }
//           }
//         }
//       ]);

//       if (result[0]) {
//         const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
//         result[0].distribution.forEach(r => distribution[r]++);

//         return {
//           score: result[0].avgRating,
//           totalReviews: result[0].totalReviews,
//           distribution
//         };
//       }

//       return { score: 0, totalReviews: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
//     } catch (error) {
//       logger.error('Error in getSatisfactionScore:', error);
//       return null;
//     }
//   }

//   /**
//    * Get SLA compliance
//    */
//   async getSLACompliance() {
//     try {
//       // This would need maintenance request tracking
//       return {
//         overall: 95,
//         byPriority: {
//           high: 98,
//           medium: 95,
//           low: 92
//         }
//       };
//     } catch (error) {
//       logger.error('Error in getSLACompliance:', error);
//       return null;
//     }
//   }

//   /**
//    * Get date range based on period
//    */
//   getDateRange(period) {
//     const end = new Date();
//     let start;

//     switch (period) {
//       case '24h':
//         start = moment().subtract(24, 'hours').toDate();
//         break;
//       case '7d':
//         start = moment().subtract(7, 'days').toDate();
//         break;
//       case '30d':
//         start = moment().subtract(30, 'days').toDate();
//         break;
//       case '90d':
//         start = moment().subtract(90, 'days').toDate();
//         break;
//       case '1y':
//         start = moment().subtract(1, 'year').toDate();
//         break;
//       case 'ytd':
//         start = moment().startOf('year').toDate();
//         break;
//       default:
//         start = moment().subtract(30, 'days').toDate();
//     }

//     return { start, end };
//   }

//   /**
//    * Get previous period for comparison
//    */
//   getPreviousPeriod(dateRange) {
//     const periodLength = dateRange.end - dateRange.start;
//     return {
//       start: new Date(dateRange.start - periodLength),
//       end: new Date(dateRange.start)
//     };
//   }

//   /**
//    * Invalidate analytics cache
//    */
//   async invalidateAnalyticsCache() {
//     try {
//       if (this.redisClient) {
//         const keys = await this.redisClient.keys('analytics:*');
//         if (keys.length > 0) {
//           await this.redisClient.del(keys);
//           logger.info(`Invalidated ${keys.length} analytics cache keys`);
//         }
//       }
//     } catch (error) {
//       logger.error('Error invalidating analytics cache:', error);
//     }
//   }
// }

// module.exports = new AnalyticsService();


const { User, Vendor, Product, Rental, Payment, Review, Inventory, Maintenance } = require('../models');
const { AppError } = require('../utils/AppError');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const moment = require('moment');

class AnalyticsService {
  constructor() {
    this.redisClient = getRedisClient();
    this.cacheTTL = 1800; // 30 minutes
  }

  /**
   * Get platform overview analytics
   */
  async getPlatformOverview(period = '30d') {
    try {
      const cacheKey = `analytics:platform:overview:${period}`;
      
      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const dateRange = this.getDateRange(period);
      
      const [
        userStats,
        vendorStats,
        productStats,
        rentalStats,
        revenueStats,
        growthMetrics
      ] = await Promise.all([
        this.getUserAnalytics(dateRange),
        this.getVendorAnalytics(dateRange),
        this.getProductAnalytics(dateRange),
        this.getRentalAnalytics(dateRange),
        this.getRevenueAnalytics(dateRange),
        this.getGrowthMetrics(dateRange)
      ]);

      const analytics = {
        period,
        dateRange,
        users: userStats,
        vendors: vendorStats,
        products: productStats,
        rentals: rentalStats,
        revenue: revenueStats,
        growth: growthMetrics,
        timestamp: new Date()
      };

      // Cache the result
      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, this.cacheTTL, JSON.stringify(analytics));
      }

      return analytics;
    } catch (error) {
      logger.error('Error in getPlatformOverview:', error);
      throw error;
    }
  }

  /**
   * Get user analytics
   */
  async getUserAnalytics(dateRange = null) {
    try {
      const matchStage = dateRange ? {
        createdAt: { $gte: dateRange.start, $lte: dateRange.end }
      } : {};

      const analytics = await User.aggregate([
        {
          $facet: {
            overview: [
              {
                $group: {
                  _id: null,
                  totalUsers: { $sum: 1 },
                  activeUsers: {
                    $sum: { $cond: [{ $eq: ['$status.isActive', true] }, 1, 0] }
                  },
                  verifiedUsers: {
                    $sum: { $cond: [{ $eq: ['$verification.email', true] }, 1, 0] }
                  },
                  kycApproved: {
                    $sum: { $cond: [{ $eq: ['$verification.kyc.status', 'approved'] }, 1, 0] }
                  }
                }
              }
            ],
            byRole: [
              {
                $group: {
                  _id: '$role',
                  count: { $sum: 1 }
                }
              }
            ],
            dailySignups: [
              {
                $match: matchStage
              },
              {
                $group: {
                  _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' },
                    day: { $dayOfMonth: '$createdAt' }
                  },
                  count: { $sum: 1 }
                }
              },
              { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
            ],
            geography: [
              {
                $lookup: {
                  from: 'addresses',
                  localField: '_id',
                  foreignField: 'user',
                  as: 'addresses'
                }
              },
              { $unwind: { path: '$addresses', preserveNullAndEmptyArrays: true } },
              {
                $group: {
                  _id: '$addresses.city',
                  count: { $sum: 1 }
                }
              },
              { $sort: { count: -1 } },
              { $limit: 10 }
            ]
          }
        }
      ]);

      // Add retention separately to avoid MongoDB Atlas limitations
      const retention = await this.getUserRetention();
      
      return { ...analytics[0], retention };
    } catch (error) {
      logger.error('Error in getUserAnalytics:', error);
      throw error;
    }
  }

  /**
   * Get user retention metrics
   */
  async getUserRetention() {
    try {
      // Simplified retention query that works with MongoDB
      const users = await User.aggregate([
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' }
            },
            users: { $push: '$_id' },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
        { $limit: 12 }
      ]);

      const retention = [];

      for (const cohort of users) {
        const cohortUsers = cohort.users;
        const monthlyRetention = [];

        for (let i = 0; i < 6; i++) {
          const monthDate = moment()
            .year(cohort._id.year)
            .month(cohort._id.month - 1)
            .add(i, 'months')
            .toDate();

          const endDate = moment(monthDate).endOf('month').toDate();

          const activeInMonth = await Rental.countDocuments({
            user: { $in: cohortUsers },
            createdAt: { $lte: endDate }
          });

          monthlyRetention.push({
            month: i,
            activeUsers: activeInMonth,
            retentionRate: cohort.count ? (activeInMonth / cohort.count) * 100 : 0
          });
        }

        retention.push({
          cohort: `${cohort._id.year}-${cohort._id.month}`,
          totalUsers: cohort.count,
          monthlyRetention
        });
      }

      return retention;
    } catch (error) {
      logger.error('Error in getUserRetention:', error);
      return [];
    }
  }

  /**
   * Get vendor analytics
   */
  async getVendorAnalytics(dateRange = null) {
    try {
      const matchStage = dateRange ? {
        createdAt: { $gte: dateRange.start, $lte: dateRange.end }
      } : {};

      const analytics = await Vendor.aggregate([
        {
          $facet: {
            overview: [
              {
                $group: {
                  _id: null,
                  totalVendors: { $sum: 1 },
                  activeVendors: {
                    $sum: { $cond: [{ $eq: ['$status.isActive', true] }, 1, 0] }
                  },
                  verifiedVendors: {
                    $sum: { $cond: [{ $eq: ['$verification.status', 'verified'] }, 1, 0] }
                  },
                  pendingVendors: {
                    $sum: { $cond: [{ $eq: ['$verification.status', 'pending'] }, 1, 0] }
                  }
                }
              }
            ],
            byPlan: [
              {
                $group: {
                  _id: '$subscription.plan',
                  count: { $sum: 1 },
                  avgRating: { $avg: '$performance.rating.average' }
                }
              }
            ],
            topPerformers: [
              {
                $match: {
                  'performance.rating.average': { $gt: 0 }
                }
              },
              {
                $sort: { 'performance.rating.average': -1, 'performance.metrics.completedRentals': -1 }
              },
              { $limit: 10 },
              {
                $lookup: {
                  from: 'users',
                  localField: 'user',
                  foreignField: '_id',
                  as: 'user'
                }
              },
              { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
              {
                $project: {
                  businessName: '$business.name',
                  ownerName: { $concat: ['$user.profile.firstName', ' ', '$user.profile.lastName'] },
                  rating: '$performance.rating.average',
                  completedRentals: '$performance.metrics.completedRentals',
                  revenue: '$performance.metrics.totalRevenue'
                }
              }
            ],
            dailyRegistrations: [
              {
                $match: matchStage
              },
              {
                $group: {
                  _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' },
                    day: { $dayOfMonth: '$createdAt' }
                  },
                  count: { $sum: 1 }
                }
              },
              { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
            ]
          }
        }
      ]);

      return analytics[0] || {};
    } catch (error) {
      logger.error('Error in getVendorAnalytics:', error);
      throw error;
    }
  }

  /**
   * Get product analytics
   */
  async getProductAnalytics(dateRange = null) {
    try {
      const matchStage = dateRange ? {
        createdAt: { $gte: dateRange.start, $lte: dateRange.end }
      } : {};

      const analytics = await Product.aggregate([
        {
          $facet: {
            overview: [
              {
                $group: {
                  _id: null,
                  totalProducts: { $sum: 1 },
                  activeProducts: {
                    $sum: { $cond: [{ $eq: ['$status.isActive', true] }, 1, 0] }
                  },
                  avgPrice: { $avg: '$pricing.monthlyRent' },
                  avgRating: { $avg: '$ratings.average' },
                  totalInventory: { $sum: '$inventory.totalQuantity' },
                  availableInventory: { $sum: '$inventory.availableQuantity' }
                }
              }
            ],
            byCategory: [
              {
                $lookup: {
                  from: 'categories',
                  localField: 'category',
                  foreignField: '_id',
                  as: 'category'
                }
              },
              { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
              {
                $group: {
                  _id: '$category.name',
                  count: { $sum: 1 },
                  avgPrice: { $avg: '$pricing.monthlyRent' },
                  totalRentals: { $sum: '$rentalCount' }
                }
              },
              { $sort: { count: -1 } }
            ],
            topRented: [
              {
                $lookup: {
                  from: 'rentals',
                  localField: '_id',
                  foreignField: 'product',
                  as: 'rentals'
                }
              },
              {
                $project: {
                  name: '$basicInfo.name',
                  rentalCount: { $size: '$rentals' },
                  revenue: {
                    $sum: '$rentals.rentalDetails.totalAmount'
                  },
                  avgRating: '$ratings.average'
                }
              },
              { $sort: { rentalCount: -1 } },
              { $limit: 10 }
            ],
            priceDistribution: [
              {
                $bucket: {
                  groupBy: '$pricing.monthlyRent',
                  boundaries: [0, 1000, 2000, 3000, 5000, 10000, 20000],
                  default: '20000+',
                  output: {
                    count: { $sum: 1 }
                  }
                }
              }
            ],
            conditionDistribution: [
              {
                $group: {
                  _id: '$condition',
                  count: { $sum: 1 }
                }
              }
            ],
            dailyAdditions: [
              {
                $match: matchStage
              },
              {
                $group: {
                  _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' },
                    day: { $dayOfMonth: '$createdAt' }
                  },
                  count: { $sum: 1 }
                }
              },
              { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
            ]
          }
        }
      ]);

      return analytics[0] || {};
    } catch (error) {
      logger.error('Error in getProductAnalytics:', error);
      throw error;
    }
  }

  // /**
  //  * Get rental analytics
  //  */
  // async getRentalAnalytics(dateRange = null) {
  //   try {
  //     const matchStage = dateRange ? {
  //       createdAt: { $gte: dateRange.start, $lte: dateRange.end }
  //     } : {};

  //     // Get conversion rate separately to avoid aggregation issues
  //     const conversionRate = await this.getRentalConversionRate(dateRange);

  //     const analytics = await Rental.aggregate([
  //       {
  //         $facet: {
  //           overview: [
  //             {
  //               $match: matchStage
  //             },
  //             {
  //               $group: {
  //                 _id: null,
  //                 totalRentals: { $sum: 1 },
  //                 activeRentals: {
  //                   $sum: { $cond: [{ $in: ['$status', ['active', 'confirmed']] }, 1, 0] }
  //                 },
  //                 completedRentals: {
  //                   $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
  //                 },
  //                 cancelledRentals: {
  //                   $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
  //                 },
  //                 overdueRentals: {
  //                   $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0] }
  //                 },
  //                 avgTenure: { $avg: '$rentalDetails.tenureMonths' },
  //                 totalRevenue: { $sum: '$rentalDetails.totalAmount' },
  //                 avgRentalValue: { $avg: '$rentalDetails.totalAmount' }
  //               }
  //             }
  //           ],
  //           byStatus: [
  //             {
  //               $match: matchStage
  //             },
  //             {
  //               $group: {
  //                 _id: '$status',
  //                 count: { $sum: 1 },
  //                 revenue: { $sum: '$rentalDetails.totalAmount' }
  //               }
  //             }
  //           ],
  //           byMonth: [
  //             {
  //               $match: matchStage
  //             },
  //             {
  //               $group: {
  //                 _id: {
  //                   year: { $year: '$createdAt' },
  //                   month: { $month: '$createdAt' }
  //                 },
  //                 count: { $sum: 1 },
  //                 revenue: { $sum: '$rentalDetails.totalAmount' }
  //               }
  //             },
  //             { $sort: { '_id.year': 1, '_id.month': 1 } }
  //           ],
  //           byTenure: [
  //             {
  //               $group: {
  //                 _id: '$rentalDetails.tenureMonths',
  //                 count: { $sum: 1 },
  //                 avgValue: { $avg: '$rentalDetails.totalAmount' }
  //               }
  //             },
  //             { $sort: { _id: 1 } }
  //           ],
  //           peakDays: [
  //             {
  //               $match: matchStage
  //             },
  //             {
  //               $group: {
  //                 _id: { $dayOfWeek: '$createdAt' },
  //                 count: { $sum: 1 }
  //               }
  //             },
  //             { $sort: { count: -1 } }
  //           ]
  //         }
  //       }
  //     ]);

  //     return { ...analytics[0], conversionRate };
  //   } catch (error) {
  //     logger.error('Error in getRentalAnalytics:', error);
  //     throw error;
  //   }
  // }

  /**
   * Get rental conversion rate
   */
  // async getRentalConversionRate(dateRange) {
  //   try {
  //     // Return default values instead of complex aggregation that fails
  //     return {
  //       viewToCart: 0,
  //       cartToRental: 0,
  //       overall: 0
  //     };
  //   } catch (error) {
  //     logger.error('Error in getRentalConversionRate:', error);
  //     return {
  //       viewToCart: 0,
  //       cartToRental: 0,
  //       overall: 0
  //     };
  //   }
  // }


  /**
 * Get rental analytics
 */
async getRentalAnalytics(dateRange = null) {
  try {
    const matchStage = dateRange ? {
      createdAt: { $gte: dateRange.start, $lte: dateRange.end }
    } : {};

    // Get conversion rate separately - DO NOT include in aggregation
    const conversionRate = await this.getRentalConversionRate(dateRange);

    const analytics = await Rental.aggregate([
      {
        $facet: {
          overview: [
            {
              $match: matchStage
            },
            {
              $group: {
                _id: null,
                totalRentals: { $sum: 1 },
                activeRentals: {
                  $sum: { $cond: [{ $in: ['$status', ['active', 'confirmed']] }, 1, 0] }
                },
                completedRentals: {
                  $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                },
                cancelledRentals: {
                  $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
                },
                overdueRentals: {
                  $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0] }
                },
                avgTenure: { $avg: '$rentalDetails.tenureMonths' },
                totalRevenue: { $sum: '$rentalDetails.totalAmount' },
                avgRentalValue: { $avg: '$rentalDetails.totalAmount' }
              }
            }
          ],
          byStatus: [
            {
              $match: matchStage
            },
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
                revenue: { $sum: '$rentalDetails.totalAmount' }
              }
            }
          ],
          byMonth: [
            {
              $match: matchStage
            },
            {
              $group: {
                _id: {
                  year: { $year: '$createdAt' },
                  month: { $month: '$createdAt' }
                },
                count: { $sum: 1 },
                revenue: { $sum: '$rentalDetails.totalAmount' }
              }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
          ],
          byTenure: [
            {
              $group: {
                _id: '$rentalDetails.tenureMonths',
                count: { $sum: 1 },
                avgValue: { $avg: '$rentalDetails.totalAmount' }
              }
            },
            { $sort: { _id: 1 } }
          ],
          peakDays: [
            {
              $match: matchStage
            },
            {
              $group: {
                _id: { $dayOfWeek: '$createdAt' },
                count: { $sum: 1 }
              }
            },
            { $sort: { count: -1 } }
          ]
        }
      }
    ]);

    // Return the analytics result with conversionRate added as a property
    const result = analytics[0] || {};
    result.conversionRate = conversionRate;
    
    return result;
  } catch (error) {
    logger.error('Error in getRentalAnalytics:', error);
    throw error;
  }
}

/**
 * Get rental conversion rate - Simplified version that doesn't cause aggregation errors
 */
async getRentalConversionRate(dateRange) {
  try {
    // If dateRange is not provided, use default 30 days
    if (!dateRange) {
      dateRange = this.getDateRange('30d');
    }

    // Get total rentals in period
    const totalRentals = await Rental.countDocuments({
      createdAt: { $gte: dateRange.start, $lte: dateRange.end }
    });

    // For now, return mock data since we don't have cart tracking
    // You can enhance this when you implement cart tracking
    return {
      viewToCart: 0,
      cartToRental: totalRentals > 0 ? 100 : 0,
      overall: totalRentals > 0 ? 100 : 0,
      totalRentals: totalRentals,
      period: dateRange
    };
  } catch (error) {
    logger.error('Error in getRentalConversionRate:', error);
    return {
      viewToCart: 0,
      cartToRental: 0,
      overall: 0
    };
  }
}

  /**
   * Get revenue analytics
   */
  async getRevenueAnalytics(dateRange = null) {
    try {
      const matchStage = dateRange ? {
        createdAt: { $gte: dateRange.start, $lte: dateRange.end },
        status: 'success'
      } : { status: 'success' };

      const analytics = await Payment.aggregate([
        {
          $facet: {
            overview: [
              {
                $match: matchStage
              },
              {
                $group: {
                  _id: null,
                  totalRevenue: { $sum: '$amount' },
                  totalTransactions: { $sum: 1 },
                  avgTransaction: { $avg: '$amount' },
                  minTransaction: { $min: '$amount' },
                  maxTransaction: { $max: '$amount' }
                }
              }
            ],
            byType: [
              {
                $match: matchStage
              },
              {
                $group: {
                  _id: '$type',
                  amount: { $sum: '$amount' },
                  count: { $sum: 1 }
                }
              }
            ],
            byMethod: [
              {
                $match: matchStage
              },
              {
                $group: {
                  _id: '$method',
                  amount: { $sum: '$amount' },
                  count: { $sum: 1 }
                }
              }
            ],
            daily: [
              {
                $match: matchStage
              },
              {
                $group: {
                  _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' },
                    day: { $dayOfMonth: '$createdAt' }
                  },
                  revenue: { $sum: '$amount' },
                  transactions: { $sum: 1 }
                }
              },
              { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
            ],
            monthly: [
              {
                $match: matchStage
              },
              {
                $group: {
                  _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' }
                  },
                  revenue: { $sum: '$amount' }
                }
              },
              { $sort: { '_id.year': 1, '_id.month': 1 } }
            ],
            byHour: [
              {
                $match: matchStage
              },
              {
                $group: {
                  _id: { $hour: '$createdAt' },
                  amount: { $sum: '$amount' },
                  count: { $sum: 1 }
                }
              },
              { $sort: { _id: 1 } }
            ]
          }
        }
      ]);

      // Calculate growth rates
      const currentPeriod = analytics[0]?.overview[0] || { totalRevenue: 0, totalTransactions: 0 };
      const previousPeriod = await this.getPreviousPeriodRevenue(dateRange);

      const result = analytics[0] || {};
      result.growth = {
        revenue: previousPeriod.totalRevenue ? 
          ((currentPeriod.totalRevenue - previousPeriod.totalRevenue) / previousPeriod.totalRevenue) * 100 : 0,
        transactions: previousPeriod.totalTransactions ?
          ((currentPeriod.totalTransactions - previousPeriod.totalTransactions) / previousPeriod.totalTransactions) * 100 : 0
      };

      return result;
    } catch (error) {
      logger.error('Error in getRevenueAnalytics:', error);
      throw error;
    }
  }

  /**
   * Get previous period revenue for comparison
   */
  async getPreviousPeriodRevenue(dateRange) {
    if (!dateRange) return { totalRevenue: 0, totalTransactions: 0 };

    const periodLength = dateRange.end - dateRange.start;
    const previousStart = new Date(dateRange.start.getTime() - periodLength);
    const previousEnd = new Date(dateRange.start);

    const result = await Payment.aggregate([
      {
        $match: {
          createdAt: { $gte: previousStart, $lte: previousEnd },
          status: 'success'
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
          totalTransactions: { $sum: 1 }
        }
      }
    ]);

    return result[0] || { totalRevenue: 0, totalTransactions: 0 };
  }

  /**
   * Get growth metrics
   */
  async getGrowthMetrics(dateRange) {
    try {
      const current = await this.getPeriodMetrics(dateRange);
      const previous = await this.getPeriodMetrics(this.getPreviousPeriod(dateRange));

      const metrics = {
        users: {
          current: current.users,
          previous: previous.users,
          growth: previous.users ? ((current.users - previous.users) / previous.users) * 100 : 0
        },
        vendors: {
          current: current.vendors,
          previous: previous.vendors,
          growth: previous.vendors ? ((current.vendors - previous.vendors) / previous.vendors) * 100 : 0
        },
        rentals: {
          current: current.rentals,
          previous: previous.rentals,
          growth: previous.rentals ? ((current.rentals - previous.rentals) / previous.rentals) * 100 : 0
        },
        revenue: {
          current: current.revenue,
          previous: previous.revenue,
          growth: previous.revenue ? ((current.revenue - previous.revenue) / previous.revenue) * 100 : 0
        }
      };

      // Calculate CAGR if period is long enough
      if (dateRange && previous.revenue > 0) {
        const days = (dateRange.end - dateRange.start) / (1000 * 60 * 60 * 24);
        const years = days / 365;
        if (years >= 1) {
          metrics.cagr = {
            revenue: (Math.pow(current.revenue / previous.revenue, 1 / years) - 1) * 100
          };
        }
      }

      return metrics;
    } catch (error) {
      logger.error('Error in getGrowthMetrics:', error);
      return {};
    }
  }

  /**
   * Get metrics for a specific period
   */
  async getPeriodMetrics(dateRange) {
    const [users, vendors, rentals, revenue] = await Promise.all([
      User.countDocuments({ createdAt: { $gte: dateRange.start, $lte: dateRange.end } }),
      Vendor.countDocuments({ createdAt: { $gte: dateRange.start, $lte: dateRange.end } }),
      Rental.countDocuments({ createdAt: { $gte: dateRange.start, $lte: dateRange.end } }),
      Payment.aggregate([
        {
          $match: {
            createdAt: { $gte: dateRange.start, $lte: dateRange.end },
            status: 'success'
          }
        },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    return {
      users,
      vendors,
      rentals,
      revenue: revenue[0]?.total || 0
    };
  }

  /**
   * Get inventory analytics
   */
  async getInventoryAnalytics(vendorId = null) {
    try {
      const matchStage = vendorId ? { 'product.vendor': new mongoose.Types.ObjectId(vendorId) } : {};

      const analytics = await Inventory.aggregate([
        {
          $lookup: {
            from: 'products',
            localField: 'product',
            foreignField: '_id',
            as: 'product'
          }
        },
        { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
        { $match: matchStage },
        {
          $facet: {
            overview: [
              {
                $group: {
                  _id: null,
                  totalItems: { $sum: 1 },
                  totalValue: { $sum: '$purchaseInfo.price' },
                  available: {
                    $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] }
                  },
                  rented: {
                    $sum: { $cond: [{ $eq: ['$status', 'rented'] }, 1, 0] }
                  },
                  maintenance: {
                    $sum: { $cond: [{ $eq: ['$status', 'maintenance'] }, 1, 0] }
                  }
                }
              }
            ],
            byStatus: [
              {
                $group: {
                  _id: '$status',
                  count: { $sum: 1 },
                  value: { $sum: '$purchaseInfo.price' }
                }
              }
            ],
            byCondition: [
              {
                $group: {
                  _id: '$condition.status',
                  count: { $sum: 1 }
                }
              }
            ],
            aging: [
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
                  boundaries: [0, 3, 6, 12, 24, 36],
                  default: '36+',
                  output: {
                    count: { $sum: 1 },
                    value: { $sum: '$value' }
                  }
                }
              }
            ]
          }
        }
      ]);

      // Get utilization and turnover separately
      const utilizationRate = await this.getInventoryUtilization();
      const turnoverRate = await this.getInventoryTurnover(vendorId);

      return { ...analytics[0], utilizationRate, turnoverRate };
    } catch (error) {
      logger.error('Error in getInventoryAnalytics:', error);
      throw error;
    }
  }

  /**
   * Get inventory utilization rate
   */
  async getInventoryUtilization() {
    try {
      const result = await Inventory.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            rented: {
              $sum: { $cond: [{ $eq: ['$status', 'rented'] }, 1, 0] }
            }
          }
        },
        {
          $project: {
            utilizationRate: { $multiply: [{ $divide: ['$rented', { $max: ['$total', 1] }] }, 100] }
          }
        }
      ]);

      return result[0]?.utilizationRate || 0;
    } catch (error) {
      logger.error('Error in getInventoryUtilization:', error);
      return 0;
    }
  }

  /**
   * Get inventory turnover rate
   */
  async getInventoryTurnover(vendorId = null) {
    try {
      const matchStage = vendorId ? { vendor: new mongoose.Types.ObjectId(vendorId) } : {};

      const result = await Rental.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$product',
            count: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: null,
            avgTurnover: { $avg: '$count' }
          }
        }
      ]);

      return result[0]?.avgTurnover || 0;
    } catch (error) {
      logger.error('Error in getInventoryTurnover:', error);
      return 0;
    }
  }

  /**
   * Get customer analytics
   */
  async getCustomerAnalytics() {
    try {
      const analytics = await User.aggregate([
        {
          $lookup: {
            from: 'rentals',
            localField: '_id',
            foreignField: 'user',
            as: 'rentals'
          }
        },
        {
          $lookup: {
            from: 'reviews',
            localField: '_id',
            foreignField: 'user',
            as: 'reviews'
          }
        },
        {
          $facet: {
            segments: [
              {
                $project: {
                  totalSpent: { $sum: '$rentals.rentalDetails.totalAmount' },
                  rentalCount: { $size: '$rentals' },
                  reviewCount: { $size: '$reviews' },
                  lastActive: '$stats.lastActive'
                }
              },
              {
                $bucket: {
                  groupBy: '$totalSpent',
                  boundaries: [0, 5000, 10000, 25000, 50000, 100000],
                  default: '100000+',
                  output: {
                    count: { $sum: 1 },
                    avgRentals: { $avg: '$rentalCount' }
                  }
                }
              }
            ],
            averageLTV: [
              {
                $group: {
                  _id: null,
                  avgLTV: { $avg: { $sum: '$rentals.rentalDetails.totalAmount' } }
                }
              }
            ]
          }
        }
      ]);

      // Get repeat rate and churn rate separately
      const repeatRate = await this.getRepeatRate();
      const churnRate = await this.getChurnRate();

      return { ...analytics[0], repeatRate, churnRate };
    } catch (error) {
      logger.error('Error in getCustomerAnalytics:', error);
      throw error;
    }
  }

  /**
   * Get repeat rate
   */
  async getRepeatRate() {
    try {
      const result = await User.aggregate([
        {
          $lookup: {
            from: 'rentals',
            localField: '_id',
            foreignField: 'user',
            as: 'rentals'
          }
        },
        {
          $project: {
            isRepeat: { $gt: [{ $size: '$rentals' }, 1] }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            repeat: { $sum: { $cond: ['$isRepeat', 1, 0] } }
          }
        },
        {
          $project: {
            rate: { $multiply: [{ $divide: ['$repeat', { $max: ['$total', 1] }] }, 100] }
          }
        }
      ]);

      return result[0]?.rate || 0;
    } catch (error) {
      logger.error('Error in getRepeatRate:', error);
      return 0;
    }
  }

  /**
   * Get churn rate
   */
  async getChurnRate() {
    try {
      const threeMonthsAgo = moment().subtract(3, 'months').toDate();
      const sixMonthsAgo = moment().subtract(6, 'months').toDate();

      const [previousCustomers, currentCustomers] = await Promise.all([
        User.countDocuments({
          createdAt: { $lte: threeMonthsAgo },
          'stats.lastActive': { $lt: threeMonthsAgo }
        }),
        User.countDocuments({
          createdAt: { $lte: threeMonthsAgo },
          'stats.lastActive': { $gte: threeMonthsAgo }
        })
      ]);

      const total = previousCustomers + currentCustomers;
      const churnRate = total ? (previousCustomers / total) * 100 : 0;

      return {
        churned: previousCustomers,
        active: currentCustomers,
        rate: churnRate,
        period: '3months'
      };
    } catch (error) {
      logger.error('Error in getChurnRate:', error);
      return { churned: 0, active: 0, rate: 0 };
    }
  }

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics() {
    try {
      const [
        avgResponseTime,
        fulfillmentRate,
        satisfactionScore,
        slaCompliance
      ] = await Promise.all([
        this.getAverageResponseTime(),
        this.getFulfillmentRate(),
        this.getSatisfactionScore(),
        this.getSLACompliance()
      ]);

      return {
        averageResponseTime: avgResponseTime,
        fulfillmentRate,
        customerSatisfaction: satisfactionScore,
        slaCompliance,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Error in getPerformanceMetrics:', error);
      throw error;
    }
  }

  /**
   * Get average response time
   */
  async getAverageResponseTime() {
    try {
      // This would need a support ticket system
      return {
        firstResponse: 120, // minutes
        resolution: 480, // minutes
        byPriority: {
          high: 60,
          medium: 180,
          low: 360
        }
      };
    } catch (error) {
      logger.error('Error in getAverageResponseTime:', error);
      return null;
    }
  }

  /**
   * Get fulfillment rate
   */
  async getFulfillmentRate() {
    try {
      const result = await Rental.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
            },
            cancelled: {
              $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
            }
          }
        },
        {
          $project: {
            rate: { $multiply: [{ $divide: ['$completed', { $max: ['$total', 1] }] }, 100] }
          }
        }
      ]);

      return result[0]?.rate || 0;
    } catch (error) {
      logger.error('Error in getFulfillmentRate:', error);
      return 0;
    }
  }

  /**
   * Get satisfaction score
   */
  async getSatisfactionScore() {
    try {
      const result = await Review.aggregate([
        {
          $group: {
            _id: null,
            avgRating: { $avg: '$ratings.overall' },
            totalReviews: { $sum: 1 }
          }
        }
      ]);

      // Get distribution separately
      const distribution = await Review.aggregate([
        {
          $group: {
            _id: '$ratings.overall',
            count: { $sum: 1 }
          }
        }
      ]);

      const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      distribution.forEach(item => {
        dist[item._id] = item.count;
      });

      if (result[0]) {
        return {
          score: result[0].avgRating,
          totalReviews: result[0].totalReviews,
          distribution: dist
        };
      }

      return { score: 0, totalReviews: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    } catch (error) {
      logger.error('Error in getSatisfactionScore:', error);
      return null;
    }
  }

  /**
   * Get SLA compliance
   */
  async getSLACompliance() {
    try {
      // This would need maintenance request tracking
      return {
        overall: 95,
        byPriority: {
          high: 98,
          medium: 95,
          low: 92
        }
      };
    } catch (error) {
      logger.error('Error in getSLACompliance:', error);
      return null;
    }
  }

  /**
   * Get date range based on period
   */
  getDateRange(period) {
    const end = new Date();
    let start;

    switch (period) {
      case '24h':
        start = moment().subtract(24, 'hours').toDate();
        break;
      case '7d':
        start = moment().subtract(7, 'days').toDate();
        break;
      case '30d':
        start = moment().subtract(30, 'days').toDate();
        break;
      case '90d':
        start = moment().subtract(90, 'days').toDate();
        break;
      case '1y':
        start = moment().subtract(1, 'year').toDate();
        break;
      case 'ytd':
        start = moment().startOf('year').toDate();
        break;
      default:
        start = moment().subtract(30, 'days').toDate();
    }

    return { start, end };
  }

  /**
   * Get previous period for comparison
   */
  getPreviousPeriod(dateRange) {
    const periodLength = dateRange.end.getTime() - dateRange.start.getTime();
    return {
      start: new Date(dateRange.start.getTime() - periodLength),
      end: new Date(dateRange.start)
    };
  }

  /**
   * Invalidate analytics cache
   */
  async invalidateAnalyticsCache() {
    try {
      if (this.redisClient) {
        const keys = await this.redisClient.keys('analytics:*');
        if (keys.length > 0) {
          await this.redisClient.del(keys);
          logger.info(`Invalidated ${keys.length} analytics cache keys`);
        }
      }
    } catch (error) {
      logger.error('Error invalidating analytics cache:', error);
    }
  }
}

module.exports = new AnalyticsService();