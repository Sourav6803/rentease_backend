const express = require('express');
const router = express.Router();
const reviewController = require('../../controllers/review.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { reviewValidations } = require('../../middlewares/validation.middleware');
const { cacheReview, invalidateCache } = require('../../middlewares/cache.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');

// ==================== PUBLIC ROUTES ====================

// Get product reviews (public)
router.get('/product/:productId', reviewController.getProductReviews);

// Get vendor reviews (public)
router.get('/vendor/:vendorId', reviewController.getVendorReviews);

// Get review summary (public)
router.get('/product/:productId/summary', reviewController.getReviewSummary);

// Get rating distribution (public)
router.get('/product/:productId/distribution', reviewController.getRatingDistribution);

// Get review by ID (public - only approved)
router.get('/:id', cacheReview(), reviewController.getReview);

// ==================== PROTECTED USER ROUTES ====================

// All routes below require authentication
router.use(protect);

// Get user's reviews
router.get('/user/me', reviewController.getUserReviews);

// Create review
router.post('/', 
  validate(reviewValidations.createReview),
  invalidateCache(['reviews:product:*', 'reviews:vendor:*', 'product:*:ratings']),
  reviewController.createReview
);

// Update review
router.put('/:id', 
  validate(reviewValidations.updateReview),
  invalidateCache(['review:*', 'reviews:product:*', 'product:*:ratings']),
  reviewController.updateReview
);

// Delete review
router.delete('/:id', 
  invalidateCache(['review:*', 'reviews:product:*', 'product:*:ratings']),
  reviewController.deleteReview
);

// Mark review as helpful
router.post('/:id/helpful', reviewController.markHelpful);

// Report review
router.post('/:id/report', 
  validate(reviewValidations.reportReview),
  reviewController.reportReview
);

// ==================== VENDOR ROUTES ====================

// Vendor response to review
router.post('/:id/respond', 
  restrictTo('vendor'),
  validate(reviewValidations.addResponse),
  invalidateCache(['review:*', 'reviews:product:*']),
  reviewController.addResponse
);

// ==================== ADMIN ROUTES ====================

// Admin routes
router.use('/admin', restrictTo('admin', 'super-admin'));

// Get pending reviews
router.get('/admin/pending', reviewController.getPendingReviews);

// Get flagged reviews
router.get('/admin/flagged', reviewController.getFlaggedReviews);

// Moderate review
router.post('/admin/:id/moderate', 
  validate(reviewValidations.moderateReview),
  invalidateCache(['review:*', 'reviews:product:*', 'product:*:ratings']),
  reviewController.moderateReview
);

// Bulk moderate reviews
router.post('/admin/bulk/moderate', 
  validate(reviewValidations.bulkModerate),
  reviewController.bulkModerateReviews
);

// Get review analytics
router.get('/admin/analytics', reviewController.getReviewAnalytics);

module.exports = router;