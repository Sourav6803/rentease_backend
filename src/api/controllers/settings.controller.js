// controllers/settings.controller.js
const SettingsService = require('../../services/settings.service');
const catchAsync = require('../../utils/catchAsync');
const {ApiResponse} = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');

class SettingsController {
  /**
   * Get all user settings
   */
  getSettings = catchAsync(async (req, res) => {
    const { settings } = await SettingsService.getSettings(req.user._id);
    
    return ApiResponse.success(res, 200, 'Settings retrieved successfully', { settings });
  });

  /**
   * Update account settings
   */
  updateAccount = catchAsync(async (req, res) => {
    const updatedSettings = await SettingsService.updateAccountSettings(req.user._id, req.body);
    return ApiResponse.success(res, 200, 'Account settings updated successfully', updatedSettings);
  });

  /**
   * Update notification settings
   */
  updateNotifications = catchAsync(async (req, res) => {
    const updatedSettings = await SettingsService.updateNotificationSettings(req.user._id, req.body);
    return ApiResponse.success(res, 200, 'Notification settings updated successfully', { notifications: updatedSettings });
  });

  /**
   * Update privacy settings
   */
  updatePrivacy = catchAsync(async (req, res) => {
    const updatedSettings = await SettingsService.updatePrivacySettings(req.user._id, req.body);
    return ApiResponse.success(res, 200, 'Privacy settings updated successfully', { privacy: updatedSettings });
  });

  /**
   * Update appearance settings
   */
  updateAppearance = catchAsync(async (req, res) => {
    const updatedSettings = await SettingsService.updateAppearanceSettings(req.user._id, req.body);
    return ApiResponse.success(res, 200, 'Appearance settings updated successfully', { appearance: updatedSettings });
  });

  /**
   * Update language settings
   */
  updateLanguage = catchAsync(async (req, res) => {
    const updatedSettings = await SettingsService.updateLanguageSettings(req.user._id, req.body);
    return ApiResponse.success(res, 200, 'Language settings updated successfully', { language: updatedSettings });
  });

  /**
   * Update security settings
   */
  updateSecurity = catchAsync(async (req, res) => {
    const updatedSettings = await SettingsService.updateSecuritySettings(req.user._id, req.body);
    return ApiResponse.success(res, 200, 'Security settings updated successfully', { security: updatedSettings });
  });

  /**
   * Change password
   */
  changePassword = catchAsync(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      throw new AppError('Current password and new password are required', 400);
    }
    
    if (newPassword.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400);
    }
    
    await SettingsService.changePassword(req.user._id, currentPassword, newPassword);
    
    return ApiResponse.success(res, 200, 'Password changed successfully');
  });

  /**
   * Delete account
   */
  deleteAccount = catchAsync(async (req, res) => {
    const { confirmText } = req.body;
    
    const result = await SettingsService.deleteAccount(req.user._id, confirmText);
    
    return ApiResponse.success(res, 200, result.message);
  });
}

module.exports = new SettingsController();