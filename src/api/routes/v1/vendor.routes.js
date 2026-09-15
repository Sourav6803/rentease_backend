const express = require('express');
const router = express.Router();
const vendorController = require('../../controllers/vendor.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { validate, productValidations } = require('../../middlewares/validation.middleware');
const { vendorValidations } = require('../../middlewares/validation.middleware');
const { invalidateCache } = require('../../middlewares/cache.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');
const { uploadVendorDocuments, uploadProductImages, uploadVendorMedia, uploadProfilePicture } = require('../../middlewares/upload.middleware');
const productController = require('../../controllers/product.controller');
const userController = require('../../controllers/user.controller');
const AppError = require('../../../utils/AppError');

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

// `restrictTo('vendor')` only inspects the JWT role. A user whose role is
// 'vendor' but who has no Vendor profile row passes that check while `protect`
// leaves `req.vendor` undefined — and every handler below dereferences
// `req.vendor._id`, producing a 500 (TypeError). Fail fast and cleanly instead.
router.use((req, res, next) => {
  if (!req.vendor) {
    return next(new AppError('Vendor profile not found for this account.', 403));
  }
  next();
});


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

// Update product
router.put('/products/:id', 
  uploadProductImages,
  validate(productValidations.updateProduct),
  invalidateCache(['product:*', 'list:vendor-products*', 'list:featured-products*']),
  productController.updateProduct
);

// Delete product
router.delete('/products/:id', 
  invalidateCache(['product:*', 'list:vendor-products*', 'list:featured-products*']),
  productController.deleteProduct
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
router.get('/profile/me',  vendorController.getProfile);
router.put('/profile', validate(vendorValidations.updateProfile), vendorController.updateProfile);
router.post('/profile/avatar', uploadProfilePicture, userController.uploadAvatar);
router.delete('/profile/avatar', userController.deleteAvatar);

// Vendor media uploads
router.post('/profile/upload-logo', uploadVendorMedia, vendorController.uploadLogo);
router.post('/profile/upload-banner', uploadVendorMedia, vendorController.uploadBanner);
router.post('/profile/upload-gallery', uploadVendorMedia, vendorController.uploadGallery);
router.delete('/profile/gallery/:publicId', vendorController.removeGalleryImage);

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

// Invoice routes. Invoices are generated per rental
// (RentalService.generateInvoice), so these are backed by the vendor's rentals.
// The invoices page has always called exactly these two paths — the routes simply
// never existed, so every request 404'd. `:id` is a rental id.
router.get('/invoices', vendorController.getInvoices);
router.get('/invoices/:id/download', vendorController.downloadInvoice);

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

// Customer directory. These are the only `/:param`-free paths the router needs,
// so no earlier route can shadow them (`/:vendorId` is commented out above).
// `req.vendor` is populated by the vendor gate, and the service scopes every
// query by req.vendor._id.
router.get('/customers', vendorController.getCustomers);
router.get('/customers/:customerId', vendorController.getCustomerDetail);

// ==================== ADMIN ROUTES ====================
// REMOVED: this router is entirely vendor-scoped — `router.use(protect)` +
// `router.use(restrictTo('vendor'))` run for every path below, so the old
// `/vendor/admin/*` handlers could never execute:
//   * a vendor passed the vendor gate but was rejected by restrictTo('admin', 'super-admin')
//   * an admin was rejected by the vendor gate before ever reaching it
// The live admin vendor API is mounted at `/api/v1/admin/vendors`
// (see routes/v1/admin-vendor.routes.js) and that is what the admin UI calls.

module.exports = router;