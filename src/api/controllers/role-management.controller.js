const RoleManagementService = require('../../services/role-management.service');
const  catchAsync  = require('../../utils/catchAsync');
const  {ApiResponse}  = require('../../utils/apiResponse');
const AppError  = require('../../utils/AppError');

class RoleManagementController {
  /**
   * Create new admin (Super Admin only)
   */
  createAdmin = catchAsync(async (req, res) => {
    const result = await RoleManagementService.createAdmin(req.body, req.admin._id);
    
    return ApiResponse.success(res, 201, result.message, {
      admin: result.admin
    });
  });

  /**
   * Update admin role
   */
  updateAdminRole = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    if (!role) {
      throw new AppError('Role is required', 400);
    }

    const result = await RoleManagementService.updateAdminRole(id, role, req.admin._id);
    
    return ApiResponse.success(res, 200, result.message, {
      admin: result.admin,
      oldRole: result.oldRole,
      newRole: result.newRole
    });
  });

  /**
   * Update admin permissions
   */
  updatePermissions = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { permissions } = req.body;

    if (!permissions) {
      throw new AppError('Permissions are required', 400);
    }

    const admin = await RoleManagementService.updatePermissions(id, permissions, req.admin._id);
    
    return ApiResponse.success(res, 200, 'Permissions updated successfully', { admin });
  });

  /**
   * Get all admins
   */
  getAllAdmins = catchAsync(async (req, res) => {
    const { page = 1, limit = 20, ...filters } = req.query;
    
    const result = await RoleManagementService.getAllAdmins(
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Admins retrieved successfully', result);
  });

  /**
   * Get role details
   */
  getRoleDetails = catchAsync(async (req, res) => {
    const { role } = req.params;
    
    const roleDetails = await RoleManagementService.getRoleDetails(role);
    
    return ApiResponse.success(res, 200, 'Role details retrieved', roleDetails);
  });

  /**
   * List all roles
   */
  listRoles = catchAsync(async (req, res) => {
    const result = await RoleManagementService.listAllRoles();
    
    return ApiResponse.success(res, 200, 'Roles retrieved successfully', result.roles);
  });

  /**
   * Deactivate admin
   */
  deactivateAdmin = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      throw new AppError('Deactivation reason is required', 400);
    }

    const result = await RoleManagementService.deactivateAdmin(id, reason, req.admin._id);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Reactivate admin
   */
  reactivateAdmin = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const result = await RoleManagementService.reactivateAdmin(id, req.admin._id);
    
    return ApiResponse.success(res, 200, result.message);
  });
}

module.exports = new RoleManagementController();