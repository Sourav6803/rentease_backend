const { Review, User, Product, Rental, Vendor } = require('../models');
const AppError  = require('../utils/AppError');
const { addJob } = require('../jobs');
const { eventEmitter, EVENTS } = require('../events');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const Sentiment = require('sentiment');
// `natural` v8 pulls afinn-165 which is ESM-only — crashes Node < 22 CJS
// require(). Load it defensively; fall back to a simple tokenizer so review
// creation is never blocked by an NLP dependency.
let natural = null;
try {
  natural = require('natural');
} catch (err) {
  logger.warn(`natural NLP unavailable, using fallback tokenizer: ${err.message}`);
}

class ReviewService {
  constructor() {
    this.redisClient = getRedisClient();
    this.defaultTTL = 1800; // 30 minutes
    this.sentiment = new Sentiment();
    this.tokenizer = natural ? new natural.WordTokenizer() : null;
    this.TfIdf = natural ? natural.TfIdf : null;
  }

  /**
   * Generate unique review number
   */
  generateReviewNumber() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `REV${timestamp}${random}`;
  }

  /**
   * Get product name (basicInfo.name)
   */
  async getProductName(productId) {
    try {
      const product = await Product.findById(productId).select('basicInfo.name').lean();
      return product?.basicInfo?.name || null;
    } catch {
      return null;
    }
  }

  /**
   * Get user display name
   */
  async getUserName(userId) {
    try {
      const user = await User.findById(userId).select('profile.firstName profile.lastName').lean();
      const first = user?.profile?.firstName || '';
      const last = user?.profile?.lastName || '';
      return [first, last].filter(Boolean).join(' ').trim() || 'A customer';
    } catch {
      return 'A customer';
    }
  }

  /**
   * Analyze review sentiment
   */
  analyzeSentiment(content, rating) {
    const sentimentScore = this.sentiment.analyze(content);
    
    // Combine sentiment score with rating for overall sentiment
    const normalizedSentiment = (sentimentScore.score + 5) / 10; // Convert -5..5 to 0..1
    const normalizedRating = rating / 5; // Convert 1..5 to 0..1
    
    const overallSentiment = (normalizedSentiment * 0.4) + (normalizedRating * 0.6);
    
    let sentiment;
    if (overallSentiment >= 0.7) sentiment = 'positive';
    else if (overallSentiment >= 0.4) sentiment = 'neutral';
    else sentiment = 'negative';

    return {
      score: sentimentScore.score,
      comparative: sentimentScore.comparative,
      positive: sentimentScore.positive,
      negative: sentimentScore.negative,
      sentiment,
      overall: overallSentiment
    };
  }

  /**
   * Extract keywords from review
   */
  extractKeywords(content) {
    // Fallback tokenizer when natural NLP is unavailable (ESM issue on Node < 22)
    const tokens = this.tokenizer
      ? this.tokenizer.tokenize(content.toLowerCase())
      : content.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    
    // Remove common stop words
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
                      'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
                      'before', 'after', 'above', 'below', 'is', 'are', 'was', 'were'];
    
    const keywords = tokens.filter(token => 
      token.length > 3 && !stopWords.includes(token)
    );

    // Get unique keywords
    return [...new Set(keywords)].slice(0, 10);
  }

  /**
   * Create review
   */
  async createReview(userId, reviewData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { rentalId, ratings, title, content, pros, cons, tips, media, images } = reviewData;

      // Check if rental exists and belongs to user
      const rental = await Rental.findOne({
        _id: rentalId,
        user: userId
      }).session(session);

      if (!rental) {
        throw new AppError('Rental not found or unauthorized', 404);
      }

      // A customer can review once delivery is confirmed and afterward.
      if (!['delivered', 'active', 'completed'].includes(rental.status)) {
        throw new AppError('Reviews can only be created after the rental is delivered', 400);
      }

      // Check if review already exists
      const existingReview = await Review.findOne({ rental: rentalId }).session(session);
      if (existingReview) {
        throw new AppError('Review already exists for this rental', 400);
      }

      // Analyze sentiment
      const sentiment = this.analyzeSentiment(content, ratings.overall);
      
      // Extract keywords
      const keywords = this.extractKeywords(content);

      // Create review
      const reviewNumber = this.generateReviewNumber();
      
      const review = await Review.create([{
        reviewNumber,
        rental: rentalId,
        user: userId,
        product: rental.product,
        vendor: rental.vendor,
        ratings,
        title,
        content,
        pros: pros || [],
        cons: cons || [],
        tips: tips || undefined,
        attachments: media || (images || []).map(img => ({
          type: 'image',
          url: typeof img === 'string' ? img : img.url,
          publicId: typeof img === 'object' ? img.publicId : undefined
        })),
        sentiment: {
          score: sentiment.score,
          sentiment: sentiment.sentiment,
          keywords
        },
        verification: {
          isVerifiedPurchase: true
        },
        moderation: {
          status: 'pending'
        },
        metadata: {
          createdBy: userId,
          source: 'web'
        }
      }], { session });

      await session.commitTransaction();

      // Notify admins — every new review starts as `pending` and must be
      // approved by an admin before it becomes public (see moderateReview).
      // Get product + user names for a meaningful notification.
      const productName = rental.productName || (await this.getProductName(rental.product));
      const customerName = await this.getUserName(userId);

      await addJob('notification', 'create', {
        role: ['admin', 'super-admin', 'super_admin'],
        type: 'in_app',
        title: '⭐ New Review Pending Approval',
        content: `${customerName} rated "${productName || 'a product'}" ${ratings.overall}/5 and left a review. Review and approve it.`,
        data: {
          reviewId: review[0]._id,
          reviewNumber: review[0].reviewNumber,
          productId: rental.product,
          rating: ratings.overall,
          moderationUrl: `/admin/reviews/moderation/${review[0]._id}`,
        },
      });

      // Update product rating
      await this.updateProductRating(rental.product);

      // Update vendor rating
      await this.updateVendorRating(rental.vendor);

      await this.invalidateReviewCache(review[0]._id);

      // Emit event
      eventEmitter.emit(EVENTS.REVIEW.SUBMITTED, {
        reviewId: review[0]._id,
        reviewNumber: review[0].reviewNumber,
        userId,
        vendorId: rental.vendor,
        productId: rental.product,
        rating: ratings.overall
      });

      // Check for moderation if sentiment is very negative
      if (sentiment.sentiment === 'negative' && ratings.overall <= 2) {
        await this.flagForModeration(review[0]._id, 'Negative review requires moderation');
      }

      return review[0];
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in createReview:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get review by ID
   */
  async getReview(reviewId, userId, userRole = 'user') {
    try {
      const cacheKey = `review:${reviewId}`;
      
      // Try cache first
      // if (this.redisClient) {
      //   const cached = await this.redisClient.get(cacheKey);
      //   if (cached) {
      //     return JSON.parse(cached);
      //   }
      // }

      const review = await Review.findById(reviewId)
        .populate('user', 'profile.firstName profile.lastName profile.avatar')
        .populate('vendor', 'business.name')
        .populate({
          path: 'product',
          select: 'basicInfo.name basicInfo.slug media.images'
        })
        .populate({
          path: 'rental',
          select: 'rentalNumber'
        })
        .populate('responses.user', 'profile.firstName profile.lastName role')
        .populate('helpful.users.user', 'profile.firstName profile.lastName')
        .lean();

      if (!review) {
        throw new AppError('Review not found', 404);
      }

      // Approved reviews are public. Pending reviews are restricted to their
      // author or an authenticated admin; public callers have no userId.
      const isAdmin = ['admin', 'super-admin', 'super_admin'].includes(userRole);
      const reviewUserId = review.user?._id?.toString();
      const requestingUserId = userId?.toString();
      if (review.moderation.status === 'pending' &&
          !isAdmin &&
          (!requestingUserId || reviewUserId !== requestingUserId)) {
        throw new AppError('Review is pending moderation', 403);
      }

      // Calculate helpful percentage
      const helpfulCount = review.helpful?.count || 0;
      const totalVotes = helpfulCount + (review.reported?.count || 0);
      review.helpfulPercentage = totalVotes > 0 ?
        (helpfulCount / totalVotes) * 100 : 0;

      // Cache the result
      if (this.redisClient && review.moderation.status === 'approved') {
        await this.redisClient.setex(cacheKey, this.defaultTTL, JSON.stringify(review));
      }

      return review;
    } catch (error) {
      logger.error('Error in getReview:', error);
      throw error;
    }
  }

  /**
   * Get product reviews
   */
  async getProductReviews(productId, page = 1, limit = 10, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = { 
        product: productId,
        'moderation.status': 'approved',
        status: 'active'
      };

      if (filters.rating) {
        query['ratings.overall'] = parseInt(filters.rating);
      }

      if (filters.hasImages) {
        query['attachments.0'] = { $exists: true };
      }

      if (filters.hasResponse) {
        query['responses.0'] = { $exists: true };
      }

      if (filters.sort === 'helpful') {
        var sortOption = { 'helpful.count': -1, createdAt: -1 };
      } else if (filters.sort === 'newest') {
        var sortOption = { createdAt: -1 };
      } else if (filters.sort === 'highest') {
        var sortOption = { 'ratings.overall': -1, createdAt: -1 };
      } else if (filters.sort === 'lowest') {
        var sortOption = { 'ratings.overall': 1, createdAt: -1 };
      } else {
        var sortOption = { createdAt: -1 };
      }

      const [reviews, total, ratingDistribution] = await Promise.all([
        Review.find(query)
          .populate('user', 'profile.firstName profile.lastName profile.avatar')
          .populate('responses.user', 'profile.firstName profile.lastName role')
          .sort(sortOption)
          .skip(skip)
          .limit(limit)
          .lean(),
        Review.countDocuments(query),
        this.getRatingDistribution(productId)
      ]);
      // Calculate helpful percentages
      reviews.forEach(review => {
        const helpfulCount = review.helpful?.count || 0;
        const totalVotes = helpfulCount + (review.reported?.count || 0);
        review.helpfulPercentage = totalVotes > 0 ?
          (helpfulCount / totalVotes) * 100 : 0;
      });

      // Get summary statistics
      const summary = await this.getReviewSummary(productId);

      return {
        reviews,
        summary,
        distribution: ratingDistribution,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getProductReviews:', error);
      throw error;
    }
  }

  /**
   * Get vendor reviews
   */
  async getVendorReviews(vendorId, page = 1, limit = 10, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = { 
        vendor: vendorId,
        'moderation.status': 'approved',
        status: 'active'
      };

      const [reviews, total] = await Promise.all([
        Review.find(query)
          .populate('user', 'profile.firstName profile.lastName profile.avatar')
          .populate('product', 'basicInfo.name basicInfo.slug')
          .populate('rental', 'rentalNumber')
          .populate('responses.user', 'profile.firstName profile.lastName role')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Review.countDocuments(query)
      ]);

      // Get vendor rating summary
      const summary = await Review.aggregate([
        { $match: { vendor: vendorId, 'moderation.status': 'approved' } },
        {
          $group: {
            _id: null,
            averageRating: { $avg: '$ratings.overall' },
            totalReviews: { $sum: 1 },
            averageCommunication: { $avg: '$ratings.vendor.communication' },
            averageDelivery: { $avg: '$ratings.vendor.deliveryTimeliness' },
            averageProfessionalism: { $avg: '$ratings.vendor.professionalism' }
          }
        }
      ]);

      return {
        reviews,
        summary: summary[0] || {
          averageRating: 0,
          totalReviews: 0,
          averageCommunication: 0,
          averageDelivery: 0,
          averageProfessionalism: 0
        },
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getVendorReviews:', error);
      throw error;
    }
  }

  /**
   * Get user reviews
   */
  async getUserReviews(userId, page = 1, limit = 10) {
    try {
      const skip = (page - 1) * limit;

      const [reviews, total] = await Promise.all([
        Review.find({ user: userId })
          .populate('product', 'basicInfo.name basicInfo.slug media.images')
          .populate('vendor', 'business.name')
          .populate('rental', 'rentalNumber')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Review.countDocuments({ user: userId })
      ]);

      return {
        reviews,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getUserReviews:', error);
      throw error;
    }
  }

  /**
   * Update review
   */
  async updateReview(reviewId, userId, updateData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const review = await Review.findOne({
        _id: reviewId,
        user: userId
      }).session(session);

      if (!review) {
        throw new AppError('Review not found or unauthorized', 404);
      }

      // Update fields
      const { ratings, title, content, pros, cons, tips, media, images } = updateData;

      if (ratings) review.ratings = ratings;
      if (title) review.title = title;
      if (content) {
        review.content = content;
        // Re-analyze sentiment
        const sentiment = this.analyzeSentiment(content, ratings?.overall || review.ratings.overall);
        review.sentiment = {
          score: sentiment.score,
          sentiment: sentiment.sentiment,
          keywords: this.extractKeywords(content)
        };
      }
      if (pros) review.pros = pros;
      if (cons) review.cons = cons;
      if (tips !== undefined) review.tips = tips;
      if (media?.length) {
        review.attachments = [...(review.attachments || []), ...media].slice(0, 5);
      } else if (images) {
        review.attachments = images.map(img => ({
          type: 'image',
          url: img,
        }));
      }

      // Any edit to a public review must pass moderation again.
      review.moderation.status = 'pending';
      review.moderation.reviewedBy = undefined;
      review.moderation.reviewedAt = undefined;
      review.moderation.rejectionReason = undefined;

      review.metadata.updatedBy = userId;
      review.metadata.updatedAt = new Date();

      await review.save({ session });

      await session.commitTransaction();

      // The edit is pending moderation now, so remove its old public rating
      // from product/vendor aggregates until it is approved again.
      await this.updateProductRating(review.product);
      await this.updateVendorRating(review.vendor);

      // Invalidate cache
      await this.invalidateReviewCache(reviewId);

      return review;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in updateReview:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Delete review
   */
  async deleteReview(reviewId, userId, userRole) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const query = { _id: reviewId };
      if (userRole === 'user') {
        query.user = userId;
      }

      const review = await Review.findOne(query).session(session);

      if (!review) {
        throw new AppError('Review not found or unauthorized', 404);
      }

      // Soft delete
      review.status = 'deleted';
      review.metadata.deletedBy = userId;
      review.metadata.deletedAt = new Date();
      await review.save({ session });

      await session.commitTransaction();

      // Update product rating
      await this.updateProductRating(review.product);

      // Update vendor rating
      await this.updateVendorRating(review.vendor);

      // Invalidate cache
      await this.invalidateReviewCache(reviewId);

      return { message: 'Review deleted successfully' };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in deleteReview:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Mark review as helpful
   */
  async markHelpful(reviewId, userId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const review = await Review.findById(reviewId).session(session);

      if (!review) {
        throw new AppError('Review not found', 404);
      }

      // Check if user already marked as helpful
      const alreadyHelpful = review.helpful.users.some(
        u => u.user.toString() === userId.toString()
      );

      if (alreadyHelpful) {
        // Remove helpful mark
        review.helpful.users = review.helpful.users.filter(
          u => u.user.toString() !== userId.toString()
        );
        review.helpful.count -= 1;
      } else {
        // Add helpful mark
        review.helpful.users.push({
          user: userId,
          votedAt: new Date()
        });
        review.helpful.count += 1;
      }

      await review.save({ session });

      await session.commitTransaction();

      return { 
        helpful: !alreadyHelpful,
        count: review.helpful.count 
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in markHelpful:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Report review
   */
  async reportReview(reviewId, userId, reason) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const review = await Review.findById(reviewId).session(session);

      if (!review) {
        throw new AppError('Review not found', 404);
      }

      // Check if user already reported
      const alreadyReported = review.reported?.reasons?.some(
        r => r.user.toString() === userId.toString()
      );

      if (alreadyReported) {
        throw new AppError('You have already reported this review', 400);
      }

      review.reported.count = (review.reported.count || 0) + 1;
      review.reported.reasons = review.reported.reasons || [];
      review.reported.reasons.push({
        user: userId,
        reason,
        reportedAt: new Date(),
        status: 'pending'
      });

      // Auto-flag if multiple reports
      if (review.reported.count >= 3) {
        review.moderation.status = 'flagged';
        
        // Notify admins
        await addJob('notification', 'create', {
          role: ['admin', 'super-admin'],
          type: 'in_app',
          title: '🚩 Review Flagged',
          content: `Review #${review.reviewNumber} has been flagged by ${review.reported.count} users.`,
          data: {
            reviewId: review._id,
            reports: review.reported.count
          }
        });
      }

      await review.save({ session });

      await session.commitTransaction();

      return { 
        reported: true,
        totalReports: review.reported.count 
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in reportReview:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Add vendor response
   */
  async addResponse(reviewId, vendorId, content) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const review = await Review.findOne({
        _id: reviewId,
        vendor: vendorId
      }).session(session);

      if (!review) {
        throw new AppError('Review not found or unauthorized', 404);
      }

      // Check if vendor already responded
      const hasVendorResponse = review.responses.some(r => r.isVendorResponse);
      if (hasVendorResponse) {
        throw new AppError('Vendor has already responded to this review', 400);
      }

      review.responses.push({
        user: vendorId,
        content,
        isVendorResponse: true,
        createdAt: new Date()
      });

      review.timeline = review.timeline || [];
      review.timeline.push({
        action: 'vendor_responded',
        timestamp: new Date()
      });

      await review.save({ session });

      await session.commitTransaction();

      // Notify user
      await addJob('notification', 'create', {
        userId: review.user,
        type: 'in_app',
        title: 'Vendor Responded to Your Review',
        content: `The vendor has responded to your review.`,
        data: {
          reviewId: review._id,
          productId: review.product
        }
      });

      // Invalidate cache
      await this.invalidateReviewCache(reviewId);

      return review.responses[review.responses.length - 1];
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in addResponse:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Update product rating
   */
  async updateProductRating(productId) {
    try {
      const stats = await Review.aggregate([
        { 
          $match: { 
            product: productId, 
            'moderation.status': 'approved',
            status: 'active'
          } 
        },
        {
          $group: {
            _id: null,
            average: { $avg: '$ratings.overall' },
            count: { $sum: 1 },
            distribution: {
              $push: '$ratings.overall'
            }
          }
        }
      ]);

      if (stats.length > 0) {
        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        stats[0].distribution.forEach(r => distribution[r]++);

        await Product.findByIdAndUpdate(productId, {
          $set: {
            'ratings.average': stats[0].average,
            'ratings.count': stats[0].count,
            'ratings.distribution': distribution
          }
        });
      }
    } catch (error) {
      logger.error('Error in updateProductRating:', error);
    }
  }

  /**
   * Update vendor rating
   */
  async updateVendorRating(vendorId) {
    try {
      // Reviews store the owner User id, while Vendor updates use the Vendor id.
      const vendor = await Vendor.findById(vendorId).select('user').lean()
        || await Vendor.findOne({ user: vendorId }).select('user').lean();
      if (!vendor) return;

      const stats = await Review.aggregate([
        { 
          $match: { 
            vendor: vendor.user,
            'moderation.status': 'approved',
            status: 'active'
          } 
        },
        {
          $group: {
            _id: null,
            average: { $avg: '$ratings.overall' },
            count: { $sum: 1 },
            avgCommunication: { $avg: '$ratings.vendor.communication' },
            avgDelivery: { $avg: '$ratings.vendor.deliveryTimeliness' },
            avgProfessionalism: { $avg: '$ratings.vendor.professionalism' }
          }
        }
      ]);

      const rating = stats[0] || {
        average: 0,
        count: 0,
        avgCommunication: 0,
        avgDelivery: 0,
        avgProfessionalism: 0,
      };

      await Vendor.findByIdAndUpdate(vendor._id, {
        $set: {
          'performance.rating.average': rating.average,
          'performance.rating.count': rating.count,
          'performance.metrics.customerSatisfaction': rating.average,
          'performance.vendorRatings': {
            communication: rating.avgCommunication || 0,
            delivery: rating.avgDelivery || 0,
            professionalism: rating.avgProfessionalism || 0
          }
        }
      });
    } catch (error) {
      logger.error('Error in updateVendorRating:', error);
    }
  }

  /**
   * Get rating distribution for product
   */
  async getRatingDistribution(productId) {
    try {
      const productObjectId = new mongoose.Types.ObjectId(productId);
      const distribution = await Review.aggregate([
        { 
          $match: { 
            product: productObjectId, 
            'moderation.status': 'approved',
            status: 'active'
          } 
        },
        {
          $group: {
            _id: '$ratings.overall',
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      const result = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      distribution.forEach(d => {
        result[d._id] = d.count;
      });

      return result;
    } catch (error) {
      logger.error('Error in getRatingDistribution:', error);
      return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    }
  }

  /**
   * Get review summary for product
   */
  async getReviewSummary(productId) {
    try {
      const productObjectId = new mongoose.Types.ObjectId(productId);
      const summary = await Review.aggregate([
        { 
          $match: { 
            product: productObjectId, 
            'moderation.status': 'approved',
            status: 'active'
          } 
        },
        {
          $group: {
            _id: null,
            totalReviews: { $sum: 1 },
            averageRating: { $avg: '$ratings.overall' },
            withImages: {
              $sum: { $cond: [{ $gt: [{ $size: '$attachments' }, 0] }, 1, 0] }
            },
            withVendorResponse: {
              $sum: { 
                $cond: [{ 
                  $gt: [
                    { $size: { $filter: { input: '$responses', as: 'r', cond: '$$r.isVendorResponse' } } },
                    0
                  ]
                }, 1, 0]
              }
            },
            averageProductQuality: { $avg: '$ratings.product.quality' },
            averageValueForMoney: { $avg: '$ratings.product.valueForMoney' },
            averageCondition: { $avg: '$ratings.product.condition' }
          }
        }
      ]);

      // Get sentiment breakdown
      const sentimentBreakdown = await Review.aggregate([
        { 
          $match: { 
            product: productObjectId, 
            'moderation.status': 'approved',
            status: 'active'
          } 
        },
        {
          $group: {
            _id: '$sentiment.sentiment',
            count: { $sum: 1 }
          }
        }
      ]);

      const sentiment = {
        positive: 0,
        neutral: 0,
        negative: 0
      };
      sentimentBreakdown.forEach(s => {
        sentiment[s._id] = s.count;
      });

      return {
        ...summary[0],
        sentiment
      };
    } catch (error) {
      logger.error('Error in getReviewSummary:', error);
      return {
        totalReviews: 0,
        averageRating: 0,
        withImages: 0,
        withVendorResponse: 0,
        sentiment: { positive: 0, neutral: 0, negative: 0 }
      };
    }
  }

  /**
   * Flag review for moderation
   */
  async flagForModeration(reviewId, reason) {
    try {
      const review = await Review.findById(reviewId);
      if (!review) return;

      review.moderation.status = 'flagged';
      review.moderation.moderationNotes = reason;
      await review.save();

      // Notify admins
      await addJob('notification', 'create', {
        role: ['admin', 'super-admin'],
        type: 'in_app',
        title: '🚩 Review Flagged for Moderation',
        content: `Review #${review.reviewNumber} has been flagged. Reason: ${reason}`,
        data: {
          reviewId: review._id,
          reason
        }
      });
    } catch (error) {
      logger.error('Error in flagForModeration:', error);
    }
  }

  /**
   * Moderate review (admin only)
   */
  async moderateReview(reviewId, adminId, moderationData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { status, reason, notes } = moderationData;

      const review = await Review.findById(reviewId).session(session);

      if (!review) {
        throw new AppError('Review not found', 404);
      }

      review.moderation.status = status;
      review.moderation.reviewedBy = adminId;
      review.moderation.reviewedAt = new Date();
      
      if (status === 'rejected') {
        review.moderation.rejectionReason = reason;
      }
      
      if (notes) {
        review.moderation.moderationNotes = notes;
      }

      // If rejected, hide the review
      if (status === 'rejected') {
        review.status = 'hidden';
      }

      review.timeline = review.timeline || [];
      review.timeline.push({
        action: `moderation_${status}`,
        timestamp: new Date(),
        note: reason
      });

      await review.save({ session });

      await session.commitTransaction();

      // Notify user
      await addJob('notification', 'create', {
        userId: review.user,
        type: 'in_app',
        title: status === 'approved' ? '✅ Review Approved' : '❌ Review Rejected',
        content: status === 'approved' 
          ? 'Your review has been approved and is now public.'
          : `Your review was not approved. Reason: ${reason}`,
        data: {
          reviewId: review._id,
          status
        }
      });

      if (status === 'approved') {
        // Update product and vendor ratings
        await this.updateProductRating(review.product);
        await this.updateVendorRating(review.vendor);

        // Notify the vendor — an approved review is now public on their product.
        const vendor = await Vendor.findById(review.vendor).select('user').lean();
        const productName = await this.getProductName(review.product);
        const customerName = await this.getUserName(review.user);

        if (vendor?.user) {
          await addJob('notification', 'create', {
            userId: vendor.user,
            type: 'in_app',
            title: '⭐ New Review on Your Product',
            content: `${customerName} rated "${productName || 'your product'}" ${review.ratings?.overall}/5. The review is now live.`,
            data: {
              reviewId: review._id,
              reviewNumber: review.reviewNumber,
              productId: review.product,
              rating: review.ratings?.overall,
              reviewUrl: `/product/${review.product}`,
            },
          });
        }
      }

      // Invalidate cache
      await this.invalidateReviewCache(reviewId);

      return review;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in moderateReview:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get pending reviews for moderation (admin only)
   */
  async getPendingReviews(page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit;

      const [reviews, total] = await Promise.all([
        Review.find({ 
          'moderation.status': 'pending',
          status: 'active'
        })
        .populate('user', 'profile.firstName profile.lastName email')
        .populate('product', 'basicInfo.name')
        .populate('vendor', 'business.name')
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
        Review.countDocuments({ 'moderation.status': 'pending', status: 'active' })
      ]);

      return {
        reviews,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getPendingReviews:', error);
      throw error;
    }
  }

  /**
   * Get flagged reviews (admin only)
   */
  async getFlaggedReviews(page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit;

      const [reviews, total] = await Promise.all([
        Review.find({ 
          'moderation.status': 'flagged',
          status: 'active'
        })
        .populate('user', 'profile.firstName profile.lastName email')
        .populate('product', 'basicInfo.name')
        .populate('vendor', 'business.name')
        .sort({ 'reported.count': -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
        Review.countDocuments({ 'moderation.status': 'flagged', status: 'active' })
      ]);

      return {
        reviews,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getFlaggedReviews:', error);
      throw error;
    }
  }

  /**
   * Get review analytics (admin only)
   */
  async getReviewAnalytics(startDate, endDate) {
    try {
      const analytics = await Review.aggregate([
        {
          $match: {
            createdAt: {
              $gte: new Date(startDate),
              $lte: new Date(endDate)
            }
          }
        },
        {
          $facet: {
            overview: [
              {
                $group: {
                  _id: null,
                  totalReviews: { $sum: 1 },
                  approvedReviews: {
                    $sum: { $cond: [{ $eq: ['$moderation.status', 'approved'] }, 1, 0] }
                  },
                  pendingReviews: {
                    $sum: { $cond: [{ $eq: ['$moderation.status', 'pending'] }, 1, 0] }
                  },
                  rejectedReviews: {
                    $sum: { $cond: [{ $eq: ['$moderation.status', 'rejected'] }, 1, 0] }
                  },
                  flaggedReviews: {
                    $sum: { $cond: [{ $eq: ['$moderation.status', 'flagged'] }, 1, 0] }
                  },
                  averageRating: { $avg: '$ratings.overall' },
                  totalHelpful: { $sum: '$helpful.count' },
                  totalReports: { $sum: '$reported.count' }
                }
              }
            ],
            byRating: [
              {
                $group: {
                  _id: '$ratings.overall',
                  count: { $sum: 1 }
                }
              },
              { $sort: { _id: 1 } }
            ],
            bySentiment: [
              {
                $group: {
                  _id: '$sentiment.sentiment',
                  count: { $sum: 1 }
                }
              }
            ],
            daily: [
              {
                $group: {
                  _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' },
                    day: { $dayOfMonth: '$createdAt' }
                  },
                  count: { $sum: 1 },
                  averageRating: { $avg: '$ratings.overall' }
                }
              },
              { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
            ],
            topProducts: [
              {
                $group: {
                  _id: '$product',
                  count: { $sum: 1 },
                  averageRating: { $avg: '$ratings.overall' }
                }
              },
              { $sort: { count: -1 } },
              { $limit: 10 },
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
                  productName: '$product.basicInfo.name',
                  count: 1,
                  averageRating: 1
                }
              }
            ]
          }
        }
      ]);

      return analytics[0];
    } catch (error) {
      logger.error('Error in getReviewAnalytics:', error);
      throw error;
    }
  }

  /**
   * Invalidate review cache
   */
  async invalidateReviewCache(reviewId) {
    try {
      if (this.redisClient) {
        const review = await Review.findById(reviewId).select('rental').lean();
        const patterns = [
          `review:${reviewId}`,
          `review:${reviewId}:*`,
          'reviews:product:*',
          'reviews:vendor:*',
          'reviews:user:*',
          'product:*:ratings',
          'vendor:*:ratings'
        ];

        if (review?.rental) {
          patterns.push(`rental:${review.rental}:*`, `rental:${review.rental}`);
        }
        
        for (const pattern of patterns) {
          const keys = await this.redisClient.keys(pattern);
          if (keys.length > 0) {
            await this.redisClient.del(keys);
          }
        }
      }
    } catch (error) {
      logger.error('Error invalidating review cache:', error);
    }
  }
}

module.exports = new ReviewService();