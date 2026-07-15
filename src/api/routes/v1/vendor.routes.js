const express = require('express');
const router = express.Router();
const vendorController = require('../../controllers/vendor.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { validate, productValidations } = require('../../middlewares/validation.middleware');
const { vendorValidations } = require('../../middlewares/validation.middleware');
const { cacheVendor, clearCache, invalidateCache } = require('../../middlewares/cache.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');
const { uploadVendorDocuments, uploadProductImages } = require('../../middlewares/upload.middleware');
const productController = require('../../controllers/product.controller');

// ==================== PUBLIC ROUTES ====================

// Get vendor by ID (public)
// router.get('/:vendorId', vendorController.getVendorById);

// Get top vendors
router.get('/top/rankings', vendorController.getTopVendors);

// Check vendor availability (public, used during rental creation)
router.post('/check-availability', vendorController.checkAvailability);

// ==================== PROTECTED VENDOR ROUTES ====================

// All routes below require authentication
router.use(protect);
router.use(restrictTo('vendor'));


// Upload product images
router.post(
  '/products/upload-images',
  uploadProductImages,
  vendorController.uploadProductImages
);

// Create Product
router.post('/products', 
  uploadProductImages,
  validate(productValidations.createProduct),
  invalidateCache(['list:vendor-products*', 'list:featured-products*']),
  productController.createProduct
);

// Check vendor registration status
// router.get('/register/status', 
  
//   authController.getVendorRegistrationStatus
// );

// Complete vendor profile (after approval)
router.put('/profile/complete',
  uploadVendorDocuments,
  validate(vendorValidations.completeProfile),
  vendorController.completeProfile
);

// Upload vendor documents
router.post('/documents',
  uploadVendorDocuments,
  vendorController.uploadDocuments
);

// Profile routes
router.get('/profile/me', cacheVendor(), vendorController.getProfile);
router.put('/profile', validate(vendorValidations.updateProfile), vendorController.updateProfile);
router.get('/dashboard', vendorController.getDashboard);
router.get('/stats', vendorController.getStats);

// Product routes
router.get('/products', vendorController.getProducts);

// Rental routes
router.get('/rentals', vendorController.getRentals);

// Analytics routes
router.get('/analytics', validate(vendorValidations.analytics), vendorController.getAnalytics);

// Bank details
router.put('/bank-details', validate(vendorValidations.bankDetails), vendorController.updateBankDetails);

// Subscription routes
router.get('/subscription', vendorController.getSubscription);
router.put('/subscription', validate(vendorValidations.updateSubscription), vendorController.updateSubscription);

// Payout routes
router.put('/payout-schedule', validate(vendorValidations.payoutSchedule), vendorController.updatePayoutSchedule);
router.get('/payouts', vendorController.getPayoutHistory);

// Settings routes
router.put('/business-hours', validate(vendorValidations.businessHours), vendorController.updateBusinessHours);
router.put('/notification-preferences', validate(vendorValidations.notificationPreferences), vendorController.updateNotificationPreferences);

// Review routes
router.get('/reviews', vendorController.getReviews);
router.post('/reviews/:reviewId/reply', validate(vendorValidations.replyToReview), vendorController.replyToReview);

// Analytics routes (vendor)
router.get('/analytics/overview', vendorController.getAnalyticsOverview);
router.get('/analytics/sales', vendorController.getSalesReport);
router.get('/analytics/products', vendorController.getProductPerformance);
router.get('/analytics/customers', vendorController.getCustomerInsights);

// ==================== ADMIN ROUTES ====================

// All admin routes
router.use(restrictTo('admin', 'super-admin'));

// Vendor verification
router.get('/admin/pending', vendorController.getPendingVerifications);
router.post('/admin/:vendorId/approve', validate(vendorValidations.approveVendor), vendorController.approveVendor);
router.post('/admin/:vendorId/reject', validate(vendorValidations.rejectVendor), vendorController.rejectVendor);

// Vendor management
router.post('/admin/:vendorId/suspend', validate(vendorValidations.suspendVendor), vendorController.suspendVendor);
router.post('/admin/:vendorId/reinstate', vendorController.reinstateVendor);

// List all vendors
router.get('/admin/all', vendorController.getAllVendors);

module.exports = router;