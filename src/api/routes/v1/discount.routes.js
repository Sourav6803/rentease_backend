const express = require('express');
const router = express.Router();
const discountController = require('../../controllers/discount.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { discountValidations } = require('../../middlewares/validation.middleware');
const { cacheDiscount, invalidateCache } = require('../../middlewares/cache.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');

// ==================== PUBLIC ROUTES ====================

// Validate discount (public, used during checkout)
router.post('/validate/:code', discountController.validateDiscount);

// Get publicly displayable discounts (storefront / product page)
router.get('/public', discountController.getPublicDiscounts);

// ==================== PROTECTED USER ROUTES ====================

// All routes below require authentication
router.use(protect);

// Get applicable discounts for current order
router.post('/applicable', discountController.getApplicableDiscounts);

// Apply discount to order
router.post('/apply/:code', 
  validate(discountValidations.applyDiscount),
  discountController.applyDiscount
);

// ==================== ADMIN ROUTES ====================

// Admin routes
router.use('/admin', restrictTo('admin', 'super-admin'));

// Get all discounts
router.get('/admin', discountController.getAllDiscounts);

// Get discount analytics
router.get('/admin/analytics', discountController.getDiscountAnalytics);

// Get discount statistics
router.get('/admin/stats', discountController.getDiscountStats);

// Get expiring discounts
router.get('/admin/expiring', discountController.checkExpiringDiscounts);

// Create discount
router.post('/admin', 
  validate(discountValidations.createDiscount),
  invalidateCache(['discounts:list:*']),
  discountController.createDiscount
);

// Bulk create discounts
router.post('/admin/bulk', 
  validate(discountValidations.bulkCreate),
  invalidateCache(['discounts:list:*']),
  discountController.bulkCreateDiscounts
);

// Export discounts
router.get('/admin/export', discountController.exportDiscounts);

// Import discounts
router.post('/admin/import', 
  validate(discountValidations.import),
  invalidateCache(['discounts:list:*']),
  discountController.importDiscounts
);

// Deactivate expired discounts
router.post('/admin/deactivate-expired', discountController.deactivateExpiredDiscounts);

// Get discount by ID
router.get('/admin/:identifier', cacheDiscount(), discountController.getDiscount);

// Get discount usage history
router.get('/admin/:id/usage', discountController.getDiscountUsage);

// Update discount
router.put('/admin/:id', 
  validate(discountValidations.updateDiscount),
  invalidateCache(['discount:*', 'discounts:list:*']),
  discountController.updateDiscount
);

// Toggle discount status
router.patch('/admin/:id/status', 
  validate(discountValidations.toggleStatus),
  invalidateCache(['discount:*', 'discounts:list:*']),
  discountController.toggleDiscountStatus
);

// Delete discount
router.delete('/admin/:id', 
  invalidateCache(['discount:*', 'discounts:list:*']),
  discountController.deleteDiscount
);

module.exports = router;