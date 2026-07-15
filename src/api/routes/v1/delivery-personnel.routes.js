// // routes/delivery-personnel.routes.js
// const express = require('express');
// const router = express.Router();
// const deliveryPersonnelController = require('../../controllers/delivery-personnel.controller');
// const { protect } = require('../../middlewares/auth.middleware');
// const { restrictTo } = require('../../middlewares/permissions.middleware');
// const { validate } = require('../../middlewares/validation.middleware');
// const { body, param, query } = require('express-validator');

// // All routes require authentication
// router.use(protect);
// router.use(restrictTo('admin', 'super-admin'));

// // ==================== DELIVERY PERSON ROUTES ====================

// // Create delivery person
// router.post('/persons',
//   validate([
//     body('email').isEmail().withMessage('Valid email required'),
//     body('phone').isMobilePhone().withMessage('Valid phone number required'),
//     body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
//     body('profile.firstName').notEmpty().withMessage('First name required'),
//     body('profile.lastName').notEmpty().withMessage('Last name required'),
//     body('vehicle.type').optional().isIn(['bike', 'scooter', 'car', 'van', 'truck', 'mini-truck']),
//     body('zone').optional().isIn(['north', 'south', 'east', 'west', 'central', 'all'])
//   ]),
//   deliveryPersonnelController.createDeliveryPerson
// );

// // Get all delivery persons
// router.get('/persons',
//   validate([
//     query('page').optional().isInt({ min: 1 }),
//     query('limit').optional().isInt({ min: 1, max: 100 }),
//     query('status').optional().isIn(['pending', 'verified', 'rejected', 'suspended']),
//     query('zone').optional().isIn(['north', 'south', 'east', 'west', 'central']),
//     query('isAvailable').optional().isIn(['true', 'false'])
//   ]),
//   deliveryPersonnelController.getAllDeliveryPersons
// );

// // Get available delivery persons
// router.get('/persons/available',
//   validate([
//     query('pincode').isString().isLength({ min: 6, max: 6 }).withMessage('Valid pincode required'),
//     query('limit').optional().isInt({ min: 1, max: 50 })
//   ]),
//   deliveryPersonnelController.getAvailableDeliveryPersons
// );

// // Get delivery person by ID
// router.get('/persons/:id',
//   validate([param('id').isMongoId().withMessage('Invalid ID')]),
//   deliveryPersonnelController.getDeliveryPersonById
// );

// // Update delivery person
// router.put('/persons/:id',
//   validate([param('id').isMongoId().withMessage('Invalid ID')]),
//   deliveryPersonnelController.updateDeliveryPerson
// );

// // Update delivery person location
// router.put('/persons/:id/location',
//   validate([
//     param('id').isMongoId(),
//     body('location.lat').isFloat({ min: -90, max: 90 }),
//     body('location.lng').isFloat({ min: -180, max: 180 })
//   ]),
//   deliveryPersonnelController.updateLocation
// );

// // Verify document
// router.patch('/persons/:id/documents/:documentIndex/verify',
//   validate([
//     param('id').isMongoId(),
//     param('documentIndex').isInt({ min: 0 }),
//     body('verified').isBoolean()
//   ]),
//   deliveryPersonnelController.verifyDocument
// );

// // Get delivery person performance
// router.get('/persons/:id/performance',
//   validate([
//     param('id').isMongoId(),
//     query('period').optional().isIn(['week', 'month', 'quarter'])
//   ]),
//   deliveryPersonnelController.getPersonPerformance
// );

// // ==================== DELIVERY TEAM ROUTES ====================

// // Create delivery team
// router.post('/teams',
//   validate([
//     body('name').notEmpty().withMessage('Team name required'),
//     body('teamLeadId').isMongoId().withMessage('Valid team lead ID required'),
//     body('members').isArray().optional(),
//     body('vehicle.type').optional().isIn(['bike', 'car', 'van', 'truck', 'mini-truck', 'tempo'])
//   ]),
//   deliveryPersonnelController.createDeliveryTeam
// );

// // Get all delivery teams
// router.get('/teams',
//   validate([
//     query('page').optional().isInt({ min: 1 }),
//     query('limit').optional().isInt({ min: 1, max: 100 }),
//     query('status').optional().isIn(['active', 'inactive'])
//   ]),
//   deliveryPersonnelController.getAllDeliveryTeams
// );

// // Get available delivery teams
// router.get('/teams/available',
//   validate([
//     query('pincode').isString().isLength({ min: 6, max: 6 }),
//     query('requiredMembers').optional().isInt({ min: 1 })
//   ]),
//   deliveryPersonnelController.getAvailableDeliveryTeams
// );

// // Get delivery team by ID
// router.get('/teams/:id',
//   validate([param('id').isMongoId()]),
//   deliveryPersonnelController.getDeliveryTeamById
// );

// // Update delivery team
// router.put('/teams/:id',
//   validate([param('id').isMongoId()]),
//   deliveryPersonnelController.updateDeliveryTeam
// );

// // Update team location
// router.put('/teams/:id/location',
//   validate([
//     param('id').isMongoId(),
//     body('location.lat').isFloat({ min: -90, max: 90 }),
//     body('location.lng').isFloat({ min: -180, max: 180 })
//   ]),
//   deliveryPersonnelController.updateTeamLocation
// );

// // Get team performance
// router.get('/teams/:id/performance',
//   validate([
//     param('id').isMongoId(),
//     query('period').optional().isIn(['week', 'month', 'quarter'])
//   ]),
//   deliveryPersonnelController.getTeamPerformance
// );

// // ==================== ASSIGNMENT ROUTES ====================

// // Assign delivery to person or team
// router.post('/assignments/:deliveryId',
//   validate([
//     param('deliveryId').isMongoId(),
//     body('type').isIn(['person', 'team']),
//     body('personId').custom((value, { req }) => {
//       if (req.body.type === 'person' && !value) throw new Error('Person ID required for person assignment');
//       return true;
//     }),
//     body('teamId').custom((value, { req }) => {
//       if (req.body.type === 'team' && !value) throw new Error('Team ID required for team assignment');
//       return true;
//     })
//   ]),
//   deliveryPersonnelController.assignDeliveryToPersonnel
// );



// // Add to delivery-personnel.routes.js

// // Analytics Routes
// router.get('/analytics/dashboard', 
//   deliveryPersonnelController.getDashboardAnalytics
// );

// router.get('/analytics/comparison',
//   validate([
//     query('personIds').notEmpty().withMessage('Person IDs required'),
//     query('period').optional().isIn(['week', 'month', 'quarter'])
//   ]),
//   deliveryPersonnelController.getPerformanceComparison
// );

// router.get('/analytics/heatmap',
//   validate([
//     query('startDate').optional().isISO8601(),
//     query('endDate').optional().isISO8601()
//   ]),
//   deliveryPersonnelController.getDeliveryHeatmap
// );

// router.get('/analytics/efficiency',
//   validate([
//     query('period').optional().isIn(['week', 'month', 'quarter'])
//   ]),
//   deliveryPersonnelController.getEfficiencyMetrics
// );

// router.get('/analytics/export',
//   validate([
//     query('format').optional().isIn(['csv', 'json']),
//     query('period').optional().isIn(['week', 'month', 'quarter']),
//     query('personId').optional().isMongoId()
//   ]),
//   deliveryPersonnelController.exportDeliveryPersonReport
// );

// // Performance Routes (existing)
// router.get('/persons/:id/performance', 
//   deliveryPersonnelController.getPersonPerformance
// );

// router.get('/teams/:id/performance', 
//   deliveryPersonnelController.getTeamPerformance
// );

// module.exports = router;





// src/api/routes/v1/delivery-personnel.routes.js
const express = require('express');
const router = express.Router();
const deliveryPersonnelController = require('../../controllers/delivery-personnel.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { protectAdmin } = require('../../middlewares/admin-auth.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { body, param, query } = require('express-validator');

// All routes require admin authentication
// router.use(protectAdmin);protect

router.use(protect);
router.use(restrictTo('admin', 'super-admin'));

// ==================== DELIVERY PERSON ROUTES ====================

// Create delivery person
router.post('/persons',
  validate([
    body('email').isEmail().withMessage('Valid email required'),
    body('phone').isMobilePhone().withMessage('Valid phone number required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('profile.firstName').notEmpty().withMessage('First name required'),
    body('profile.lastName').notEmpty().withMessage('Last name required'),
    body('vehicle.type').optional().isIn(['bike', 'scooter', 'car', 'van', 'truck', 'mini-truck']),
    body('zone').optional().isIn(['north', 'south', 'east', 'west', 'central', 'all'])
  ]),
  deliveryPersonnelController.createDeliveryPerson
);

// Get all delivery persons
router.get('/persons',
  validate([
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn(['pending', 'verified', 'rejected', 'suspended']),
    query('zone').optional().isIn(['north', 'south', 'east', 'west', 'central']),
    query('isAvailable').optional().isIn(['true', 'false'])
  ]),
  deliveryPersonnelController.getAllDeliveryPersons
);

// Get available delivery persons
router.get('/persons/available',
  validate([
    query('pincode').isString().isLength({ min: 6, max: 6 }).withMessage('Valid pincode required'),
    query('limit').optional().isInt({ min: 1, max: 50 })
  ]),
  deliveryPersonnelController.getAvailableDeliveryPersons
);

// Get delivery person by ID
router.get('/persons/:id',
  validate([param('id').isMongoId().withMessage('Invalid ID')]),
  deliveryPersonnelController.getDeliveryPersonById
);

// Update delivery person
router.put('/persons/:id',
  validate([param('id').isMongoId().withMessage('Invalid ID')]),
  deliveryPersonnelController.updateDeliveryPerson
);

// Update delivery person location
router.put('/persons/:id/location',
  validate([
    param('id').isMongoId(),
    body('location.lat').isFloat({ min: -90, max: 90 }),
    body('location.lng').isFloat({ min: -180, max: 180 })
  ]),
  deliveryPersonnelController.updateLocation
);

// Verify document
router.patch('/persons/:id/documents/:documentIndex/verify',
  validate([
    param('id').isMongoId(),
    param('documentIndex').isInt({ min: 0 }),
    body('verified').isBoolean()
  ]),
  deliveryPersonnelController.verifyDocument
);

// Get delivery person performance
router.get('/persons/:id/performance',
  validate([
    param('id').isMongoId(),
    query('period').optional().isIn(['week', 'month', 'quarter'])
  ]),
  deliveryPersonnelController.getPersonPerformance
);

// Get delivery person location history
router.get('/persons/:id/location-history',
  validate([
    param('id').isMongoId(),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('limit').optional().isInt({ min: 1, max: 1000 })
  ]),
  deliveryPersonnelController.getLocationHistory
);

// Suspend/Delete delivery person
router.delete('/persons/:id',
  validate([param('id').isMongoId()]),
  deliveryPersonnelController.suspendDeliveryPerson
);

// Verify delivery person
router.post('/persons/:id/verify',
  validate([param('id').isMongoId()]),
  deliveryPersonnelController.verifyDeliveryPerson
);

// ==================== DELIVERY TEAM ROUTES ====================

// Create delivery team
router.post('/teams',
  validate([
    body('name').notEmpty().withMessage('Team name required'),
    body('teamLeadId').isMongoId().withMessage('Valid team lead ID required'),
    body('members').isArray().optional(),
    body('vehicle.type').optional().isIn(['bike', 'car', 'van', 'truck', 'mini-truck', 'tempo'])
  ]),
  deliveryPersonnelController.createDeliveryTeam
);

// Get all delivery teams
router.get('/teams',
  validate([
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn(['active', 'inactive'])
  ]),
  deliveryPersonnelController.getAllDeliveryTeams
);

// Get available delivery teams
router.get('/teams/available',
  validate([
    query('pincode').isString().isLength({ min: 6, max: 6 }),
    query('requiredMembers').optional().isInt({ min: 1 })
  ]),
  deliveryPersonnelController.getAvailableDeliveryTeams
);

// Get delivery team by ID
router.get('/teams/:id',
  validate([param('id').isMongoId()]),
  deliveryPersonnelController.getDeliveryTeamById
);

// Update delivery team
router.put('/teams/:id',
  validate([param('id').isMongoId()]),
  deliveryPersonnelController.updateDeliveryTeam
);

// Update team location
router.put('/teams/:id/location',
  validate([
    param('id').isMongoId(),
    body('location.lat').isFloat({ min: -90, max: 90 }),
    body('location.lng').isFloat({ min: -180, max: 180 })
  ]),
  deliveryPersonnelController.updateTeamLocation
);

// Get team performance
router.get('/teams/:id/performance',
  validate([
    param('id').isMongoId(),
    query('period').optional().isIn(['week', 'month', 'quarter'])
  ]),
  deliveryPersonnelController.getTeamPerformance
);

// Delete delivery team
router.delete('/teams/:id',
  validate([param('id').isMongoId()]),
  deliveryPersonnelController.deleteDeliveryTeam
);

// ==================== ASSIGNMENT ROUTES ====================

// Assign delivery to person or team
router.post('/assignments/:deliveryId',
  validate([
    param('deliveryId').isMongoId(),
    body('type').isIn(['person', 'team']),
    body('personId').custom((value, { req }) => {
      if (req.body.type === 'person' && !value) throw new Error('Person ID required for person assignment');
      return true;
    }),
    body('teamId').custom((value, { req }) => {
      if (req.body.type === 'team' && !value) throw new Error('Team ID required for team assignment');
      return true;
    })
  ]),
  deliveryPersonnelController.assignDeliveryToPersonnel
);

// Bulk assign deliveries
router.post('/assignments/bulk',
  validate([
    body('assignments').isArray(),
    body('assignments.*.deliveryId').isMongoId(),
    body('assignments.*.personId').isMongoId()
  ]),
  deliveryPersonnelController.bulkAssignDeliveries
);

// ==================== ANALYTICS ROUTES ====================

// Dashboard analytics
router.get('/analytics/dashboard',
  validate([
    query('period').optional().isIn(['week', 'month', 'quarter'])
  ]),
  deliveryPersonnelController.getDashboardAnalytics
);

// Performance comparison
router.get('/analytics/comparison',
  validate([
    query('personIds').notEmpty().withMessage('Person IDs required'),
    query('period').optional().isIn(['week', 'month', 'quarter'])
  ]),
  deliveryPersonnelController.getPerformanceComparison
);

// Delivery heatmap
router.get('/analytics/heatmap',
  validate([
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601()
  ]),
  deliveryPersonnelController.getDeliveryHeatmap
);

// Efficiency metrics
router.get('/analytics/efficiency',
  validate([
    query('period').optional().isIn(['week', 'month', 'quarter'])
  ]),
  deliveryPersonnelController.getEfficiencyMetrics
);

// Export report
router.get('/analytics/export',
  validate([
    query('format').optional().isIn(['csv', 'json']),
    query('period').optional().isIn(['week', 'month', 'quarter']),
    query('personId').optional().isMongoId()
  ]),
  deliveryPersonnelController.exportDeliveryPersonReport
);

// Workload distribution
router.get('/analytics/workload',
  validate([
    query('period').optional().isIn(['week', 'month', 'quarter'])
  ]),
  deliveryPersonnelController.getWorkloadDistribution
);

module.exports = router;