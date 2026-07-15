const { UserBehaviorEvent, ProductInterest, Wishlist, Product, User } = require('../models');
const InterestDetectionService = require('./interest-detection.service');
const logger = require('../config/logger');

class BehaviorTrackingService {
  async trackEvent(payload, userId = null) {
    const event = await UserBehaviorEvent.create({
      user: userId || payload.userId,
      sessionId: payload.sessionId,
      eventType: payload.eventType,
      product: payload.productId,
      category: payload.categoryId,
      metadata: {
        query: payload.query,
        scrollDepth: payload.scrollDepth,
        timeSpentSeconds: payload.timeSpentSeconds,
        device: payload.device,
        browser: payload.browser,
        location: payload.location,
        trafficSource: payload.trafficSource,
        referrer: payload.referrer,
        pageUrl: payload.pageUrl,
        cartValue: payload.cartValue,
        rentalId: payload.rentalId,
      },
    });

    if (payload.productId && (userId || payload.sessionId)) {
      await InterestDetectionService.processInteraction({
        userId: userId || payload.userId,
        sessionId: payload.sessionId,
        productId: payload.productId,
        eventType: payload.eventType,
        timeSpentSeconds: payload.timeSpentSeconds,
        scrollDepth: payload.scrollDepth,
      });
    }

    if (payload.eventType === 'product_view' && payload.productId) {
      await Product.updateOne({ _id: payload.productId }, {
        $inc: { 'views.count': 1 },
        $set: { 'views.lastViewed': new Date() },
      });
    }

    return event;
  }

  async getAnalytics(query = {}) {
    const start = query.startDate ? new Date(query.startDate) : new Date(Date.now() - 30 * 86400000);
    const end = query.endDate ? new Date(query.endDate) : new Date();
    const match = { createdAt: { $gte: start, $lte: end } };

    const [byEvent, topProducts, topSearches, deviceBreakdown, avgSession] = await Promise.all([
      UserBehaviorEvent.aggregate([
        { $match: match },
        { $group: { _id: '$eventType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      UserBehaviorEvent.aggregate([
        { $match: { ...match, product: { $exists: true, $ne: null } } },
        { $group: { _id: '$product', views: { $sum: 1 } } },
        { $sort: { views: -1 } },
        { $limit: 15 },
        { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
        { $unwind: '$product' },
        { $project: { name: '$product.basicInfo.name', views: 1 } },
      ]),
      UserBehaviorEvent.aggregate([
        { $match: { ...match, eventType: 'search', 'metadata.query': { $exists: true } } },
        { $group: { _id: '$metadata.query', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
      UserBehaviorEvent.aggregate([
        { $match: match },
        { $group: { _id: '$metadata.device', count: { $sum: 1 } } },
      ]),
      UserBehaviorEvent.aggregate([
        { $match: match },
        { $group: { _id: '$sessionId', events: { $sum: 1 }, duration: { $sum: '$metadata.timeSpentSeconds' } } },
        { $group: { _id: null, avgEvents: { $avg: '$events' }, avgDuration: { $avg: '$duration' } } },
      ]),
    ]);

    return {
      dateRange: { start, end },
      byEvent,
      topProducts,
      topSearches,
      deviceBreakdown,
      avgSessionTimeSeconds: Math.round(avgSession[0]?.avgDuration || 0),
      returningVisitors: await UserBehaviorEvent.distinct('user', { ...match, user: { $ne: null } }).then((u) => u.length),
    };
  }

  async addToWishlist(userId, productId, source = 'web') {
    return Wishlist.findOneAndUpdate(
      { user: userId, product: productId },
      { $setOnInsert: { user: userId, product: productId, source, addedAt: new Date() } },
      { upsert: true, new: true },
    );
  }

  async removeFromWishlist(userId, productId) {
    return Wishlist.deleteOne({ user: userId, product: productId });
  }

  async getUserWishlist(userId) {
    return Wishlist.find({ user: userId })
      .populate('product', 'basicInfo.name pricing.monthlyRent seo.slug ratings images')
      .sort({ addedAt: -1 })
      .lean();
  }
}

module.exports = new BehaviorTrackingService();
