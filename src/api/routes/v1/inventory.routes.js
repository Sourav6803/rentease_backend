const express = require('express');
const router = express.Router();
const inventoryController = require('../../controllers/inventory.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { inventoryValidations } = require('../../middlewares/validation.middleware');
const { cacheInventory, invalidateCache } = require('../../middlewares/cache.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');

// All inventory routes require authentication
router.use(protect);

// ==================== VENDOR ROUTES ====================

// Get inventory analytics
router.get('/analytics', restrictTo('vendor'), inventoryController.getInventoryAnalytics);

// Get low stock alerts
router.get('/alerts/low-stock', restrictTo('vendor'), inventoryController.getLowStockAlerts);

// Get maintenance due items
router.get('/alerts/maintenance-due', restrictTo('vendor'), inventoryController.getMaintenanceDueItems);

// Get inventory value report
router.get('/reports/value', restrictTo('vendor'), inventoryController.getInventoryValueReport);

// Export inventory
router.get('/export', restrictTo('vendor'), inventoryController.exportInventory);


router.get('/items', restrictTo('vendor'), inventoryController.getAllVendorInventory )

// Create inventory items
router.post('/items', 
  restrictTo('vendor'),
  validate(inventoryValidations.createItems),
  invalidateCache(['inventory:product:*', 'inventory:analytics:*']),
  inventoryController.createInventoryItems
);

// Get product inventory
router.get('/product/:productId', 
  restrictTo('vendor'),
  inventoryController.getProductInventory
);

// Get inventory item by ID
router.get('/items/:id', 
  restrictTo('vendor'),
  cacheInventory(),
  inventoryController.getInventoryItem
);

// Update inventory item
router.put('/items/:id', 
  restrictTo('vendor'),
  validate(inventoryValidations.updateItem),
  invalidateCache(['inventory:*']),
  inventoryController.updateInventoryItem
);

// Update inventory status
router.patch('/items/:id/status', 
  restrictTo('vendor'),
  validate(inventoryValidations.updateStatus),
  invalidateCache(['inventory:*']),
  inventoryController.updateStatus
);

// Transfer inventory
router.post('/items/:id/transfer', 
  restrictTo('vendor'),
  validate(inventoryValidations.transfer),
  invalidateCache(['inventory:*']),
  inventoryController.transferInventory
);

// Get movement history
router.get('/items/:id/history', 
  restrictTo('vendor'),
  inventoryController.getMovementHistory
);

// Schedule maintenance
router.post('/maintenance/schedule', 
  restrictTo('vendor'),
  validate(inventoryValidations.scheduleMaintenance),
  inventoryController.scheduleMaintenance
);

// Perform audit
router.post('/audit', 
  restrictTo('vendor'),
  validate(inventoryValidations.audit),
  inventoryController.performAudit
);

// Bulk import
router.post('/bulk-import', 
  restrictTo('vendor'),
  validate(inventoryValidations.bulkImport),
  inventoryController.bulkImport
);

// ==================== PUBLIC ROUTES ====================

// Scan QR code (public)
router.get('/scan/:code', inventoryController.scanQRCode);

// ==================== ADMIN ROUTES ====================

// Admin routes
router.use('/admin', restrictTo('admin', 'super-admin'));

// Get all inventory
router.get('/admin/all', inventoryController.getAllInventory);

// Get inventory summary
router.get('/admin/summary', inventoryController.getInventorySummary);

module.exports = router;


// const express = require('express');
// const router = express.Router();
// const inventoryController = require('../../controllers/inventory.controller');
// const { protect, } = require('../../middlewares/auth.middleware');
// const { validate } = require('../../middlewares/validation.middleware');
// const { inventoryValidations } = require('../../middlewares/validation.middleware');
// const { cacheInventory, invalidateCache } = require('../../middlewares/cache.middleware');
// const { restrictTo } = require('../../middlewares/permissions.middleware');

// // All inventory routes require authentication
// router.use(protect);

// // ==================== VENDOR ROUTES ====================
// const vendorRouter = express.Router();
// vendorRouter.use(restrictTo('vendor'));

// vendorRouter.get('/analytics', inventoryController.getInventoryAnalytics);
// vendorRouter.get('/alerts/low-stock', inventoryController.getLowStockAlerts);
// vendorRouter.get('/alerts/maintenance-due', inventoryController.getMaintenanceDueItems);
// vendorRouter.get('/reports/value', inventoryController.getInventoryValueReport);
// vendorRouter.get('/export', inventoryController.exportInventory);



// vendorRouter.post('/items', 
//   validate(inventoryValidations.createItems),
//   invalidateCache(['inventory:product:*', 'inventory:analytics:*']),
//   inventoryController.createInventoryItems
// );

// vendorRouter.get('/product/:productId', inventoryController.getProductInventory);
// vendorRouter.get('/items/:id', cacheInventory(), inventoryController.getInventoryItem);
// vendorRouter.put('/items/:id', 
//   validate(inventoryValidations.updateItem),
//   invalidateCache(['inventory:*']),
//   inventoryController.updateInventoryItem
// );
// vendorRouter.patch('/items/:id/status', 
//   validate(inventoryValidations.updateStatus),
//   invalidateCache(['inventory:*']),
//   inventoryController.updateStatus
// );
// vendorRouter.post('/items/:id/transfer', 
//   validate(inventoryValidations.transfer),
//   invalidateCache(['inventory:*']),
//   inventoryController.transferInventory
// );
// vendorRouter.get('/items/:id/history', inventoryController.getMovementHistory);
// vendorRouter.post('/maintenance/schedule', 
//   validate(inventoryValidations.scheduleMaintenance),
//   inventoryController.scheduleMaintenance
// );
// vendorRouter.post('/audit', 
//   validate(inventoryValidations.audit),
//   inventoryController.performAudit
// );
// vendorRouter.post('/bulk-import', 
//   validate(inventoryValidations.bulkImport),
//   inventoryController.bulkImport
// );

// router.use('/', vendorRouter);

// // ==================== PUBLIC ROUTES ====================
// router.get('/scan/:code', inventoryController.scanQRCode);

// // ==================== ADMIN ROUTES ====================
// const adminRouter = express.Router();
// adminRouter.use(restrictTo('admin', 'super-admin'));

// adminRouter.get('/all', inventoryController.getAllInventory);
// adminRouter.get('/summary', inventoryController.getInventorySummary);

// router.use('/admin', adminRouter);

// module.exports = router;