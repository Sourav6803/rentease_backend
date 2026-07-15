const express = require('express');
const router = express.Router();
const roleManagementController = require('../../controllers/role-management.controller');
const { protectAdmin, restrictTo } = require('../../middlewares/admin-auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { roleValidations } = require('../../middlewares/validation.middleware');

// All routes require admin authentication and super admin role
router.use(protectAdmin);
router.use(restrictTo('super_admin'));

// List all roles
router.get('/roles', roleManagementController.listRoles);
router.get('/', roleManagementController.listRoles);

// Get role details
router.get('/roles/:role', roleManagementController.getRoleDetails);

// Get all admins
router.get('/admins', roleManagementController.getAllAdmins);

// Create new admin
router.post('/admins', 
  validate(roleValidations.createAdmin),
  roleManagementController.createAdmin
);

// Update admin role
router.patch('/admins/:id/role', 
  validate(roleValidations.updateRole),
  roleManagementController.updateAdminRole
);

// Update admin permissions
router.put('/admins/:id/permissions', 
  validate(roleValidations.updatePermissions),
  roleManagementController.updatePermissions
);

// Deactivate admin
router.post('/admins/:id/deactivate', 
  validate(roleValidations.deactivateAdmin),
  roleManagementController.deactivateAdmin
);

// Reactivate admin
router.post('/admins/:id/reactivate', 
  roleManagementController.reactivateAdmin
);

module.exports = router;