const {
  User, Vendor, Product, Rental, Payment, Inventory, Delivery,
  Review, Cart, SupportTicket, Wishlist, UserBehaviorEvent, ProductInterest,
  CustomerSegment, EmailCampaign, EmailTemplate, MarketingWorkflow, Discount,
} = require('../models');
const AnalyticsService = require('./analytics.service');
const AdminService = require('./admin.service');
const DiscountService = require('./discount.service');
const VendorAnalyticsService = require('./vendor-analytics.service');
const logger = require('../config/logger');

const INTEREST_THRESHOLD = 50;
const INTEREST_SIGNALS = {
  time_spent_15s: 20,
  full_scroll: 15,
  repeat_view: 25,
  wishlist: 30,
  zoom: 10,
  brochure: 20,
  availability_check: 15,
};

class AdminIntelligenceService {
  resolveDateRange({ period, startDate, endDate } = {}) {
    const now = new Date();
    if (startDate && endDate) {
      return { start: new Date(startDate), end: new Date(endDate), period: 'custom' };
    }
    const map = {
      today: 0,
      yesterday: 1,
      '7d': 7,
      '15d': 15,
      '30d': 30,
      quarter: 90,
      year: 365,
    };
    const days = map[period] ?? 30;
    if (period === 'today') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { start, end: now, period: 'today' };
    }
    if (period === 'yesterday') {
      const end = new Date(now);
      end.setHours(0, 0, 0, 0);
      const start = new Date(end);
      start.setDate(start.getDate() - 1);
      return { start, end, period: 'yesterday' };
    }
    const start = new Date(now);
    start.setDate(start.getDate() - days);
    return { start, end: now, period: period || '30d' };
  }

  /** Module 1 — Overview cards (extends admin dashboard, adds MRR + inventory) */
  async getOverviewCards(query = {}) {
    const [dashboard, mrr, inventoryStats, pendingDeliveries] = await Promise.all([
      AdminService.getDashboardStats(),
      Rental.aggregate([
        { $match: { status: { $in: ['active', 'delivered', 'confirmed'] } } },
        { $group: { _id: null, mrr: { $sum: '$rentalDetails.monthlyRent' } } },
      ]),
      Inventory.aggregate([
        {
          $group: {
            _id: null,
            available: { $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] } },
            total: { $sum: 1 },
          },
        },
      ]),
      Delivery.countDocuments({
        status: { $in: ['scheduled', 'assigned', 'out_for_delivery', 'in_transit', 'batched'] },
      }),
    ]);

    const paymentRevenue = await Payment.aggregate([
      { $match: { status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const outOfStock = await Product.countDocuments({
      'status.isActive': true,
      $or: [{ 'inventory.availableQuantity': 0 }, { 'inventory.availableQuantity': { $exists: false } }],
    });

    const returnedRentals = await Rental.countDocuments({ status: 'completed' });

    return {
      totalRevenue: paymentRevenue[0]?.total || dashboard?.rentals?.revenue?.total || 0,
      mrr: mrr[0]?.mrr || 0,
      totalRentals: dashboard?.rentals?.total || 0,
      activeRentals: dashboard?.rentals?.active || 0,
      returnedRentals,
      pendingDeliveries,
      activeUsers: dashboard?.users?.active || 0,
      newUsersThisMonth: dashboard?.users?.newThisMonth || 0,
      vendors: dashboard?.vendors?.total || 0,
      products: dashboard?.products?.total || 0,
      availableInventory: inventoryStats[0]?.available || 0,
      outOfStockProducts: outOfStock,
      currency: 'INR',
      timestamp: new Date(),
    };
  }

  /** Module 1 — Rental analytics charts (delegates to existing analytics service) */
  async getRentalAnalyticsCharts(query = {}) {
    const period = query.period || '30d';
    const dateRange = this.resolveDateRange(query);
    const data = await AnalyticsService.getRentalAnalytics(dateRange);
    const revenue = await AnalyticsService.getRevenueAnalytics(dateRange);
    const products = await AnalyticsService.getProductAnalytics(dateRange);

    return {
      period,
      dateRange,
      rentalsByMonth: data.byMonth || [],
      rentalsByWeek: data.byWeek || data.peakDays || [],
      rentalsByCategory: products.byCategory || [],
      revenueTrends: revenue.daily || revenue.monthly || [],
      rentalGrowth: data.growth || [],
      productUtilization: products.utilization || [],
    };
  }

  /** Module 1 — Top performing products */
  async getTopProducts(query = {}) {
    const dateRange = this.resolveDateRange(query);
    const match = dateRange ? { createdAt: { $gte: dateRange.start, $lte: dateRange.end } } : {};
    const type = query.type || 'most_rented';

    const rentalLookup = [
      { $lookup: { from: 'rentals', localField: '_id', foreignField: 'product', as: 'rentals' } },
      {
        $addFields: {
          rentalCount: { $size: '$rentals' },
          revenue: { $sum: '$rentals.rentalDetails.totalAmount' },
        },
      },
    ];

    const [mostRented, highestRevenue, highestRated, mostViewed] = await Promise.all([
      Product.aggregate([
        ...rentalLookup,
        { $match: { 'status.isActive': true } },
        { $sort: { rentalCount: -1 } },
        { $limit: 10 },
        { $project: { name: '$basicInfo.name', rentalCount: 1, revenue: 1, slug: '$seo.slug' } },
      ]),
      Product.aggregate([
        ...rentalLookup,
        { $match: { 'status.isActive': true } },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
        { $project: { name: '$basicInfo.name', revenue: 1, rentalCount: 1 } },
      ]),
      Product.find({ 'status.isActive': true })
        .sort({ 'ratings.average': -1 })
        .limit(10)
        .select('basicInfo.name ratings.average ratings.count seo.slug')
        .lean(),
      Product.find({ 'status.isActive': true })
        .sort({ 'views.count': -1 })
        .limit(10)
        .select('basicInfo.name views.count seo.slug')
        .lean(),
    ]);

    const mostWishlisted = await Wishlist.aggregate([
      { $match: dateRange ? { createdAt: { $gte: dateRange.start, $lte: dateRange.end } } : {} },
      { $group: { _id: '$product', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' },
      { $project: { name: '$product.basicInfo.name', wishlistCount: '$count' } },
    ]);

    const result = {
      mostRented,
      highestRevenue,
      highestRated,
      mostViewed,
      mostWishlisted,
      highestConversion: [],
    };

    if (type !== 'all') {
      return { type, items: result[type] || result.mostRented };
    }
    return result;
  }

  /** Module 1 — Least performing products */
  async getLeastProducts(query = {}) {
    const now = new Date();
    const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
    const d30 = new Date(now); d30.setDate(d30.getDate() - 30);

    const [zeroRentals, noRentals7d, noRentals30d, lowRating, lowStock] = await Promise.all([
      Product.aggregate([
        { $lookup: { from: 'rentals', localField: '_id', foreignField: 'product', as: 'rentals' } },
        { $match: { 'status.isActive': true, rentals: { $size: 0 } } },
        { $limit: 20 },
        { $project: { name: '$basicInfo.name', createdAt: 1 } },
      ]),
      Product.aggregate([
        { $lookup: { from: 'rentals', localField: '_id', foreignField: 'product', as: 'rentals' } },
        {
          $match: {
            'status.isActive': true,
            $or: [
              { rentals: { $size: 0 } },
              { rentals: { $not: { $elemMatch: { createdAt: { $gte: d7 } } } } },
            ],
          },
        },
        { $limit: 20 },
        { $project: { name: '$basicInfo.name' } },
      ]),
      Product.aggregate([
        { $lookup: { from: 'rentals', localField: '_id', foreignField: 'product', as: 'rentals' } },
        {
          $match: {
            'status.isActive': true,
            $or: [
              { rentals: { $size: 0 } },
              { rentals: { $not: { $elemMatch: { createdAt: { $gte: d30 } } } } },
            ],
          },
        },
        { $limit: 20 },
        { $project: { name: '$basicInfo.name' } },
      ]),
      Product.find({ 'status.isActive': true, 'ratings.average': { $lte: 3, $gt: 0 } })
        .sort({ 'ratings.average': 1 })
        .limit(20)
        .select('basicInfo.name ratings.average ratings.count')
        .lean(),
      Product.find({
        'status.isActive': true,
        $or: [{ 'inventory.availableQuantity': { $lte: 2 } }, { 'inventory.availableQuantity': 0 }],
      })
        .limit(20)
        .select('basicInfo.name inventory.availableQuantity inventory.totalQuantity')
        .lean(),
    ]);

    return { zeroRentals, noRentals7d, noRentals30d, lowRating, lowStock };
  }

  /** Module 1 — Customer analytics */
  async getCustomerAnalyticsExtended(query = {}) {
    const base = await AnalyticsService.getCustomerAnalytics();
    const dateRange = this.resolveDateRange(query);
    const match = { status: 'success' };

    const [topSpenders, mostActive, repeatCustomers, avgDuration] = await Promise.all([
      Payment.aggregate([
        { $match: match },
        { $group: { _id: '$user', totalSpent: { $sum: '$amount' }, orders: { $sum: 1 } } },
        { $sort: { totalSpent: -1 } },
        { $limit: 10 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        {
          $project: {
            totalSpent: 1,
            orders: 1,
            name: { $concat: ['$user.profile.firstName', ' ', '$user.profile.lastName'] },
            email: '$user.email',
          },
        },
      ]),
      Rental.aggregate([
        { $match: dateRange ? { createdAt: { $gte: dateRange.start, $lte: dateRange.end } } : {} },
        { $group: { _id: '$user', rentalCount: { $sum: 1 } } },
        { $sort: { rentalCount: -1 } },
        { $limit: 10 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        {
          $project: {
            rentalCount: 1,
            name: { $concat: ['$user.profile.firstName', ' ', '$user.profile.lastName'] },
          },
        },
      ]),
      Rental.aggregate([
        { $group: { _id: '$user', count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $count: 'repeatCustomers' },
      ]),
      Rental.aggregate([
        { $match: { status: 'completed' } },
        {
          $project: {
            durationDays: {
              $divide: [{ $subtract: ['$rentalDetails.endDate', '$rentalDetails.startDate'] }, 86400000],
            },
          },
        },
        { $group: { _id: null, avgDays: { $avg: '$durationDays' } } },
      ]),
    ]);

    return {
      ...base,
      topSpendingCustomers: topSpenders,
      mostActiveCustomers: mostActive,
      repeatCustomers: repeatCustomers[0]?.repeatCustomers || 0,
      averageRentalDurationDays: Math.round(avgDuration[0]?.avgDays || 0),
    };
  }

  /** Module 5 — Product intelligence dashboard */
  async getProductIntelligence(query = {}) {
    const dateRange = this.resolveDateRange(query);
    const eventMatch = dateRange ? { createdAt: { $gte: dateRange.start, $lte: dateRange.end } } : {};

    const [topViewed, cartAdds, wishlisted, highViewsLowRentals, zeroViews, zeroRentals, interests] = await Promise.all([
      Product.find({ 'status.isActive': true }).sort({ 'views.count': -1 }).limit(15)
        .select('basicInfo.name views ratings pricing.monthlyRent').lean(),
      UserBehaviorEvent.aggregate([
        { $match: { ...eventMatch, eventType: 'add_to_cart' } },
        { $group: { _id: '$product', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 15 },
      ]),
      Wishlist.aggregate([
        { $match: eventMatch },
        { $group: { _id: '$product', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 15 },
      ]),
      Product.aggregate([
        { $match: { 'status.isActive': true, 'views.count': { $gte: 50 } } },
        { $lookup: { from: 'rentals', localField: '_id', foreignField: 'product', as: 'rentals' } },
        { $addFields: { rentalCount: { $size: '$rentals' } } },
        { $match: { rentalCount: { $lte: 2 } } },
        { $sort: { 'views.count': -1 } },
        { $limit: 15 },
        { $project: { name: '$basicInfo.name', views: '$views.count', rentalCount: 1 } },
      ]),
      Product.find({ 'status.isActive': true, $or: [{ 'views.count': 0 }, { 'views.count': { $exists: false } }] })
        .limit(20).select('basicInfo.name createdAt').lean(),
      Product.aggregate([
        { $lookup: { from: 'rentals', localField: '_id', foreignField: 'product', as: 'rentals' } },
        { $match: { 'status.isActive': true, rentals: { $size: 0 } } },
        { $limit: 20 },
        { $project: { name: '$basicInfo.name' } },
      ]),
      ProductInterest.find({ isInterested: true })
        .sort({ interactionScore: -1 })
        .limit(20)
        .populate('product', 'basicInfo.name')
        .populate('user', 'profile.firstName profile.lastName email')
        .lean(),
    ]);

    const top = await this.getTopProducts({ ...query, type: 'all' });
    const least = await this.getLeastProducts(query);

    return {
      period: dateRange.period,
      dateRange: { start: dateRange.start, end: dateRange.end },
      mostViewed: topViewed,
      mostRented: top.mostRented,
      mostAddedToCart: cartAdds,
      mostWishlisted: wishlisted,
      highestRated: top.highestRated,
      highestRevenue: top.highestRevenue,
      lowestRated: least.lowRating,
      zeroViews,
      zeroRentals,
      highViewsLowRentals,
      interestedProducts: interests,
    };
  }

  /** Module 9 — Vendor performance (delegates to vendor-analytics) */
  async getVendorPerformance(query = {}) {
    const { vendorId, period = '30d' } = query;
    if (vendorId) {
      const vendor = await Vendor.findById(vendorId).populate('user', 'email profile').lean();
      if (!vendor) return null;
      const analytics = await VendorAnalyticsService.getOverview(vendor._id, period);
      return { vendor, analytics };
    }
    const vendors = await Vendor.find({ 'verification.status': 'verified' }).limit(50).lean();
    const summaries = await Promise.all(
      vendors.slice(0, 20).map(async (v) => {
        try {
          const overview = await VendorAnalyticsService.getOverview(v._id, period);
          return { vendorId: v._id, businessName: v.business?.name, ...overview };
        } catch {
          return { vendorId: v._id, businessName: v.business?.name, error: true };
        }
      }),
    );
    return { period, vendors: summaries };
  }

  /** Module 11 — Operations dashboard */
  async getOperationsDashboard(query = {}) {
    const date = query.date ? new Date(query.date) : new Date();
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
    const now = new Date();

    const [
      todayDeliveries, todayPickups, lateDeliveries, latePickups,
      pendingMaintenance, inventoryMovement, activeDrivers, upcomingReturns, upcomingRenewals,
    ] = await Promise.all([
      Delivery.countDocuments({ 'schedule.scheduledDate': { $gte: dayStart, $lte: dayEnd } }),
      Rental.countDocuments({ 'pickup.scheduledDate': { $gte: dayStart, $lte: dayEnd } }),
      Delivery.countDocuments({
        status: { $nin: ['delivered', 'cancelled'] },
        'schedule.deadline': { $lt: now },
      }),
      Rental.countDocuments({
        status: 'out_for_pickup',
        'pickup.scheduledDate': { $lt: dayStart },
      }),
      require('../models').Maintenance.countDocuments({ status: { $in: ['pending', 'in_progress'] } }),
      Inventory.aggregate([
        { $match: { updatedAt: { $gte: dayStart, $lte: dayEnd } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      require('../models').DeliveryPerson.countDocuments({ 'availability.isOnDuty': true }),
      Rental.countDocuments({
        status: { $in: ['active', 'return_initiated'] },
        'rentalDetails.endDate': { $gte: dayStart, $lte: new Date(dayEnd.getTime() + 7 * 86400000) },
      }),
      Rental.countDocuments({
        status: 'extension_requested',
      }),
    ]);

    return {
      date: dayStart,
      todayDeliveries,
      todayPickups,
      lateDeliveries,
      latePickups,
      pendingMaintenance,
      inventoryMovement,
      warehouseStatus: inventoryMovement,
      activeDrivers,
      upcomingReturns,
      upcomingRenewals,
    };
  }

  /** Module 12 — AI insights (rule-based v1) */
  async getAiInsights(query = {}) {
    const [highViewsLowRentals, categoryRevenue, lowRated, insights] = await Promise.all([
      Product.aggregate([
        { $match: { 'status.isActive': true, 'views.count': { $gte: 30 } } },
        { $lookup: { from: 'rentals', localField: '_id', foreignField: 'product', as: 'rentals' } },
        { $addFields: { rentalCount: { $size: '$rentals' } } },
        { $match: { rentalCount: { $lt: 3 } } },
        { $limit: 5 },
        { $project: { name: '$basicInfo.name', views: '$views.count', rentalCount: 1 } },
      ]),
      Product.aggregate([
        { $lookup: { from: 'rentals', localField: '_id', foreignField: 'product', as: 'rentals' } },
        { $lookup: { from: 'categories', localField: 'category', foreignField: '_id', as: 'cat' } },
        { $unwind: '$cat' },
        { $group: { _id: '$cat.name', revenue: { $sum: { $sum: '$rentals.rentalDetails.totalAmount' } }, count: { $sum: { $size: '$rentals' } } } },
        { $sort: { revenue: -1 } },
      ]),
      Product.find({ 'ratings.average': { $lte: 3, $gt: 0 } }).limit(5)
        .select('basicInfo.name ratings.average vendor').lean(),
      [],
    ]);

    for (const p of highViewsLowRentals) {
      insights.push({
        type: 'conversion_gap',
        message: `"${p.name}" has ${p.views} views but only ${p.rentalCount} rentals — consider pricing or photos.`,
        confidence: 0.82,
        productId: p._id,
        recommendedAction: 'Review pricing, images, and run a targeted offer',
      });
    }

    if (categoryRevenue.length >= 2) {
      const top = categoryRevenue[0];
      const growth = categoryRevenue.slice(0, 3);
      insights.push({
        type: 'category_trend',
        message: `${top._id} category leads with ₹${Math.round(top.revenue).toLocaleString('en-IN')} revenue.`,
        confidence: 0.9,
        recommendedAction: 'Increase inventory in top category',
      });
    }

    for (const p of lowRated) {
      insights.push({
        type: 'quality_alert',
        message: `"${p.basicInfo?.name}" has low rating (${p.ratings?.average}) — quality review needed.`,
        confidence: 0.88,
        recommendedAction: 'Contact vendor for quality audit',
      });
    }

    const executiveSummary = insights.length
      ? `${insights.length} actionable insights generated. Top priority: address high-view low-conversion products.`
      : 'Platform metrics look healthy. No critical insights at this time.';

    return {
      insights,
      executiveSummary,
      generatedAt: new Date(),
      highViewsLowRentals,
      categoryRevenue: categoryRevenue.slice(0, 10),
    };
  }

  /** Module 2 — Coupon analytics (existing discount service) */
  async getCouponAnalytics(query = {}) {
    const { start, end } = this.resolveDateRange(query);
    return DiscountService.getDiscountAnalytics(start, end);
  }
}

module.exports = new AdminIntelligenceService();
