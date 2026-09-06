const express = require('express');
const router = express.Router();
const reviewController = require('../../controllers/review.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { reviewValidations } = require('../../middlewares/validation.middleware');
const { cacheReview, invalidateCache } = require('../../middlewares/cache.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');
const { uploadReviewMedia } = require('../../middlewares/upload.middleware');

// ==================== PUBLIC ROUTES ====================

// Get product reviews (public)
router.get('/product/:productId', reviewController.getProductReviews);

// Get vendor reviews (public)
router.get('/vendor/:vendorId', reviewController.getVendorReviews);

// Get review summary (public)
router.get('/product/:productId/summary', reviewController.getReviewSummary);

// Get rating distribution (public)
router.get('/product/:productId/distribution', reviewController.getRatingDistribution);

// Admin list/analytics routes must be registered before /admin/:id.
router.get('/admin/pending', protect, restrictTo('admin', 'super-admin'), reviewController.getPendingReviews);
router.get('/admin/flagged', protect, restrictTo('admin', 'super-admin'), reviewController.getFlaggedReviews);
router.get('/admin/analytics', protect, restrictTo('admin', 'super-admin'), reviewController.getReviewAnalytics);

// Get any review for the admin moderation drawer, including pending reviews.
router.get('/admin/:id', protect, restrictTo('admin', 'super-admin'), reviewController.getReview);

// Get review by ID (public - only approved)
router.get('/:id', cacheReview(), reviewController.getReview);

// ==================== PROTECTED USER ROUTES ====================

// All routes below require authentication
router.use(protect);

// Get user's reviews
router.get('/user/me', reviewController.getUserReviews);

// Create review
router.post('/', 
  uploadReviewMedia,
  validate(reviewValidations.createReview),
  invalidateCache(['reviews:product:*', 'reviews:vendor:*', 'product:*:ratings']),
  reviewController.createReview
);

// Update review
router.put('/:id', 
  uploadReviewMedia,
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

module.exports = router;