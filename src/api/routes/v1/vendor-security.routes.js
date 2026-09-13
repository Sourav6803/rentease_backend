// routes/v1/vendor-security.routes.js
//
// Vendor Security Centre API. Mounted at /api/v1/vendor/security in
// routes/v1/index.js — deliberately BEFORE the generic `/vendor` router so the
// vendor router's own middleware chain never runs for these paths.

const express = require('express');
const router = express.Router();

const vendorSecurityController = require('../../controllers/vendor-security.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');
const AppError = require('../../../utils/AppError');

// ==================== PROTECTED (vendor only) ====================

router.use(protect);
router.use(restrictTo('vendor'));

// `restrictTo('vendor')` only inspects the JWT role — a user flagged as a
// vendor without a Vendor profile row would pass while `protect` leaves
// `req.vendor` undefined. Fail fast and cleanly instead of 500-ing later.
router.use((req, res, next) => {
  if (!req.vendor) {
    return next(new AppError('Vendor profile not found for this account.', 403));
  }
  next();
});

// -------------------------- Overview --------------------------
router.get('/overview', vendorSecurityController.getOverview);
router.get('/activity', vendorSecurityController.getActivity);

// -------------------------- Sessions --------------------------
router.get('/sessions', vendorSecurityController.getSessions);
router.post('/sessions/logout-all', vendorSecurityController.revokeAllSessions);
router.delete('/sessions/:sessionId', vendorSecurityController.revokeSession);

// ----------------------- Login activity -----------------------
router.get('/login-activity', vendorSecurityController.getLoginActivity);

// ------------------------ Security logs -----------------------
// NOTE: `/logs/export` must stay above any `/logs/:param` route.
router.get('/logs/export', vendorSecurityController.exportSecurityLogs);
router.get('/logs', vendorSecurityController.getSecurityLogs);

// ------------------------- Preferences ------------------------
router.get('/preferences', vendorSecurityController.getPreferences);
router.put('/preferences', vendorSecurityController.updatePreferences);

// ----------------------- Trusted devices ----------------------
router.get('/devices', vendorSecurityController.getTrustedDevices);
router.delete('/devices/:deviceId', vendorSecurityController.revokeTrustedDevice);

// ------------------ Two-factor authentication -----------------
router.post('/2fa/setup', vendorSecurityController.setup2FA);
router.post('/2fa/verify', vendorSecurityController.verify2FA);
router.post('/2fa/disable', vendorSecurityController.disable2FA);
router.get('/2fa/recovery-codes', vendorSecurityController.getRecoveryCodes);
router.post(
  '/2fa/recovery-codes/regenerate',
  vendorSecurityController.regenerateRecoveryCodes,
);

// --------------------------- API keys -------------------------
router.get('/api-keys', vendorSecurityController.getApiKeys);
router.get('/api-keys/stats', vendorSecurityController.getApiKeyStats);
router.post('/api-keys', vendorSecurityController.createApiKey);
router.post('/api-keys/:keyId/regenerate', vendorSecurityController.regenerateApiKey);
router.delete('/api-keys/:keyId', vendorSecurityController.revokeApiKey);

module.exports = router;
