const UserService = require('../../services/user.service');
const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const { AppError } = require('../../utils/AppError');
const logger = require('../../config/logger');

class UserController {
  /**
   * Get current user profile
   */
  getProfile = catchAsync(async (req, res) => {
    const user = await UserService.getUserProfile(req.user._id);
    
    return ApiResponse.success(res, 200, 'Profile retrieved successfully', { user });
  });

  /**
   * Update user profile
   */
  updateProfile = catchAsync(async (req, res) => {
    const user = await UserService.updateProfile(req.user._id, req.body);
    
    return ApiResponse.success(res, 200, 'Profile updated successfully', { user });
  });

  /**
   * Get user addresses
   */
  getAddresses = catchAsync(async (req, res) => {
    const addresses = await UserService.getUserAddresses(req.user._id);
    
    return ApiResponse.success(res, 200, 'Addresses retrieved successfully', { addresses });
  });

  /**
   * Add new address
   */
  addAddress = catchAsync(async (req, res) => {
    const address = await UserService.addAddress(req.user._id, req.body);
    
    return ApiResponse.success(res, 201, 'Address added successfully', { address });
  });

  /**
   * Update address
   */
  updateAddress = catchAsync(async (req, res) => {
    const { id } = req.params;
    const address = await UserService.updateAddress(req.user._id, id, req.body);
    
    return ApiResponse.success(res, 200, 'Address updated successfully', { address });
  });

  /**
   * Delete address
   */
  deleteAddress = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await UserService.deleteAddress(req.user._id, id);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Set default address
   */
  setDefaultAddress = catchAsync(async (req, res) => {
    const { id } = req.params;
    const address = await UserService.setDefaultAddress(req.user._id, id);
    
    return ApiResponse.success(res, 200, 'Default address updated', { address });
  });

  /**
   * Get user statistics
   */
  getStats = catchAsync(async (req, res) => {
    const stats = await UserService.getUserStats(req.user._id);
    
    return ApiResponse.success(res, 200, 'Statistics retrieved successfully', { stats });
  });

  /**
   * Get user activity
   */
  getActivity = catchAsync(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const activity = await UserService.getUserActivity(req.user._id, parseInt(page), parseInt(limit));
    
    return ApiResponse.success(res, 200, 'Activity retrieved successfully', activity);
  });

  /**
   * Upload avatar
   */
  uploadAvatar = catchAsync(async (req, res) => {
    if (!req.file) {
      throw new AppError('Please upload an image', 400);
    }

    const user = await UserService.uploadAvatar(
      req.user._id,
      req.file.path,
      req.file.filename
    );
    
    return ApiResponse.success(res, 200, 'Avatar uploaded successfully', { user });
  });

  /**
   * Delete avatar
   */
  deleteAvatar = catchAsync(async (req, res) => {
    const result = await UserService.deleteAvatar(req.user._id);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Update notification preferences
   */
  updateNotificationPreferences = catchAsync(async (req, res) => {
    const preferences = await UserService.updateNotificationPreferences(req.user._id, req.body);
    
    return ApiResponse.success(res, 200, 'Preferences updated successfully', { preferences });
  });

  /**
   * Deactivate account
   */
  deactivateAccount = catchAsync(async (req, res) => {
    const { reason } = req.body;
    const result = await UserService.deactivateAccount(req.user._id, reason);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Reactivate account
   */
  reactivateAccount = catchAsync(async (req, res) => {
    const result = await UserService.reactivateAccount(req.user._id);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Delete account (permanent)
   */
  deleteAccount = catchAsync(async (req, res) => {
    const { password } = req.body;
    
    if (!password) {
      throw new AppError('Password is required', 400);
    }

    const result = await UserService.deleteAccount(req.user._id, password);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Export user data (GDPR)
   */
  exportData = catchAsync(async (req, res) => {
    const data = await UserService.exportUserData(req.user._id);
    
    return ApiResponse.success(res, 200, 'Data exported successfully', data);
  });

  // ==================== ADMIN METHODS ====================

  /**
   * Search users (admin)
   */
  searchUsers = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...query } = req.query;
    const result = await UserService.searchUsers(
      query,
      parseInt(page),
      parseInt(limit)
    );
    
    return ApiResponse.success(res, 200, 'Users retrieved successfully', result);
  });

  /**
   * Get user by ID (admin)
   */
  getUserById = catchAsync(async (req, res) => {
    const { id } = req.params;
    const user = await UserService.getUserById(id);
    
    return ApiResponse.success(res, 200, 'User retrieved successfully', { user });
  });

  /**
   * Update user role (admin)
   */
  updateUserRole = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    
    if (!role) {
      throw new AppError('Role is required', 400);
    }

    const user = await UserService.updateUserRole(id, role, req.admin._id);
    
    return ApiResponse.success(res, 200, 'User role updated successfully', { user });
  });

  /**
   * Block user (admin)
   */
  blockUser = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    
    const user = await UserService.toggleUserBlock(id, true, reason, req.admin._id);
    
    return ApiResponse.success(res, 200, 'User blocked successfully', { user });
  });

  /**
   * Unblock user (admin)
   */
  unblockUser = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const user = await UserService.toggleUserBlock(id, false, null, req.admin._id);
    
    return ApiResponse.success(res, 200, 'User unblocked successfully', { user });
  });

  /**
   * Verify user email (admin)
   */
  verifyUserEmail = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await UserService.verifyUserEmail(id);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Verify user phone (admin)
   */
  verifyUserPhone = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await UserService.verifyUserPhone(id);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Get all users with pagination (admin)
   */
  getAllUsers = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, role, status, search } = req.query;
    
    const query = {};
    if (role) query.role = role;
    if (status) query.status = status;
    if (search) query.name = search;

    const result = await UserService.searchUsers(
      query,
      parseInt(page),
      parseInt(limit)
    );
    
    return ApiResponse.success(res, 200, 'Users retrieved successfully', result);
  });

  /**
   * Get user statistics (admin)
   */
  getUserStats = catchAsync(async (req, res) => {
    const { id } = req.params;
    const stats = await UserService.getUserStats(id);
    
    return ApiResponse.success(res, 200, 'User statistics retrieved successfully', { stats });
  });

  /**
   * Get user activity (admin)
   */
  getUserActivity = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    
    const activity = await UserService.getUserActivity(
      id,
      parseInt(page),
      parseInt(limit)
    );
    
    return ApiResponse.success(res, 200, 'User activity retrieved successfully', activity);
  });
}

module.exports = new UserController();