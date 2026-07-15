const express = require('express');
const router = express.Router();
const userController = require('../../controllers/user.controller');
const { protect, } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { userValidations } = require('../../middlewares/validation.middleware');
const { uploadProfilePicture } = require('../../middlewares/upload.middleware');
const { cacheUser, clearCache } = require('../../middlewares/cache.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');

// All routes require authentication
router.use(protect);

// ==================== USER ROUTES ====================

// Profile routes
router.get('/profile', cacheUser(), userController.getProfile);
router.put('/profile', validate(userValidations.updateProfile), userController.updateProfile);

// Avatar routes
router.post('/avatar', uploadProfilePicture, userController.uploadAvatar);
router.delete('/avatar', userController.deleteAvatar);

// Address routes
router.get('/addresses', userController.getAddresses);
router.post('/addresses', validate(userValidations.addAddress), userController.addAddress);
router.put('/addresses/:id', validate(userValidations.updateAddress), userController.updateAddress);
router.delete('/addresses/:id', userController.deleteAddress);
router.patch('/addresses/:id/default', userController.setDefaultAddress);

// Statistics and activity
router.get('/stats', userController.getStats);
router.get('/activity', userController.getActivity);

// Notification preferences
router.put('/notifications', validate(userValidations.updateNotifications), userController.updateNotificationPreferences);

// Account management
router.post('/deactivate', userController.deactivateAccount);
router.post('/reactivate', userController.reactivateAccount);
router.delete('/delete', validate(userValidations.deleteAccount), userController.deleteAccount);

// Data export (GDPR)
router.get('/export', userController.exportData);

// ==================== ADMIN ROUTES ====================

// All admin routes require admin role
router.use(restrictTo('admin', 'super-admin'));

// User management
router.get('/admin/search', userController.searchUsers);
router.get('/admin', userController.getAllUsers);
router.get('/admin/:id', userController.getUserById);
router.get('/admin/:id/stats', userController.getUserStats);
router.get('/admin/:id/activity', userController.getUserActivity);

// User role management
router.patch('/admin/:id/role', validate(userValidations.updateRole), userController.updateUserRole);

// User status management
router.post('/admin/:id/block', validate(userValidations.blockUser), userController.blockUser);
router.post('/admin/:id/unblock', userController.unblockUser);

// User verification
router.post('/admin/:id/verify-email', userController.verifyUserEmail);
router.post('/admin/:id/verify-phone', userController.verifyUserPhone);

module.exports = router;