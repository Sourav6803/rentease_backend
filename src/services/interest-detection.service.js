const { ProductInterest } = require('../models');
const { addJob } = require('../jobs');
const logger = require('../config/logger');

const INTEREST_THRESHOLD = 50;

const SIGNAL_SCORES = {
  product_view: 5,
  time_spent_15s: 20,
  product_scroll: 15,
  product_zoom: 10,
  brochure_download: 20,
  availability_check: 15,
  add_to_wishlist: 30,
};

class InterestDetectionService {
  async processInteraction({ userId, sessionId, productId, eventType, timeSpentSeconds = 0, scrollDepth = 0 }) {
    const filter = userId
      ? { user: userId, product: productId }
      : { sessionId, product: productId };

    let interest = await ProductInterest.findOne(filter);
    if (!interest) {
      interest = new ProductInterest({
        user: userId || undefined,
        sessionId: sessionId || undefined,
        product: productId,
        signals: [],
      });
    }

    interest.viewCount += eventType === 'product_view' ? 1 : 0;
    interest.totalTimeSpentSeconds += timeSpentSeconds || 0;
    if (scrollDepth > interest.maxScrollDepth) interest.maxScrollDepth = scrollDepth;
    interest.lastViewedAt = new Date();

    const signals = [];
    if (timeSpentSeconds >= 15) signals.push({ type: 'time_spent_15s', score: SIGNAL_SCORES.time_spent_15s });
    if (scrollDepth >= 90) signals.push({ type: 'full_scroll', score: SIGNAL_SCORES.product_scroll });
    if (interest.viewCount >= 2) signals.push({ type: 'repeat_view', score: 25 });
    if (eventType === 'add_to_wishlist') signals.push({ type: 'wishlist', score: SIGNAL_SCORES.add_to_wishlist });
    if (eventType === 'product_zoom') signals.push({ type: 'zoom', score: SIGNAL_SCORES.product_zoom });
    if (eventType === 'brochure_download') signals.push({ type: 'brochure', score: SIGNAL_SCORES.brochure_download });
    if (eventType === 'availability_check') signals.push({ type: 'availability', score: SIGNAL_SCORES.availability_check });
    if (SIGNAL_SCORES[eventType]) signals.push({ type: eventType, score: SIGNAL_SCORES[eventType] });

    for (const sig of signals) {
      interest.signals.push({ ...sig, at: new Date() });
      interest.interactionScore += sig.score;
    }

    const wasInterested = interest.isInterested;
    interest.isInterested = interest.interactionScore >= INTEREST_THRESHOLD;

    await interest.save();

    if (interest.isInterested && !wasInterested && userId) {
      await this.triggerInterestActions(interest, userId);
    }

    return interest;
  }

  async triggerInterestActions(interest, userId) {
    try {
      await addJob('notification', 'create', {
        userId,
        type: 'marketing',
        title: 'Still interested?',
        message: 'We noticed you were checking out a product. Here is a special offer for you!',
        data: { productId: interest.product, interestScore: interest.interactionScore },
      });
    } catch (err) {
      logger.error('Interest trigger failed:', err);
    }
  }

  async listInterests(query = {}) {
    const filter = { isInterested: true };
    if (query.minScore) filter.interactionScore = { $gte: Number(query.minScore) };
    const page = parseInt(query.page, 10) || 1;
    const limit = parseInt(query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      ProductInterest.find(filter)
        .sort({ interactionScore: -1, lastViewedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('product', 'basicInfo.name pricing.monthlyRent')
        .populate('user', 'profile.firstName profile.lastName email phone')
        .lean(),
      ProductInterest.countDocuments(filter),
    ]);

    return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }
}

module.exports = new InterestDetectionService();
