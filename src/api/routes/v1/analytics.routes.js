const express = require('express');
const router = express.Router();
const analyticsController = require('../../controllers/analytics.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { cacheAnalytics } = require('../../middlewares/cache.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');

// All analytics routes require authentication and admin role
router.use(protect);
router.use(restrictTo('admin', 'super-admin'));

// Platform analytics
router.get('/platform',  analyticsController.getPlatformOverview);

// Dashboard summary
router.get('/dashboard',  analyticsController.getDashboardSummary);

// User analytics
router.get('/users',  analyticsController.getUserAnalytics);

// Vendor analytics
router.get('/vendors',  analyticsController.getVendorAnalytics);

// Product analytics
router.get('/products',  analyticsController.getProductAnalytics);

// Rental analytics
router.get('/rentals', analyticsController.getRentalAnalytics);

// Revenue analytics
router.get('/revenue',  analyticsController.getRevenueAnalytics);

// Inventory analytics
router.get('/inventory',  analyticsController.getInventoryAnalytics);

// Customer analytics
router.get('/customers',  analyticsController.getCustomerAnalytics);

// Performance metrics
router.get('/performance',  analyticsController.getPerformanceMetrics);

// Growth metrics
router.get('/growth',  analyticsController.getGrowthMetrics);

// Retention analytics
router.get('/retention',  analyticsController.getRetentionAnalytics);

// Conversion funnel
router.get('/funnel', cacheAnalytics('funnel'), analyticsController.getConversionFunnel);

// Export analytics
router.get('/export', analyticsController.exportAnalytics);

// Invalidate cache
router.post('/cache/invalidate', analyticsController.invalidateCache);

module.exports = router;