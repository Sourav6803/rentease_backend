/**
 * middlewares/vendorApiKey.middleware.js
 *
 * Verifies a vendor-scoped API key presented as
 * `Authorization: Bearer rk_live_...` or `X-API-Key: rk_live_...`.
 *
 * DELIBERATELY NOT ATTACHED TO ANY EXISTING ROUTE.
 * Attaching it would change the auth contract of live endpoints, so it is
 * exported for opt-in use — e.g.
 *
 *   const { authenticateVendorApiKey } = require('../middlewares/vendorApiKey.middleware');
 *   router.get('/partner/products', authenticateVendorApiKey('read'), handler);
 *
 * On success it populates the same request fields the JWT `protect` middleware
 * sets (`req.vendor`, `req.userRole`), so existing vendor handlers work
 * unchanged behind it.
 */

const VendorApiKey = require('../../models/VendorApiKey.model');
const Vendor = require('../../models/Vendor.model');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const { getClientIp } = require('../../utils/device');

/**
 * Read-only HTTP methods only need the `read` permission; everything else
 * requires `write`. Callers can override by passing an explicit permission.
 */
const REQUIRED_PERMISSION_BY_METHOD = {
  GET: 'read',
  HEAD: 'read',
  OPTIONS: 'read',
  POST: 'write',
  PUT: 'write',
  PATCH: 'write',
  DELETE: 'write',
};

function extractPresentedKey(req) {
  const header = req.headers?.authorization || req.headers?.['x-api-key'] || '';
  const value = String(header).trim();

  if (value.toLowerCase().startsWith('bearer ')) {
    return value.slice(7).trim();
  }

  return value;
}

/**
 * @param {'read'|'write'|'admin'} [requiredPermission]
 */
const authenticateVendorApiKey = (requiredPermission) =>
  async function authenticateVendorApiKeyMiddleware(req, res, next) {
    try {
      const presented = extractPresentedKey(req);

      if (!presented) {
        return next(
          new AppError('API key required', 401, { code: 'API_KEY_REQUIRED' }),
        );
      }

      const apiKey = await VendorApiKey.findByPlaintext(presented);

      if (!apiKey) {
        return next(
          new AppError('Invalid, revoked or expired API key', 401, {
            code: 'API_KEY_INVALID',
          }),
        );
      }

      const clientIp = getClientIp(req);

      if (apiKey.allowedIPs?.length && !apiKey.allowedIPs.includes(clientIp)) {
        return next(
          new AppError('Request IP is not allowed for this API key', 403, {
            code: 'API_KEY_IP_BLOCKED',
          }),
        );
      }

      const permission =
        requiredPermission ||
        REQUIRED_PERMISSION_BY_METHOD[req.method] ||
        'read';

      if (!apiKey.permissions?.includes(permission)) {
        return next(
          new AppError(
            `API key does not grant the "${permission}" permission`,
            403,
            { code: 'API_KEY_FORBIDDEN' },
          ),
        );
      }

      const vendor = await Vendor.findById(apiKey.vendor);

      if (!vendor) {
        return next(
          new AppError('Vendor profile not found for this API key', 403, {
            code: 'API_KEY_VENDOR_MISSING',
          }),
        );
      }

      if (!vendor.status?.isActive || vendor.status?.isBlocked) {
        return next(
          new AppError('Vendor account is not active', 403, {
            code: 'API_KEY_VENDOR_INACTIVE',
          }),
        );
      }

      // Usage accounting is best-effort: it must never fail the request.
      VendorApiKey.updateOne(
        { _id: apiKey._id },
        { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
      ).catch((error) => logger.error('API key usage update failed:', error.message));

      req.vendor = vendor;
      req.apiKey = apiKey;
      req.userRole = 'vendor';
      req.authMethod = 'api-key';

      return next();
    } catch (error) {
      logger.error('Vendor API key authentication error:', error);
      return next(error);
    }
  };

module.exports = {
  authenticateVendorApiKey,
  REQUIRED_PERMISSION_BY_METHOD,
};
