// const express = require('express');
// const router = express.Router();
// const deliveryController = require('../../controllers/delivery.controller');
// const { protect } = require('../../middlewares/auth.middleware');
// const { validate } = require('../../middlewares/validation.middleware');
// const { deliveryValidations } = require('../../middlewares/validation.middleware');
// const { cacheDelivery, invalidateCache } = require('../../middlewares/cache.middleware');
// const { restrictTo } = require('../../middlewares/permissions.middleware');

// // ==================== PUBLIC ROUTES ====================

// // Track delivery (public)
// router.get('/track/:trackingNumber', deliveryController.trackDelivery);

// // Get available time slots (public)
// router.get('/slots/available', deliveryController.getAvailableTimeSlots);

// // ==================== PROTECTED USER ROUTES ====================

// // All routes below require authentication
// router.use(protect);

// // Get user deliveries
// router.get('/user/me', deliveryController.getUserDeliveries);

// // Get delivery by ID
// router.get('/:id', cacheDelivery(), deliveryController.getDelivery);

// // ==================== VENDOR ROUTES ====================

// // Vendor routes
// router.use('/vendor', restrictTo('vendor'));

// // Get vendor deliveries
// router.get('/vendor/me', deliveryController.getVendorDeliveries);

// // Get delivery summary
// router.get('/vendor/summary', deliveryController.getDeliverySummary);

// // Get delivery analytics
// router.get('/vendor/analytics', deliveryController.getDeliveryAnalytics);

// // Create delivery
// router.post('/rental/:rentalId', 
//   validate(deliveryValidations.createDelivery),
//   invalidateCache(['deliveries:vendor:*', 'delivery:tracking:*']),
//   deliveryController.createDelivery
// );

// // Assign delivery person
// router.post('/:id/assign', 
//   validate(deliveryValidations.assignDelivery),
//   invalidateCache(['delivery:*', 'deliveries:vendor:*']),
//   deliveryController.assignDeliveryPerson
// );

// // Reschedule delivery
// router.post('/:id/reschedule', 
//   validate(deliveryValidations.reschedule),
//   invalidateCache(['delivery:*', 'deliveries:vendor:*', 'delivery:tracking:*']),
//   deliveryController.rescheduleDelivery
// );

// // Get delivery person performance
// router.get('/performance/person/:personId', deliveryController.getDeliveryPersonPerformance);

// // ==================== DELIVERY PERSON ROUTES ====================

// // Start delivery
// router.post('/:id/start', 
//   validate(deliveryValidations.startDelivery),
//   invalidateCache(['delivery:*', 'delivery:tracking:*']),
//   deliveryController.startDelivery
// );

// // Update location
// router.post('/:id/location', 
//   validate(deliveryValidations.updateLocation),
//   deliveryController.updateLocation
// );

// // Mark as delivered
// router.post('/:id/deliver', 
//   validate(deliveryValidations.markDelivered),
//   invalidateCache(['delivery:*', 'deliveries:vendor:*', 'delivery:tracking:*']),
//   deliveryController.markAsDelivered
// );

// // Mark as failed
// router.post('/:id/fail', 
//   validate(deliveryValidations.markFailed),
//   invalidateCache(['delivery:*', 'deliveries:vendor:*', 'delivery:tracking:*']),
//   deliveryController.markAsFailed
// );

// // ==================== ADMIN ROUTES ====================

// // Admin routes
// router.use('/admin', restrictTo('admin', 'super-admin'));

// // Get all deliveries
// router.get('/admin/all', deliveryController.getAllDeliveries);

// // Get global delivery analytics
// router.get('/admin/analytics', deliveryController.getGlobalDeliveryAnalytics);

// module.exports = router;



// src/api/routes/v1/delivery.routes.js
const express = require('express');
const router = express.Router();
const deliveryController = require('../../controllers/delivery.controller');
const deliveryAIController = require('../../controllers/delivery-ai.controller');
const dispatchController = require('../../controllers/dispatch.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { protectAdmin } = require('../../middlewares/admin-auth.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { body, param, query } = require('express-validator');
// const upload = require('../../middlewares/upload.middleware');
const upload = require('../../middlewares/upload.middleware').uploadDelivery;
const { cacheDelivery, invalidateCache } = require('../../middlewares/cache.middleware');

// ==================== PUBLIC ROUTES ====================

// Track delivery (public)
router.get('/track/:trackingNumber', 
  [param('trackingNumber').isString()], 
  deliveryController.trackDelivery
);

// Get available time slots (public)
router.get('/slots/available', 
  [
    query('date').optional().isISO8601(),
    query('pincode').optional().isString()
  ], 
  deliveryController.getAvailableTimeSlots
);

// Calculate delivery charges
router.post('/calculate-charges',
  [
    body('pincode').isString(),
    body('weight').optional().isFloat(),
    body('distance').optional().isFloat()
  ],
  deliveryController.calculateDeliveryCharges
);

// Get public tracking info
router.get('/public/track/:trackingNumber',
  [param('trackingNumber').isString()],
  deliveryController.getPublicTrackingInfo
);

// ==================== DELIVERY PERSON AUTH ROUTES ====================

// Delivery person login (email or phone + password)
router.post('/auth/login',
  [
    body('email').optional().isEmail().withMessage('Valid email required'),
    body('phone')
      .optional()
      .matches(/^[6-9]\d{9}$/)
      .withMessage('Valid Indian phone number required'),
    body('password').notEmpty().withMessage('Password required'),
    body().custom((value) => {
      if (!value.email && !value.phone) {
        throw new Error('Email or phone is required');
      }
      return true;
    }),
  ],
  deliveryController.deliveryPersonLogin
);

// Delivery person logout
router.post('/auth/logout', protect, deliveryController.deliveryPersonLogout);

// Refresh token
router.post('/auth/refresh-token', deliveryController.refreshDeliveryToken);

// Forgot password
router.post('/auth/forgot-password',
  [body('email').isEmail()],
  deliveryController.deliveryForgotPassword
);

// Reset password
router.post('/auth/reset-password',
  [
    body('token').notEmpty(),
    body('password').isLength({ min: 6 })
  ],
  deliveryController.deliveryResetPassword
);

// ==================== DELIVERY PERSON SELF MANAGEMENT ====================

// All routes below require authentication
router.use(protect);

// Get own profile
router.get('/profile', deliveryController.getDeliveryProfile);

// Update own profile
router.put('/profile',
  [
    body('phone').optional().isMobilePhone(),
    body('vehicle.number').optional().isString(),
    body('vehicle.model').optional().isString()
  ],
  deliveryController.updateDeliveryProfile
);

// Update availability status
router.put('/availability',
  [
    body('isAvailable').optional().isBoolean(),
    body('isOnDuty').optional().isBoolean()
  ],
  deliveryController.updateAvailability
);

// Update current location with history
router.put('/location',
  [
    body('lat').isFloat({ min: -90, max: 90 }),
    body('lng').isFloat({ min: -180, max: 180 }),
    body('speed').optional().isFloat(),
    body('battery').optional().isInt({ min: 0, max: 100 }),
    body('accuracy').optional().isFloat()
  ],
  deliveryController.updatePartnerLocation
);

// Get location history
router.get('/location/history',
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('limit').optional().isInt({ min: 1, max: 500 })
  ],
  deliveryController.getLocationHistory
);

// Get personal statistics
router.get('/stats', deliveryController.getDeliveryStats);

// Get earnings breakdown
router.get('/earnings',
  [
    query('period').optional().isIn(['week', 'month', 'year']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601()
  ],
  deliveryController.getEarningsBreakdown
);

// Get partner performance metrics
router.get('/performance',
  [
    query('period').optional().isIn(['week', 'month', 'quarter', 'year'])
  ],
  deliveryController.getPartnerPerformance
);

// Recent activity feed
router.get('/activity',
  [
    query('limit').optional().isInt({ min: 1, max: 50 })
  ],
  deliveryController.getDeliveryActivity
);

// ==================== DELIVERY OPERATIONS ====================

// Get today's deliveries
router.get('/today', deliveryController.getTodaysDeliveries);

// Get active deliveries
router.get('/active', deliveryController.getActiveDeliveries);

// Composite navigate payload (map + stops + optimized order)
router.get('/navigate', deliveryController.getNavigateData);

// Live route calculation between points
router.post('/route/calculate',
  [
    body('origin').isObject(),
    body('origin.lat').isFloat({ min: -90, max: 90 }),
    body('origin.lng').isFloat({ min: -180, max: 180 }),
    body('destination').isObject(),
    body('destination.lat').isFloat({ min: -90, max: 90 }),
    body('destination.lng').isFloat({ min: -180, max: 180 }),
    body('waypoints').optional().isArray(),
  ],
  deliveryController.calculateDeliveryRoute
);

// Partner-facing multi-stop route optimization
router.post('/route/optimize',
  [
    body('deliveryIds').optional().isArray(),
    body('deliveryIds.*').optional().isMongoId(),
  ],
  deliveryController.optimizePartnerRoute
);

// Get delivery history
router.get('/history',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isString()
  ],
  deliveryController.getDeliveryHistory
);

// Get delivery by ID
router.get('/:deliveryId',
  [param('deliveryId').isMongoId()],
  cacheDelivery(),
  deliveryController.getDeliveryById
);

// Start delivery
router.post('/:deliveryId/start',
  [
    param('deliveryId').isMongoId(),
    body('location').optional().isObject()
  ],
  invalidateCache(['delivery:*', 'deliveries:user:*']),
  deliveryController.startDelivery
);

// Update delivery progress
router.put('/:deliveryId/progress',
  [
    param('deliveryId').isMongoId(),
    body('status').isIn(['in_transit', 'reached_location']),
    body('location').optional().isObject(),
    body('notes').optional().isString()
  ],
  deliveryController.updateDeliveryProgress
);

// Mark as delivered with proof
router.post('/:deliveryId/complete',
  [
    param('deliveryId').isMongoId(),
    upload.fields([
      { name: 'signature', maxCount: 1 },
      { name: 'photos', maxCount: 10 }
    ]),
    body('recipientName').notEmpty(),
    body('recipientPhone').optional().isMobilePhone(),
    body('otp').optional().isString(),
    body('notes').optional().isString()
  ],
  invalidateCache(['delivery:*', 'deliveries:user:*', 'delivery:tracking:*']),
  deliveryController.completeDelivery
);

// Mark as failed
router.post('/:deliveryId/fail',
  [
    param('deliveryId').isMongoId(),
    body('reason').notEmpty(),
    body('notes').optional().isString(),
    body('reschedule').optional().isBoolean()
  ],
  invalidateCache(['delivery:*', 'deliveries:user:*']),
  deliveryController.failDelivery
);

// Report issue
router.post('/:deliveryId/report-issue',
  [
    param('deliveryId').isMongoId(),
    body('issueType').isIn(['wrong_address', 'customer_not_available', 'damaged_item', 'missing_item', 'other']),
    body('description').notEmpty(),
    body('photos').optional().isArray()
  ],
  deliveryController.reportDeliveryIssue
);

// Reschedule delivery
router.post('/:deliveryId/reschedule',
  [
    param('deliveryId').isMongoId(),
    body('newDate').isISO8601(),
    body('newSlot').optional().isString(),
    body('reason').notEmpty()
  ],
  invalidateCache(['delivery:*', 'delivery:tracking:*']),
  deliveryController.rescheduleDelivery
);

// ==================== OTP VERIFICATION ROUTES ====================

// Generate OTP for delivery
router.post('/:deliveryId/generate-otp',
  [param('deliveryId').isMongoId()],
  deliveryController.generateDeliveryOTP
);

// Verify OTP
router.post('/:deliveryId/verify-otp',
  [
    param('deliveryId').isMongoId(),
    body('otp').isString().isLength({ min: 4, max: 6 })
  ],
  deliveryController.verifyDeliveryOTP
);

// Resend OTP
router.post('/:deliveryId/resend-otp',
  [param('deliveryId').isMongoId()],
  deliveryController.resendDeliveryOTP
);

// ==================== PROOF OF DELIVERY ROUTES ====================

// Upload signature
router.post('/:deliveryId/signature',
  [
    param('deliveryId').isMongoId(),
    upload.single('signature')
  ],
  deliveryController.uploadSignature
);

// Upload photos
router.post('/:deliveryId/photos',
  [
    param('deliveryId').isMongoId(),
    upload.array('photos', 10)
  ],
  deliveryController.uploadDeliveryPhotos
);

// Add delivery notes
router.post('/:deliveryId/notes',
  [
    param('deliveryId').isMongoId(),
    body('notes').notEmpty()
  ],
  deliveryController.addDeliveryNotes
);

// Get delivery proof (admin only)
router.get('/:deliveryId/proof',
  protectAdmin,
  [param('deliveryId').isMongoId()],
  deliveryController.getDeliveryProof
);

// Generate delivery report (admin only)
router.get('/:deliveryId/report',
  protectAdmin,
  [param('deliveryId').isMongoId()],
  deliveryController.generateDeliveryReport
);

// ==================== VENDOR ROUTES ====================

router.use('/vendor', restrictTo('vendor'));

// Get vendor deliveries
router.get('/vendor/me', deliveryController.getVendorDeliveries);

// Get delivery summary
router.get('/vendor/summary', deliveryController.getDeliverySummary);

// Get delivery analytics
router.get('/vendor/analytics', deliveryController.getDeliveryAnalytics);

// Create delivery
router.post('/rental/:rentalId',
  [param('rentalId').isMongoId()],
  invalidateCache(['deliveries:vendor:*', 'delivery:tracking:*']),
  deliveryController.createDelivery
);

// Assign delivery person (vendor)
router.post('/vendor/:id/assign',
  [param('id').isMongoId()],
  invalidateCache(['delivery:*', 'deliveries:vendor:*']),
  deliveryController.assignDeliveryPerson
);

// Reschedule delivery (vendor)
router.post('/vendor/:id/reschedule',
  [
    param('id').isMongoId(),
    body('newDate').isISO8601(),
    body('newSlot').optional().isString(),
    body('reason').notEmpty()
  ],
  invalidateCache(['delivery:*', 'deliveries:vendor:*']),
  deliveryController.rescheduleDelivery
);

// Get delivery person performance
router.get('/performance/person/:personId',
  [param('personId').isMongoId()],
  deliveryController.getDeliveryPersonPerformance
);

// ==================== DELIVERY PERSON ROUTES (Vendor assigned) ====================

// Start delivery (delivery person)
router.post('/delivery/:id/start',
  [param('id').isMongoId()],
  invalidateCache(['delivery:*']),
  deliveryController.startDelivery
);

// Update location (delivery person)
router.post('/delivery/:id/location',
  [
    param('id').isMongoId(),
    body('lat').isFloat({ min: -90, max: 90 }),
    body('lng').isFloat({ min: -180, max: 180 })
  ],
  deliveryController.updateLocation
);

// Mark as delivered (delivery person)
router.post('/delivery/:id/deliver',
  [
    param('id').isMongoId(),
    upload.fields([
      { name: 'signature', maxCount: 1 },
      { name: 'photos', maxCount: 10 }
    ]),
    body('otp').optional().isString()
  ],
  invalidateCache(['delivery:*', 'deliveries:vendor:*']),
  deliveryController.markAsDelivered
);

// Mark as failed (delivery person)
router.post('/delivery/:id/fail',
  [
    param('id').isMongoId(),
    body('reason').notEmpty()
  ],
  invalidateCache(['delivery:*', 'deliveries:vendor:*']),
  deliveryController.markAsFailed
);

// ==================== ADMIN ROUTES ====================

router.use('/admin', protectAdmin, restrictTo('admin', 'super-admin'));

// Get all deliveries
router.get('/admin/all', deliveryController.getAllDeliveries);

// Get global delivery analytics
router.get('/admin/analytics', deliveryController.getGlobalDeliveryAnalytics);

// Get delivery analytics dashboard
router.get('/admin/analytics/dashboard',
  [
    query('period').optional().isIn(['week', 'month', 'quarter', 'year']),
    query('zone').optional().isString(),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601()
  ],
  deliveryController.getAnalyticsDashboard
);

// Get delivery performance metrics
router.get('/admin/analytics/performance',
  [
    query('period').optional().isIn(['week', 'month', 'quarter']),
    query('personId').optional().isMongoId(),
    query('teamId').optional().isMongoId()
  ],
  deliveryController.getPerformanceMetrics
);

// Get zone performance
router.get('/admin/analytics/zones',
  [
    query('period').optional().isIn(['week', 'month', 'quarter']),
    query('zone').optional().isString()
  ],
  deliveryController.getZonePerformance
);

// Get delivery heatmap data
router.get('/admin/analytics/heatmap',
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('zone').optional().isString()
  ],
  deliveryController.getDeliveryHeatmap
);

// Get peak hours analysis
router.get('/admin/analytics/peak-hours',
  [
    query('period').optional().isIn(['week', 'month']),
    query('zone').optional().isString()
  ],
  deliveryController.getPeakHoursAnalysis
);

// Export delivery report
router.get('/admin/analytics/export',
  [
    query('type').isIn(['deliveries', 'personnel', 'teams', 'performance']),
    query('format').optional().isIn(['csv', 'excel', 'pdf']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('period').optional().isIn(['week', 'month', 'quarter', 'year'])
  ],
  deliveryController.exportDeliveryReport
);

// Get all scheduled deliveries (admin assignment board)
router.get('/admin/deliveries/scheduled',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn(['scheduled', 'batched', 'assigned', 'rescheduled', 'all', 'pending_assignment']),
    query('unassignedOnly').optional().isBoolean(),
    query('includeSuggestions').optional().isBoolean(),
    query('useDispatchPool').optional().isBoolean(),
    query('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
    query('type').optional().isIn(['delivery', 'pickup', 'exchange', 'return', 'maintenance']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('vendorId').optional().isMongoId(),
    query('pincode').optional().isString()
  ],
  deliveryController.getScheduledDeliveries
);

// ==================== DISPATCH (batch + pool) ====================

router.get('/admin/dispatch/pool',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('includeSuggestions').optional().isBoolean(),
    query('pincode').optional().isString(),
    query('vendorId').optional().isMongoId(),
    query('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  dispatchController.getPool
);

router.get('/admin/dispatch/suggestions/:deliveryId',
  [param('deliveryId').isMongoId()],
  dispatchController.getSuggestions
);

router.post('/admin/dispatch/batches',
  [
    body('deliveryIds').isArray({ min: 1 }),
    body('deliveryIds.*').isMongoId(),
    body('zone').optional().isString(),
    body('notes').optional().isString(),
  ],
  dispatchController.createBatch
);

router.get('/admin/dispatch/batches',
  [
    query('page').optional().isInt({ min: 1 }),
    query('status').optional().isIn(['open', 'locked', 'assigned', 'in_progress', 'completed', 'cancelled']),
    query('date').optional().isISO8601(),
  ],
  dispatchController.listBatches
);

router.post('/admin/dispatch/batches/:batchId/assign',
  [
    param('batchId').isMongoId(),
    body('personId').isMongoId(),
    body('type').optional().isIn(['person', 'team']),
    body('force').optional().isBoolean(),
    body('notes').optional().isString(),
  ],
  dispatchController.assignBatch
);

router.post('/admin/dispatch/batches/:batchId/cancel',
  [param('batchId').isMongoId()],
  dispatchController.cancelBatch
);

router.post('/admin/dispatch/assign/:deliveryId',
  [
    param('deliveryId').isMongoId(),
    body('type').isIn(['person', 'team']),
    body('personId').optional().isMongoId(),
    body('teamId').optional().isMongoId(),
    body('force').optional().isBoolean(),
    body('notes').optional().isString(),
  ],
  dispatchController.assignSingle
);

router.post('/admin/dispatch/optimize-route',
  [
    body('personId').isMongoId(),
    body('deliveryIds').isArray({ min: 1 }),
    body('deliveryIds.*').isMongoId(),
  ],
  dispatchController.optimizeBatchRoute
);

// Get pending deliveries for assignment
router.get('/admin/assignments/pending',
  [
    query('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
    query('pincode').optional().isString(),
    query('includeSuggestions').optional().isBoolean(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 })
  ],
  deliveryController.getPendingAssignments
);

// Get available delivery persons
router.get('/admin/assignments/available',
  [
    query('pincode').optional().isString(),
    query('deliveryId').optional().isMongoId(),
    query('limit').optional().isInt({ min: 1, max: 50 })
  ],
  deliveryController.getAvailablePersonnel
);

// Assign delivery manually
router.post('/admin/assignments/:deliveryId/assign',
  [
    param('deliveryId').isMongoId(),
    body('type').isIn(['person', 'team']),
    body('personId').custom((value, { req }) => {
      if (req.body.type === 'person' && !value) throw new Error('Person ID required');
      return true;
    }),
    body('teamId').custom((value, { req }) => {
      if (req.body.type === 'team' && !value) throw new Error('Team ID required');
      return true;
    }),
    body('notes').optional().isString()
  ],
  deliveryController.assignDelivery
);

// Bulk assign deliveries
router.post('/admin/assignments/bulk',
  [
    body('assignments').isArray(),
    body('assignments.*.deliveryId').isMongoId(),
    body('assignments.*.personId').isMongoId()
  ],
  deliveryController.bulkAssignDeliveries
);

// ==================== AI ASSIGNMENT ROUTES ====================

// Auto-assign delivery (AI powered)
router.post('/admin/ai/auto-assign/:deliveryId',
  [
    param('deliveryId').isMongoId(),
    body('minScoreThreshold').optional().isInt({ min: 0, max: 100 }),
    body('considerPreferences').optional().isBoolean()
  ],
  deliveryAIController.autoAssignDelivery
);

// Batch auto-assign deliveries
router.post('/admin/ai/batch-assign',
  [
    body('deliveryIds').isArray(),
    body('deliveryIds.*').isMongoId(),
    body('minScoreThreshold').optional().isInt({ min: 0, max: 100 })
  ],
  deliveryAIController.batchAutoAssignDeliveries
);

// Find best delivery person for delivery
router.post('/admin/ai/find-best/:deliveryId',
  [param('deliveryId').isMongoId()],
  deliveryAIController.findBestDeliveryPerson
);

// Optimize route for multiple deliveries
router.post('/admin/ai/optimize-route/:personId',
  [
    param('personId').isMongoId(),
    body('deliveryIds').isArray(),
    body('deliveryIds.*').isMongoId()
  ],
  deliveryAIController.optimizeDeliveryRoute
);

// Get AI assignment suggestions
router.get('/admin/ai/suggestions/:deliveryId',
  [param('deliveryId').isMongoId()],
  deliveryAIController.getAssignmentSuggestions
);

module.exports = router;