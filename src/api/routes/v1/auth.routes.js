const express = require('express');
const router = express.Router();
const authController = require('../../controllers/auth.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { validate, vendorValidations } = require('../../middlewares/validation.middleware');
const { authValidations } = require('../../middlewares/validation.middleware');
const { authLimiter } = require('../../middlewares/rateLimiter.middleware');
const { uploadVendorDocuments } = require('../../middlewares/upload.middleware');

// Public routes (with rate limiting)
router.post('/register', authLimiter, validate(authValidations.register), authController.register);
router.post('/login', authLimiter, validate(authValidations.login), authController.login);
router.post('/refresh-token', authLimiter, validate(authValidations.refreshToken), authController.refreshToken);
router.post('/forgot-password', authLimiter, validate(authValidations.forgotPassword), authController.forgotPassword);
router.post('/reset-password', authLimiter, validate(authValidations.resetPassword), authController.resetPassword);
router.get('/verify-email/:token', validate(authValidations.verifyEmail), authController.verifyEmail);
router.post('/resend-verification', authLimiter, validate(authValidations.resendVerification), authController.resendVerificationEmail);
router.post('/send-otp', authLimiter, validate(authValidations.sendOTP), authController.sendPhoneOTP);
router.post('/verify-otp', authLimiter, validate(authValidations.verifyOTP), authController.verifyPhoneOTP);
router.get('/validate-token', authController.validateToken);


// Vendor registration (public)
router.post('/vendor/register', 
  uploadVendorDocuments,
  validate(vendorValidations.registerVendor),
  authController.registerVendor
);

// Social auth routes
router.get('/google', authController.googleLogin);
router.post('/facebook', validate(authValidations.socialLogin), authController.facebookLogin);

// Protected routes
router.use(protect);
router.post('/logout', authController.logout);
router.post('/logout-all', authController.logoutAll);
router.post('/change-password', validate(authValidations.changePassword), authController.changePassword);
router.get('/me', authController.getCurrentUser);
router.get('/sessions', authController.getUserSessions);
router.delete('/sessions/:sessionId', authController.revokeSession);

module.exports = router;