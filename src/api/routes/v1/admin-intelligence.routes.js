const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin-intelligence.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');

router.use(protect);
router.use(restrictTo('admin', 'super-admin'));

// Module 1 — Admin analytics dashboard
router.get('/overview', ctrl.getOverview);
router.get('/rentals/charts', ctrl.getRentalCharts);
router.get('/products/top', ctrl.getTopProducts);
router.get('/products/least', ctrl.getLeastProducts);
router.get('/customers/analytics', ctrl.getCustomerAnalytics);

// Module 2 — Coupon analytics (uses existing /discounts admin CRUD)
router.get('/coupons/analytics', ctrl.getCouponAnalytics);

// Module 3 — CRM
router.get('/crm/customers', ctrl.listCustomers);
router.get('/crm/customers/:userId', ctrl.getCustomer);
router.post('/crm/customers/:userId/email', ctrl.sendCustomerEmail);
router.post('/crm/email/bulk', ctrl.sendBulkEmail);

// Module 4 — Marketing automation
router.get('/workflows', ctrl.listWorkflows);
router.patch('/workflows/:slug/toggle', ctrl.toggleWorkflow);
router.put('/workflows/:slug', ctrl.updateWorkflow);
router.get('/email-templates', ctrl.listTemplates);
router.post('/email-templates', ctrl.createTemplate);
router.put('/email-templates/:id', ctrl.updateTemplate);
router.get('/campaigns', ctrl.listCampaigns);
router.post('/campaigns', ctrl.createCampaign);
router.post('/campaigns/:id/schedule', ctrl.scheduleCampaign);
router.post('/campaigns/:id/send', ctrl.sendCampaign);
router.get('/segments', ctrl.listSegments);
router.post('/segments', ctrl.createSegment);
router.put('/segments/:id', ctrl.updateSegment);

// Module 5 — Product intelligence
router.get('/product-intelligence', ctrl.getProductIntelligence);

// Module 6 — Behavior analytics (admin view)
router.get('/behavior/analytics', ctrl.getBehaviorAnalytics);

// Module 7 — Interest detection
router.get('/interests', ctrl.listInterests);

// Module 9 — Vendor performance
router.get('/vendors/performance', ctrl.getVendorPerformance);

// Module 11 — Operations dashboard
router.get('/operations', ctrl.getOperations);

// Module 12 — AI insights
router.get('/ai-insights', ctrl.getAiInsights);

module.exports = router;
