const express = require('express');
const router = express.Router();
const adminController = require('../../controllers/admin.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { adminValidations } = require('../../middlewares/validation.middleware');
const { uploadDocument } = require('../../middlewares/upload.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');
const adminAuthController = require('../../controllers/admin-auth.controller');
const adminVendorController = require('../../controllers/admin-vendor.controller');
// const { restrictTo } = require('../../middlewares/admin-auth.middleware');

// All admin routes require authentication and admin role
router.use(protect);
router.use(restrictTo('admin', 'super-admin'));

// ==================== DASHBOARD & ANALYTICS ====================

// Dashboard statistics
router.get('/dashboard/stats', adminController.getDashboardStats);

// Platform analytics
router.get('/analytics/platform', adminController.getPlatformAnalytics);

// Platform metrics
router.get('/metrics', adminController.getPlatformMetrics);

// Payment stats
router.get('/payments/stats', adminController.getPaymentStats);

// ==================== REPORTS ====================

// Generate report
router.get('/reports/generate', adminController.generateReport);

// Export data
router.get('/export/:type', adminController.exportData);

// Import data
router.post('/import', 
  uploadDocument.single('file'),
  adminController.importData
);

// ==================== SYSTEM MANAGEMENT ====================

// System logs
router.get('/system/logs', adminController.getSystemLogs);

// System health
router.get('/system/health', adminController.getSystemHealth);

// System settings
router.get('/system/settings', adminController.getSystemSettings);
router.put('/system/settings', adminController.updateSystemSettings);

// Cache management
router.delete('/system/cache', adminController.clearCache);

// Maintenance tasks
router.post('/system/maintenance', adminController.runMaintenance);

// ==================== AUDIT & ACTIVITY ====================

// Audit trail
router.get('/audit/:resourceType/:resourceId', adminController.getAuditTrail);

// User activity timeline
router.get('/activity/user/:userId', adminController.getUserActivityTimeline);

// ==================== TESTING ====================

// Test email
router.post('/test/email', adminController.testEmailConfig);

// Test SMS
router.post('/test/sms', adminController.testSMSConfig);

// ==================== ADMIN MANAGEMENT ====================

// Change password
router.post('/change-password',
  validate(adminValidations.changePassword),
  adminAuthController.changePassword
);

// Get all admins
router.get('/', adminController.getAdmins);
router.get('/admins', adminController.getAdmins);
router.get('/admins/stats', adminController.getAdminStats);

// Get admin by ID
router.get('/:id', adminController.getAdminById);
router.delete('/admins/:id', adminController.deleteAdmin);

// Update admin
router.put('/:id', 
  validate(adminValidations.updateAdmin),
  adminController.updateAdmin
);

// Delete admin
router.delete('/:id', adminController.deleteAdmin);

// Get admin activity
router.get('/:id/activity', adminController.getAdminActivity);

module.exports = router;