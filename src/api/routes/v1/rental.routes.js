// const express = require('express');
// const router = express.Router();
// const rentalController = require('../../controllers/rental.controller');
// const { protect } = require('../../middlewares/auth.middleware');
// const { validate } = require('../../middlewares/validation.middleware');
// const { rentalValidations } = require('../../middlewares/validation.middleware');
// const {cacheRental,  invalidateCache } = require('../../middlewares/cache.middleware');
// const { restrictTo } = require('../../middlewares/permissions.middleware');

// // All rental routes require authentication
// router.use(protect);

// // ==================== USER ROUTES ====================

// // Get user's rentals
// router.get('/user/me', rentalController.getUserRentals);

// // Get rental statistics
// router.get('/stats', rentalController.getStats);

// // Get dashboard summary
// router.get('/dashboard/summary', rentalController.getDashboardSummary);

// // Check availability before creating
// router.get('/check-availability', rentalController.checkAvailability);

// // Create new rental
// router.post('/', 
//   validate(rentalValidations.createRental),
//   invalidateCache(['rentals:user:*']),
//   rentalController.createRental
// );

// // Get rental by ID
// router.get('/:id', cacheRental(), rentalController.getRental);

// // Get rental timeline
// router.get('/:id/timeline', rentalController.getTimeline);

// // Generate invoice
// router.get('/:id/invoice', rentalController.generateInvoice);

// // Download invoice PDF
// router.get('/:id/invoice/download', rentalController.downloadInvoice);

// // Cancel rental
// router.post('/:id/cancel', 
//   validate(rentalValidations.cancelRental),
//   invalidateCache(['rental:*', 'rentals:user:*']),
//   rentalController.cancelRental
// );

// // Extend rental
// router.post('/:id/extend', 
//   validate(rentalValidations.extendRental),
//   invalidateCache(['rental:*', 'rentals:user:*']),
//   rentalController.extendRental
// );

// // Initiate return
// router.post('/:id/return/initiate', 
//   validate(rentalValidations.initiateReturn),
//   invalidateCache(['rental:*', 'rentals:user:*', 'rentals:vendor:*']),
//   rentalController.initiateReturn
// );

// // ==================== VENDOR ROUTES ====================

// // Vendor specific routes
// router.use('/vendor', restrictTo('vendor'));

// // Get vendor's rentals
// router.get('/vendor/me', rentalController.getVendorRentals);

// // Confirm rental
// router.post('/vendor/:id/confirm', 
//   invalidateCache(['rental:*', 'rentals:vendor:*', 'rentals:user:*']),
//   rentalController.confirmRental
// );

// // Approve extension
// router.post('/vendor/:id/extension/approve', 
//   validate(rentalValidations.approveExtension),
//   invalidateCache(['rental:*', 'rentals:vendor:*', 'rentals:user:*']),
//   rentalController.approveExtension
// );

// // Mark as delivered
// router.post('/vendor/:id/deliver', 
//   validate(rentalValidations.markDelivered),
//   invalidateCache(['rental:*', 'rentals:vendor:*', 'rentals:user:*']),
//   rentalController.markAsDelivered
// );

// // Mark as active
// router.post('/vendor/:id/activate', 
//   invalidateCache(['rental:*', 'rentals:vendor:*', 'rentals:user:*']),
//   rentalController.markAsActive
// );

// // Complete return
// router.post('/vendor/:id/return/complete', 
//   validate(rentalValidations.completeReturn),
//   invalidateCache(['rental:*', 'rentals:vendor:*', 'rentals:user:*']),
//   rentalController.completeReturn
// );

// // ==================== ADMIN ROUTES ====================

// // Admin routes
// router.use('/admin', restrictTo('admin', 'super-admin'));

// // Get all rentals
// router.get('/admin/all', rentalController.getAllRentals);

// // Get overdue rentals
// router.get('/admin/overdue', rentalController.getOverdueRentals);

// // Force complete rental (admin only)
// router.post('/admin/:id/force-complete', 
//   validate(rentalValidations.forceComplete),
//   rentalController.forceCompleteRental
// );

// module.exports = router;




// rental.routes.js - Updated to support cart-based rental
const express = require('express');
const router = express.Router();
const rentalController = require('../../controllers/rental.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { rentalValidations } = require('../../middlewares/validation.middleware');
const { cacheRental, invalidateCache } = require('../../middlewares/cache.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');

// All rental routes require authentication
router.use(protect);

// ==================== USER ROUTES ====================

// Get user's rentals
router.get('/user/me', rentalController.getUserRentals);

// Get rental statistics
router.get('/stats', rentalController.getStats);

// Get dashboard summary
router.get('/dashboard/summary', rentalController.getDashboardSummary);

// Check availability before creating (for backward compatibility)
router.get('/check-availability', rentalController.checkAvailability);

// Create new rental from cart (NEW)
router.post('/from-cart', 
  validate(rentalValidations.createRentalFromCart),
  invalidateCache(['rentals:user:*']),
  rentalController.createRentalFromCart
);

// Create new rental (legacy, keep for backward compatibility)
router.post('/', 
  validate(rentalValidations.createRental),
  invalidateCache(['rentals:user:*']),
  rentalController.createRental
);

// Get rental by ID
router.get('/:id', cacheRental(), rentalController.getRental);

// Get rental timeline
router.get('/:id/timeline', rentalController.getTimeline);

// Generate invoice
router.get('/:id/invoice', rentalController.generateInvoice);

// Download invoice PDF
router.get('/:id/invoice/download', rentalController.downloadInvoice);

// Cancel rental
router.post('/:id/cancel', 
  validate(rentalValidations.cancelRental),
  invalidateCache(['rental:*', 'rentals:user:*']),
  rentalController.cancelRental
);

// Extend rental
router.post('/:id/extend', 
  validate(rentalValidations.extendRental),
  invalidateCache(['rental:*', 'rentals:user:*']),
  rentalController.extendRental
);

// Initiate return
router.post('/:id/return/initiate', 
  validate(rentalValidations.initiateReturn),
  invalidateCache(['rental:*', 'rentals:user:*', 'rentals:vendor:*']),
  rentalController.initiateReturn
);

// ==================== VENDOR ROUTES ====================

// Vendor specific routes
router.use('/vendor', restrictTo('vendor'));

// Get vendor's rentals
router.get('/vendor/me', rentalController.getVendorRentals);

// Confirm rental
router.post('/vendor/:id/confirm', 
  invalidateCache(['rental:*', 'rentals:vendor:*', 'rentals:user:*']),
  rentalController.confirmRental
);

// Approve extension
router.post('/vendor/:id/extension/approve', 
  validate(rentalValidations.approveExtension),
  invalidateCache(['rental:*', 'rentals:vendor:*', 'rentals:user:*']),
  rentalController.approveExtension
);

// Mark as delivered
router.post('/vendor/:id/deliver', 
  validate(rentalValidations.markDelivered),
  invalidateCache(['rental:*', 'rentals:vendor:*', 'rentals:user:*']),
  rentalController.markAsDelivered
);

// Mark as active
router.post('/vendor/:id/activate', 
  invalidateCache(['rental:*', 'rentals:vendor:*', 'rentals:user:*']),
  rentalController.markAsActive
);

// Complete return
router.post('/vendor/:id/return/complete', 
  validate(rentalValidations.completeReturn),
  invalidateCache(['rental:*', 'rentals:vendor:*', 'rentals:user:*']),
  rentalController.completeReturn
);

// ==================== ADMIN ROUTES ====================

// Admin routes
router.use('/admin', restrictTo('admin', 'super-admin'));

// Get all rentals
router.get('/admin/all', rentalController.getAllRentals);

// Get overdue rentals
router.get('/admin/overdue', rentalController.getOverdueRentals);

// Force complete rental (admin only)
router.post('/admin/:id/force-complete', 
  validate(rentalValidations.forceComplete),
  rentalController.forceCompleteRental
);

module.exports = router;