// controllers/admin-settings.controller.js
const AdminSettingsService = require('../../services/admin-settings.service');
const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');

class AdminSettingsController {
  getSettings = catchAsync(async (req, res) => {
    const { settings } = await AdminSettingsService.getSettings(req.admin._id);
    return ApiResponse.success(res, 200, 'Settings retrieved successfully', { settings });
  });

  updateAccount = catchAsync(async (req, res) => {
    const updatedSettings = await AdminSettingsService.updateAccountSettings(req.admin._id, req.body);
    return ApiResponse.success(res, 200, 'Account settings updated successfully', updatedSettings);
  });

  updateNotifications = catchAsync(async (req, res) => {
    const updatedSettings = await AdminSettingsService.updateNotificationSettings(req.admin._id, req.body);
    return ApiResponse.success(res, 200, 'Notification settings updated successfully', { notifications: updatedSettings });
  });

  updatePrivacy = catchAsync(async (req, res) => {
    const updatedSettings = await AdminSettingsService.updatePrivacySettings(req.admin._id, req.body);
    return ApiResponse.success(res, 200, 'Privacy settings updated successfully', { privacy: updatedSettings });
  });

  updateAppearance = catchAsync(async (req, res) => {
    const updatedSettings = await AdminSettingsService.updateAppearanceSettings(req.admin._id, req.body);
    return ApiResponse.success(res, 200, 'Appearance settings updated successfully', { appearance: updatedSettings });
  });

  updateLanguage = catchAsync(async (req, res) => {
    const updatedSettings = await AdminSettingsService.updateLanguageSettings(req.admin._id, req.body);
    return ApiResponse.success(res, 200, 'Language settings updated successfully', { language: updatedSettings });
  });

  updateSecurity = catchAsync(async (req, res) => {
    const updatedSettings = await AdminSettingsService.updateSecuritySettings(req.admin._id, req.body);
    return ApiResponse.success(res, 200, 'Security settings updated successfully', { security: updatedSettings });
  });
}

module.exports = new AdminSettingsController();
