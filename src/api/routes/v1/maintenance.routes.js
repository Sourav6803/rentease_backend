const express = require('express');
const router = express.Router();
const maintenanceController = require('../../controllers/maintenance.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { maintenanceValidations } = require('../../middlewares/validation.middleware');
const { cacheMaintenance, invalidateCache } = require('../../middlewares/cache.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');

// All maintenance routes require authentication
router.use(protect);

// ==================== USER ROUTES ====================

// Get user's maintenance requests
router.get('/user/me', maintenanceController.getUserRequests);

// Get maintenance statistics
router.get('/stats', maintenanceController.getStats);

// Create maintenance request
router.post('/', 
  validate(maintenanceValidations.createRequest),
  invalidateCache(['maintenance:user:*', 'maintenance:stats:*']),
  maintenanceController.createRequest
);

// Get request by ID
router.get('/:id', cacheMaintenance(), maintenanceController.getRequest);

// Cancel request
router.post('/:id/cancel', 
  validate(maintenanceValidations.cancelRequest),
  invalidateCache(['maintenance:*', 'maintenance:user:*', 'maintenance:stats:*']),
  maintenanceController.cancelRequest
);

// Add feedback
router.post('/:id/feedback', 
  validate(maintenanceValidations.addFeedback),
  invalidateCache(['maintenance:*', 'maintenance:stats:*']),
  maintenanceController.addFeedback
);

// ==================== VENDOR ROUTES ====================

// Vendor routes
router.use('/vendor', restrictTo('vendor'));

// Get vendor's maintenance requests
router.get('/vendor/me', maintenanceController.getVendorRequests);

// Assign technician
router.post('/vendor/:id/assign', 
  validate(maintenanceValidations.assignTechnician),
  invalidateCache(['maintenance:*', 'maintenance:vendor:*', 'maintenance:stats:*']),
  maintenanceController.assignTechnician
);

// Schedule visit
router.post('/vendor/:id/schedule', 
  validate(maintenanceValidations.scheduleVisit),
  invalidateCache(['maintenance:*', 'maintenance:vendor:*']),
  maintenanceController.scheduleVisit
);

// Start work
router.post('/vendor/:id/start', 
  validate(maintenanceValidations.startWork),
  invalidateCache(['maintenance:*', 'maintenance:vendor:*']),
  maintenanceController.startWork
);

// Complete work
router.post('/vendor/:id/complete', 
  validate(maintenanceValidations.completeWork),
  invalidateCache(['maintenance:*', 'maintenance:vendor:*', 'maintenance:stats:*']),
  maintenanceController.completeWork
);

// Add parts required
router.post('/vendor/:id/parts', 
  validate(maintenanceValidations.addParts),
  maintenanceController.addPartsRequired
);

// Cancel request (vendor)
router.post('/vendor/:id/cancel', 
  validate(maintenanceValidations.cancelRequest),
  invalidateCache(['maintenance:*', 'maintenance:vendor:*', 'maintenance:stats:*']),
  maintenanceController.cancelRequest
);

// Generate report
router.get('/vendor/report/generate', maintenanceController.generateReport);

// Export report
router.get('/vendor/report/export', maintenanceController.exportReport);

// Get technician workload
router.get('/vendor/technician/:technicianId/workload', maintenanceController.getTechnicianWorkload);

// ==================== ADMIN ROUTES ====================

// Admin routes
router.use('/admin', restrictTo('admin', 'super-admin'));

// Get all requests
router.get('/admin/all', maintenanceController.getAllRequests);

// Get SLA breaches
router.get('/admin/sla-breaches', maintenanceController.getSLABreaches);

// Escalate request
router.post('/admin/:id/escalate', maintenanceController.escalateRequest);

// Get maintenance analytics
router.get('/admin/analytics', maintenanceController.getMaintenanceAnalytics);

module.exports = router;