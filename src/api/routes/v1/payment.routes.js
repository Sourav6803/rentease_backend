const express = require('express');
const router = express.Router();
const paymentController = require('../../controllers/payment.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { paymentValidations } = require('../../middlewares/validation.middleware');
const { cachePayment, invalidateCache } = require('../../middlewares/cache.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');

// All payment routes require authentication
router.use(protect);

// ==================== USER ROUTES ====================

// Get user's payments
router.get('/user/me', paymentController.getUserPayments);

// Get payment statistics
router.get('/stats', paymentController.getPaymentStats);

// Get payment methods
router.get('/methods', paymentController.getPaymentMethods);

// Add payment method
router.post('/methods', 
  validate(paymentValidations.addPaymentMethod),
  paymentController.addPaymentMethod
);

// Remove payment method
router.delete('/methods/:methodId', paymentController.removePaymentMethod);

// Set default payment method
router.patch('/methods/:methodId/default', paymentController.setDefaultPaymentMethod);

// Initiate payment
router.post('/initiate', 
  validate(paymentValidations.initiatePayment),
  paymentController.initiatePayment
);

// Verify payment
router.post('/:paymentId/verify', 
  validate(paymentValidations.verifyPayment),
  paymentController.verifyPayment
);

// Get payment by ID
router.get('/:id', cachePayment(), paymentController.getPayment);

// Generate receipt
router.get('/:id/receipt', paymentController.generateReceipt);

// Download receipt
router.get('/:id/receipt/download', paymentController.downloadReceipt);

// ==================== VENDOR ROUTES ====================

// Vendor payment routes
router.get('/vendor/me', restrictTo('vendor'), paymentController.getVendorPayments);

// ==================== ADMIN ROUTES ====================

// Admin routes
router.use('/admin', restrictTo('admin', 'super-admin'));

// Get all payments
router.get('/admin/all', paymentController.getAllPayments);

// Get payment analytics
router.get('/admin/analytics', paymentController.getPaymentAnalytics);

// Process refund
router.post('/admin/:id/refund', 
  validate(paymentValidations.processRefund),
  invalidateCache(['payment:*', 'payments:user:*', 'payments:vendor:*']),
  paymentController.processRefund
);

// Trigger monthly payments
router.post('/admin/trigger-monthly', paymentController.triggerMonthlyPayments);

module.exports = router;