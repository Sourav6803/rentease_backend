const express = require('express');
const router = express.Router();
const adminVendorController = require('../../controllers/admin-vendor.controller');
const { protectAdmin, restrictTo } = require('../../middlewares/admin-auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { vendorValidations } = require('../../middlewares/validation.middleware');

// All routes require admin authentication
router.use(protectAdmin);

// Vendor statistics (accessible by all admins)
router.get('/stats', adminVendorController.getVendorStats);

// Get all vendors (accessible by all admins)
router.get('/', adminVendorController.getAllVendors);

// Get pending vendors (accessible by all admins)
router.get('/pending', adminVendorController.getPendingVendors);

// Get vendor details for review (accessible by all admins)
router.get('/:vendorId/review', adminVendorController.getVendorForReview);

// Get vendor documents (accessible by all admins)
router.get('/:vendorId/documents', adminVendorController.getVendorDocuments);

// Verify vendor document (accessible by all admins)
router.patch('/:vendorId/documents/:documentIndex/verify', 
  validate(vendorValidations.verifyDocument),
  adminVendorController.verifyVendorDocument
);

// Vendor approval/rejection routes (accessible by all admins)
router.post('/:vendorId/approve', 
  validate(vendorValidations.approveVendor),
  adminVendorController.approveVendor
);

router.post('/:vendorId/reject', 
  validate(vendorValidations.rejectVendor),
  adminVendorController.rejectVendor
);

// Vendor management routes (accessible by all admins)
router.post('/:vendorId/suspend', 
  validate(vendorValidations.suspendVendor),
  adminVendorController.suspendVendor
);

router.post('/:vendorId/reinstate', 
  validate(vendorValidations.reinstateVendor),
  adminVendorController.reinstateVendor
);

// Update vendor commission (accessible by all admins)
router.patch('/:vendorId/commission', 
  validate(vendorValidations.updateCommission),
  adminVendorController.updateVendorCommission
);

module.exports = router;