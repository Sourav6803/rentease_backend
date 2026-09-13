// controllers/vendor-security.controller.js
//
// HTTP layer for the vendor Security Centre. Every handler is scoped to
// `req.user._id` (the authenticated account) — the vendor document is only used
// for tagging audit events, never for authorisation.

const jwt = require('jsonwebtoken');

const VendorSecurityService = require('../../services/vendor-security.service');
const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const { getClientIp } = require('../../utils/device');

/**
 * Request context attached to every audit event we write.
 */
const auditContext = (req) => ({
  ip: getClientIp(req),
  userAgent: req.get('User-Agent') || '',
});

class VendorSecurityController {
  /* -------------------------- overview -------------------------- */

  getOverview = catchAsync(async (req, res) => {
    const overview = await VendorSecurityService.getOverview(req.user._id);

    return ApiResponse.success(
      res,
      200,
      'Security overview retrieved successfully',
      { overview },
    );
  });

  getActivity = catchAsync(async (req, res) => {
    const activity = await VendorSecurityService.getActivity(
      req.user._id,
      req.query.limit,
    );

    return ApiResponse.success(res, 200, 'Activity retrieved successfully', activity);
  });

  /* -------------------------- sessions -------------------------- */

  getSessions = catchAsync(async (req, res) => {
    // `protect` already verified the access token, so a plain decode is enough
    // to read the shared `sid` claim used to flag the caller's own session.
    const rawToken = req.headers.authorization?.replace('Bearer ', '') || null;
    let sessionId = null;

    if (rawToken) {
      const decoded = jwt.decode(rawToken);
      sessionId = decoded?.sid || null;
    }

    const sessions = await VendorSecurityService.getSessions(req.user._id, {
      sessionId,
      userAgent: req.get('User-Agent') || '',
      ip: getClientIp(req),
    });

    return ApiResponse.success(res, 200, 'Sessions retrieved successfully', sessions);
  });

  revokeSession = catchAsync(async (req, res) => {
    const result = await VendorSecurityService.revokeSession(
      req.user._id,
      req.params.sessionId,
      auditContext(req),
    );

    return ApiResponse.success(res, 200, result.message, result);
  });

  revokeAllSessions = catchAsync(async (req, res) => {
    const result = await VendorSecurityService.revokeAllSessions(
      req.user._id,
      auditContext(req),
    );

    return ApiResponse.success(res, 200, result.message, result);
  });

  getLoginActivity = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, status } = req.query;

    const activity = await VendorSecurityService.getLoginActivity(req.user._id, {
      page,
      limit,
      status,
    });

    return ApiResponse.success(
      res,
      200,
      'Login activity retrieved successfully',
      activity,
    );
  });

  /* ------------------------ security logs ----------------------- */

  getSecurityLogs = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, type, severity, search, startDate, endDate } =
      req.query;

    const logs = await VendorSecurityService.getSecurityLogs(req.user._id, {
      page,
      limit,
      type,
      severity,
      search,
      startDate,
      endDate,
    });

    return ApiResponse.success(res, 200, 'Security logs retrieved successfully', logs);
  });

  exportSecurityLogs = catchAsync(async (req, res) => {
    const { type, severity, search, startDate, endDate } = req.query;

    const csv = await VendorSecurityService.exportSecurityLogs(req.user._id, {
      type,
      severity,
      search,
      startDate,
      endDate,
    });

    const stamp = new Date().toISOString().slice(0, 10);

    return ApiResponse.file(
      res,
      csv,
      'text/csv; charset=utf-8',
      `security-logs-${stamp}.csv`,
    );
  });

  /* ---------------------- preferences -------------------------- */

  getPreferences = catchAsync(async (req, res) => {
    const overview = await VendorSecurityService.getOverview(req.user._id);

    return ApiResponse.success(res, 200, 'Preferences retrieved successfully', {
      preferences: {
        loginAlerts: overview.loginAlertsEnabled,
        deviceTrust: overview.deviceTrustEnabled,
      },
    });
  });

  updatePreferences = catchAsync(async (req, res) => {
    const preferences = await VendorSecurityService.updatePreferences(
      req.user._id,
      req.body,
      auditContext(req),
    );

    return ApiResponse.success(
      res,
      200,
      'Security preferences updated successfully',
      { preferences },
    );
  });

  /* --------------------- trusted devices ----------------------- */

  getTrustedDevices = catchAsync(async (req, res) => {
    const devices = await VendorSecurityService.listTrustedDevices(req.user._id);

    return ApiResponse.success(res, 200, 'Trusted devices retrieved successfully', devices);
  });

  revokeTrustedDevice = catchAsync(async (req, res) => {
    const result = await VendorSecurityService.revokeTrustedDevice(
      req.user._id,
      req.params.deviceId,
      auditContext(req),
    );

    return ApiResponse.success(res, 200, result.message, result);
  });

  /* ------------------- two-factor authentication ---------------- */

  setup2FA = catchAsync(async (req, res) => {
    const setup = await VendorSecurityService.beginTwoFactorSetup(req.user._id);

    return ApiResponse.success(res, 200, 'Two-factor setup started', setup);
  });

  verify2FA = catchAsync(async (req, res) => {
    const { code } = req.body;

    const result = await VendorSecurityService.verifyTwoFactorSetup(
      req.user._id,
      code,
      auditContext(req),
    );

    return ApiResponse.success(
      res,
      200,
      'Two-factor authentication enabled successfully',
      result,
    );
  });

  disable2FA = catchAsync(async (req, res) => {
    const result = await VendorSecurityService.disableTwoFactor(
      req.user._id,
      req.body,
      auditContext(req),
    );

    return ApiResponse.success(
      res,
      200,
      'Two-factor authentication disabled',
      result,
    );
  });

  getRecoveryCodes = catchAsync(async (req, res) => {
    const status = await VendorSecurityService.getRecoveryCodesStatus(req.user._id);

    return ApiResponse.success(res, 200, 'Recovery code status retrieved', status);
  });

  regenerateRecoveryCodes = catchAsync(async (req, res) => {
    const { password } = req.body;

    const result = await VendorSecurityService.regenerateRecoveryCodes(
      req.user._id,
      password,
      auditContext(req),
    );

    return ApiResponse.success(
      res,
      200,
      'Recovery codes regenerated successfully',
      result,
    );
  });

  /* -------------------------- API keys -------------------------- */

  getApiKeys = catchAsync(async (req, res) => {
    const apiKeys = await VendorSecurityService.listApiKeys(req.user._id);

    return ApiResponse.success(res, 200, 'API keys retrieved successfully', apiKeys);
  });

  getApiKeyStats = catchAsync(async (req, res) => {
    const stats = await VendorSecurityService.getApiKeyStats(req.user._id);

    return ApiResponse.success(res, 200, 'API key statistics retrieved', { stats });
  });

  createApiKey = catchAsync(async (req, res) => {
    const result = await VendorSecurityService.createApiKey(
      req.user._id,
      req.body,
      auditContext(req),
    );

    return ApiResponse.created(res, 'API key created successfully', result);
  });

  regenerateApiKey = catchAsync(async (req, res) => {
    const result = await VendorSecurityService.regenerateApiKey(
      req.user._id,
      req.params.keyId,
      auditContext(req),
    );

    return ApiResponse.success(res, 200, 'API key regenerated successfully', result);
  });

  revokeApiKey = catchAsync(async (req, res) => {
    const result = await VendorSecurityService.revokeApiKey(
      req.user._id,
      req.params.keyId,
      req.body?.reason,
      auditContext(req),
    );

    return ApiResponse.success(res, 200, 'API key revoked successfully', result);
  });
}

module.exports = new VendorSecurityController();
