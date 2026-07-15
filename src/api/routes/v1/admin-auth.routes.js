const express = require('express');
const router = express.Router();
const adminAuthController = require('../../controllers/admin-auth.controller');
// const { protectAdmin, restrictTo } = require('../../middlewares/admin-auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { adminValidations } = require('../../middlewares/validation.middleware');
const { rateLimit } = require('express-rate-limit');
const { protectAdmin, restrictTo } = require('../../middlewares/admin-auth.middleware');

// Rate limiting for admin auth
const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: 'Too many authentication attempts. Please try again later.'
});

// ==================== PUBLIC ROUTES ====================

// Admin login
router.post('/login', 
  adminAuthLimiter,
  validate(adminValidations.login),
  adminAuthController.login
);

// Verify 2FA
router.post('/verify-2fa',
  adminAuthLimiter,
  validate(adminValidations.verify2FA),
  adminAuthController.verify2FA
);

// Forgot password
router.post('/forgot-password',
  adminAuthLimiter,
  validate(adminValidations.forgotPassword),
  adminAuthController.forgotPassword
);

// Reset password
router.post('/reset-password',
  adminAuthLimiter,
  validate(adminValidations.resetPassword),
  adminAuthController.resetPassword
);

// Verify email
router.get('/verify-email/:token',
  adminAuthController.verifyEmail
);

// Refresh token
router.post('/refresh-token',
  adminAuthLimiter,
  validate(adminValidations.refreshToken),
  adminAuthController.refreshToken
);

// ==================== PROTECTED ROUTES ====================

// All routes below require admin authentication
router.use(protectAdmin);

// Logout
router.post('/logout',
  validate(adminValidations.logout),
  adminAuthController.logout
);

// Change password
router.post('/change-password',
  validate(adminValidations.changePassword),
  adminAuthController.changePassword
);

// Get profile
router.get('/profile',
  adminAuthController.getProfile
);

// Update profile
router.put('/profile',
  validate(adminValidations.updateAdminProfile),
  adminAuthController.updateProfile
);

// ==================== SUPER ADMIN ROUTES ====================

// Create new admin (super admin only)
router.post('/register',
  restrictTo('super_admin'),
  validate(adminValidations.registerAdmin),
  adminAuthController.registerAdmin
);

module.exports = router;