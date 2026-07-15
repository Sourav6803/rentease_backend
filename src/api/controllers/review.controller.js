const ReviewService = require('../../services/review.service');
const catchAsync = require('../../utils/catchAsync');
const {ApiResponse} = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');

class ReviewController {
  /**
   * Create review
   */
  createReview = catchAsync(async (req, res) => {
    const review = await ReviewService.createReview(req.user._id, req.body);
    
    return ApiResponse.success(res, 201, 'Review created successfully', { review });
  });

  /**
   * Get review by ID
   */
  getReview = catchAsync(async (req, res) => {
    const { id } = req.params;
    const review = await ReviewService.getReview(id, req.user?._id, req.user?.role);
    
    return ApiResponse.success(res, 200, 'Review retrieved successfully', { review });
  });

  /**
   * Get product reviews
   */
  getProductReviews = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { page = 1, limit = 10, ...filters } = req.query;
    
    const reviews = await ReviewService.getProductReviews(
      productId,
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Product reviews retrieved successfully', reviews);
  });

  /**
   * Get vendor reviews
   */
  getVendorReviews = catchAsync(async (req, res) => {
    const { vendorId } = req.params;
    const { page = 1, limit = 10, ...filters } = req.query;
    
    const reviews = await ReviewService.getVendorReviews(
      vendorId,
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Vendor reviews retrieved successfully', reviews);
  });

  /**
   * Get user reviews
   */
  getUserReviews = catchAsync(async (req, res) => {
    const { page = 1, limit = 10 } = req.query;
    
    const reviews = await ReviewService.getUserReviews(
      req.user._id,
      parseInt(page),
      parseInt(limit)
    );
    
    return ApiResponse.success(res, 200, 'User reviews retrieved successfully', reviews);
  });

  /**
   * Update review
   */
  updateReview = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const review = await ReviewService.updateReview(id, req.user._id, req.body);
    
    return ApiResponse.success(res, 200, 'Review updated successfully', { review });
  });

  /**
   * Delete review
   */
  deleteReview = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const result = await ReviewService.deleteReview(id, req.user._id, req.user.role);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Mark review as helpful
   */
  markHelpful = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const result = await ReviewService.markHelpful(id, req.user._id);
    
    return ApiResponse.success(res, 200, 'Review marked as helpful', result);
  });

  /**
   * Report review
   */
  reportReview = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    
    if (!reason) {
      throw new AppError('Report reason is required', 400);
    }

    const result = await ReviewService.reportReview(id, req.user._id, reason);
    
    return ApiResponse.success(res, 200, 'Review reported successfully', result);
  });

  /**
   * Add vendor response
   */
  addResponse = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    
    if (!content) {
      throw new AppError('Response content is required', 400);
    }

    const response = await ReviewService.addResponse(id, req.user._id, content);
    
    return ApiResponse.success(res, 200, 'Response added successfully', { response });
  });

  /**
   * Get review summary for product
   */
  getReviewSummary = catchAsync(async (req, res) => {
    const { productId } = req.params;
    
    const summary = await ReviewService.getReviewSummary(productId);
    
    return ApiResponse.success(res, 200, 'Review summary retrieved successfully', summary);
  });

  /**
   * Get rating distribution
   */
  getRatingDistribution = catchAsync(async (req, res) => {
    const { productId } = req.params;
    
    const distribution = await ReviewService.getRatingDistribution(productId);
    
    return ApiResponse.success(res, 200, 'Rating distribution retrieved successfully', distribution);
  });

  // ==================== ADMIN ROUTES ====================

  /**
   * Get pending reviews (admin)
   */
  getPendingReviews = catchAsync(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    
    const reviews = await ReviewService.getPendingReviews(parseInt(page), parseInt(limit));
    
    return ApiResponse.success(res, 200, 'Pending reviews retrieved successfully', reviews);
  });

  /**
   * Get flagged reviews (admin)
   */
  getFlaggedReviews = catchAsync(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    
    const reviews = await ReviewService.getFlaggedReviews(parseInt(page), parseInt(limit));
    
    return ApiResponse.success(res, 200, 'Flagged reviews retrieved successfully', reviews);
  });

  /**
   * Moderate review (admin)
   */
  moderateReview = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const review = await ReviewService.moderateReview(id, req.admin._id, req.body);
    
    return ApiResponse.success(res, 200, 'Review moderated successfully', { review });
  });

  /**
   * Get review analytics (admin)
   */
  getReviewAnalytics = catchAsync(async (req, res) => {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      throw new AppError('Start date and end date are required', 400);
    }

    const analytics = await ReviewService.getReviewAnalytics(startDate, endDate);
    
    return ApiResponse.success(res, 200, 'Review analytics retrieved successfully', analytics);
  });

  /**
   * Bulk moderate reviews (admin)
   */
  bulkModerateReviews = catchAsync(async (req, res) => {
    const { reviewIds, status, reason } = req.body;
    
    if (!reviewIds || !Array.isArray(reviewIds)) {
      throw new AppError('Review IDs must be an array', 400);
    }

    const results = {
      successful: [],
      failed: []
    };

    for (const reviewId of reviewIds) {
      try {
        await ReviewService.moderateReview(reviewId, req.admin._id, { status, reason });
        results.successful.push(reviewId);
      } catch (error) {
        results.failed.push({ id: reviewId, reason: error.message });
      }
    }

    return ApiResponse.success(res, 200, 'Bulk moderation completed', results);
  });
}

module.exports = new ReviewController();