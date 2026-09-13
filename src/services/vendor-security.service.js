/**
 * services/vendor-security.service.js
 *
 * Backing service for the vendor Security Centre
 * (app/(vendor)/vendor/security/*).
 *
 * Everything here is scoped to the authenticated user / their vendor document.
 * The module owns four concerns:
 *   1. the security overview + computed security score
 *   2. real TOTP two-factor authentication (setup / verify / disable / recovery)
 *   3. session + login-activity + security-log read models
 *   4. vendor-scoped API key lifecycle
 */

const bcrypt = require('bcrypt');
const QRCode = require('qrcode');
const mongoose = require('mongoose');

const {
  User,
  Vendor,
  VendorApiKey,
  SecurityEvent,
} = require('../models');

const AppError = require('../utils/AppError');
const logger = require('../config/logger');
const totp = require('../utils/totp');
const { parseUserAgent, UNKNOWN } = require('../utils/device');

const RECOVERY_CODE_COUNT = 8;
const LOGIN_HISTORY_LIMIT = 50;
const BCRYPT_ROUNDS = 10;

const KEY_PERMISSIONS = ['read', 'write', 'admin'];
const DEFAULT_KEY_PERMISSIONS = ['read'];

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function clampInt(value, fallback, min, max) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function buildDateFilter(startDate, endDate) {
  const range = {};
  if (startDate) {
    const from = new Date(startDate);
    if (!Number.isNaN(from.getTime())) range.$gte = from;
  }
  if (endDate) {
    const to = new Date(endDate);
    if (!Number.isNaN(to.getTime())) {
      // A bare date should include the whole day.
      to.setHours(23, 59, 59, 999);
      range.$lte = to;
    }
  }
  return Object.keys(range).length ? range : null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function daysBetween(from, to = new Date()) {
  if (!from) return null;
  return Math.floor((to.getTime() - new Date(from).getTime()) / (24 * 60 * 60 * 1000));
}

class VendorSecurityService {
  /* ================================================================ */
  /* shared lookups                                                    */
  /* ================================================================ */

  /**
   * Resolve the caller's Vendor document id (used to tag security events).
   * Never throws — a user without a vendor row still gets the user-level
   * security features.
   */
  async resolveVendorId(userId) {
    try {
      const vendor = await Vendor.findOne({ user: userId }).select('_id').lean();
      return vendor ? vendor._id : null;
    } catch (error) {
      logger.error('Error in resolveVendorId:', error);
      return null;
    }
  }

  /**
   * Fire-and-forget security audit write. Auditing must never break the
   * request that produced it.
   */
  async recordEvent(userId, event) {
    try {
      const vendor = event.vendor || (await this.resolveVendorId(userId));
      return await SecurityEvent.record({ user: userId, vendor, ...event });
    } catch (error) {
      logger.error('Error in recordEvent:', error);
      return null;
    }
  }

  /**
   * Append an entry to the rolling login history (called from the auth flow).
   * Implemented as an atomic $push + $slice so it can never grow unbounded and
   * can never clobber sibling `security.*` fields on save().
   */
  async recordLoginHistory(userId, entry = {}) {
    try {
      const ua = parseUserAgent(entry.userAgent);
      const record = {
        ip: entry.ip || null,
        userAgent: entry.userAgent || null,
        device: ua.device,
        browser: ua.browser,
        os: ua.os,
        status: entry.status === 'failed' ? 'failed' : 'success',
        reason: entry.reason || null,
        twoFactorUsed: Boolean(entry.twoFactorUsed),
        timestamp: entry.timestamp || new Date(),
      };

      await User.updateOne(
        { _id: userId },
        {
          $push: {
            'security.loginHistory': {
              $each: [record],
              $slice: -LOGIN_HISTORY_LIMIT,
            },
          },
        },
      );

      return record;
    } catch (error) {
      logger.error('Error in recordLoginHistory:', error);
      return null;
    }
  }

  /* ================================================================ */
  /* 1. overview                                                       */
  /* ================================================================ */

  /**
   * Security overview for the landing tab: live status cards, a deterministic
   * security score, and the most recent events.
   */
  async getOverview(userId) {
    try {
      const user = await User.findById(userId).select(
        'email profile security stats updatedAt',
      );

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const security = user.security || {};
      const now = new Date();

      const activeSessions = (security.refreshTokens || []).filter(
        (token) => token.expiresAt && token.expiresAt > now,
      );

      const loginHistory = [...(security.loginHistory || [])].sort(
        (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
      );

      const lastSuccessfulLogin =
        loginHistory.find((entry) => entry.status === 'success') || null;

      const failedLast7Days = loginHistory.filter(
        (entry) =>
          entry.status === 'failed' &&
          daysBetween(entry.timestamp) !== null &&
          daysBetween(entry.timestamp) <= 7,
      ).length;

      const twoFactorConfigured = Boolean(
        security.twoFactorEnabled && security.twoFactorSecret,
      );
      const lastPasswordChange = security.passwordLastChanged || null;
      const passwordAgeDays = daysBetween(lastPasswordChange);
      const loginAlertsEnabled = security.securityAlerts?.loginAlerts !== false;
      const deviceTrustEnabled = security.securityAlerts?.deviceTrust === true;
      const trustedDevicesCount = (security.trustedDevices || []).length;

      const [activeApiKeys, lastUsedApiKey] = await Promise.all([
        VendorApiKey.countDocuments({ user: userId, status: 'active' }),
        VendorApiKey.findOne({ user: userId, lastUsedAt: { $ne: null } })
          .sort({ lastUsedAt: -1 })
          .select('lastUsedAt')
          .lean(),
      ]);

      // Deterministic, explainable score — every component is reported back so
      // the UI can tell the vendor exactly what is missing.
      const breakdown = [
        { id: 'baseline', label: 'Account secured with a password', points: 30, earned: 30 },
        {
          id: '2fa',
          label: 'Two-factor authentication enabled',
          points: 35,
          earned: twoFactorConfigured ? 35 : 0,
        },
        {
          id: 'password_age',
          label: 'Password changed in the last 180 days',
          points: 15,
          earned:
            passwordAgeDays !== null && passwordAgeDays <= 180 ? 15 : 0,
        },
        {
          id: 'login_alerts',
          label: 'Login alerts enabled',
          points: 10,
          earned: loginAlertsEnabled ? 10 : 0,
        },
        {
          id: 'recent_failures',
          label: 'No failed logins in the last 7 days',
          points: 10,
          earned: failedLast7Days === 0 ? 10 : 0,
        },
      ];

      const securityScore = breakdown.reduce((sum, item) => sum + item.earned, 0);

      const recentActivities = await SecurityEvent.find({ user: userId })
        .sort({ timestamp: -1 })
        .limit(5)
        .lean();

      return {
        twoFactorEnabled: Boolean(security.twoFactorEnabled),
        // Distinguishes "flag on but never finished setup" from a real setup,
        // which matters because only a real setup is enforced at login.
        twoFactorConfigured,
        lastPasswordChange,
        passwordAgeDays,
        lastLogin: {
          date: user.stats?.lastLogin || lastSuccessfulLogin?.timestamp || null,
          ip: lastSuccessfulLogin?.ip || null,
          device: lastSuccessfulLogin?.device || null,
          location: null, // no GeoIP in this deployment — never fabricated
        },
        activeSessions: activeSessions.length,
        trustedDevices: trustedDevicesCount,
        activeApiKeys,
        lastApiKeyUsedAt: lastUsedApiKey?.lastUsedAt || null,
        loginAlertsEnabled,
        deviceTrustEnabled,
        failedLoginsLast7Days: failedLast7Days,
        securityScore,
        scoreBreakdown: breakdown,
        recentActivities: recentActivities.map((event) => ({
          id: event._id.toString(),
          type: event.type,
          action: event.action,
          severity: event.severity,
          device: event.device || UNKNOWN,
          ip: event.ip || '',
          location: event.location || 'Unknown',
          status: event.severity === 'info' ? 'success' : 'failed',
          timestamp: event.timestamp,
        })),
      };
    } catch (error) {
      logger.error('Error in getOverview:', error);
      throw error;
    }
  }

  /**
   * Full merged activity timeline (security events + login history), used by
   * the overview "view all" affordance.
   */
  async getActivity(userId, limit = 20) {
    try {
      const safeLimit = clampInt(limit, 20, 1, 100);

      // Sourced from SecurityEvent only. Logins are written there as well
      // (auth.service emits `login` / `failed_login`), so merging the raw
      // loginHistory on top would render every login twice. The dedicated
      // /login-activity endpoint serves the raw history.
      const events = await SecurityEvent.find({ user: userId })
        .sort({ timestamp: -1 })
        .limit(safeLimit)
        .lean();

      return {
        activities: events.map((event) => ({
          id: event._id.toString(),
          type: event.type,
          action: event.action,
          severity: event.severity,
          device: event.device || UNKNOWN,
          ip: event.ip || '',
          location: event.location || 'Unknown',
          status: event.severity === 'info' ? 'success' : 'failed',
          timestamp: event.timestamp,
        })),
      };
    } catch (error) {
      logger.error('Error in getActivity:', error);
      throw error;
    }
  }

  /* ================================================================ */
  /* 2. sessions + login activity                                      */
  /* ================================================================ */

  /**
   * Active sessions, derived from the refresh tokens the auth flow stores.
   */
  async getSessions(
    userId,
    { sessionId: currentSessionId = null, userAgent = '', ip = '' } = {},
  ) {
    try {
      const user = await User.findById(userId).select('security.refreshTokens');

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const now = new Date();

      const active = (user.security?.refreshTokens || []).filter(
        (token) => token.expiresAt && token.expiresAt > now,
      );

      const hasStoredSessionIds = active.some((token) => Boolean(token.sessionId));

      const sessions = active
        .map((token, index) => {
          const ua = parseUserAgent(token.userAgent || token.deviceInfo);

          // NEVER derive the id from the start of the token: a refresh token is
          // a JWT, so every one of them begins with the same base64 header
          // ("eyJhbGciOi…"). That made every session share one id — which broke
          // "current session" detection and produced duplicate React keys.
          const identifier =
            token.sessionId ||
            (token._id ? `sess-${String(token._id)}` : null) ||
            `sess-${index}-${String(token.token || '').slice(-10)}`;

          // Exact match via the shared `sid` claim; device+IP fallback only for
          // legacy rows that predate the claim.
          const isCurrent = hasStoredSessionIds
            ? Boolean(currentSessionId && token.sessionId === currentSessionId)
            : Boolean(
                userAgent &&
                  (token.userAgent || token.deviceInfo) === userAgent &&
                  (token.ipAddress || '') === (ip || ''),
              );

          return {
            id: identifier,
            sessionId: token.sessionId || null,
            device: ua.device,
            deviceType: ua.deviceType,
            browser: ua.browser,
            os: ua.os,
            ip: token.ipAddress || '',
            location: 'Unknown',
            lastActive: token.createdAt || token.expiresAt,
            createdAt: token.createdAt,
            expiresAt: token.expiresAt,
            isCurrent,
            status: 'active',
          };
        })
        .sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));

      // Legacy fallback can match several rows; only the newest is really "now".
      if (!hasStoredSessionIds) {
        const firstCurrent = sessions.findIndex((session) => session.isCurrent);
        sessions.forEach((session, index) => {
          if (session.isCurrent && index !== firstCurrent) {
            session.isCurrent = false;
          }
        });
      }

      return { sessions };
    } catch (error) {
      logger.error('Error in getSessions:', error);
      throw error;
    }
  }

  /**
   * Revoke one session by its short identifier (first 10 chars of the token).
   */
  async revokeSession(userId, sessionId, context = {}) {
    try {
      if (!sessionId) {
        throw new AppError('Session ID is required', 400);
      }

      const raw = String(sessionId).trim();
      const subDocumentId = raw.startsWith('sess-') ? raw.slice(5) : null;

      const user = await User.findById(userId).select('security.refreshTokens');

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const target = (user.security?.refreshTokens || []).find(
        (token) =>
          (token.sessionId && token.sessionId === raw) ||
          (token._id && String(token._id) === (subDocumentId || raw)),
      );

      if (!target) {
        throw new AppError('Session not found', 404);
      }

      // Match on the subdocument id when available so the removal can never
      // take out a sibling session.
      await User.updateOne(
        { _id: userId },
        {
          $pull: {
            'security.refreshTokens': target._id
              ? { _id: target._id }
              : { token: target.token },
          },
        },
      );

      const ua = parseUserAgent(target.userAgent || target.deviceInfo);

      await this.recordEvent(userId, {
        type: 'session_revoked',
        action: 'Signed out of a device session',
        severity: 'info',
        ip: context.ip,
        userAgent: context.userAgent,
        device: ua.device,
        details: { ip: target.ipAddress || null, device: ua.device },
      });

      return { message: 'Session revoked successfully' };
    } catch (error) {
      logger.error('Error in revokeSession:', error);
      throw error;
    }
  }

  /**
   * Revoke every session ("Log out all devices").
   */
  async revokeAllSessions(userId, context = {}) {
    try {
      await User.updateOne(
        { _id: userId },
        { $set: { 'security.refreshTokens': [] } },
      );

      await this.recordEvent(userId, {
        type: 'logout_all',
        action: 'Signed out of all devices',
        severity: 'warning',
        ip: context.ip,
        userAgent: context.userAgent,
        device: parseUserAgent(context.userAgent).device,
      });

      return { message: 'Logged out from all devices' };
    } catch (error) {
      logger.error('Error in revokeAllSessions:', error);
      throw error;
    }
  }

  /**
   * Paginated login history (successful + failed attempts).
   */
  async getLoginActivity(userId, { page = 1, limit = 10, status } = {}) {
    try {
      const safePage = clampInt(page, 1, 1, 10000);
      const safeLimit = clampInt(limit, 10, 1, 100);

      const user = await User.findById(userId).select('security.loginHistory');

      if (!user) {
        throw new AppError('User not found', 404);
      }

      let entries = [...(user.security?.loginHistory || [])];

      if (status === 'success' || status === 'failed') {
        entries = entries.filter((entry) => entry.status === status);
      }

      entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      const total = entries.length;
      const start = (safePage - 1) * safeLimit;

      // The index keeps ids unique even when two attempts share a timestamp.
      const history = entries.slice(start, start + safeLimit).map((entry, index) => ({
        id: `${new Date(entry.timestamp).getTime()}-${start + index}`,
        date: entry.timestamp,
        device: entry.device || UNKNOWN,
        browser: entry.browser || UNKNOWN,
        os: entry.os || UNKNOWN,
        ip: entry.ip || '',
        location: 'Unknown',
        status: entry.status,
        reason: entry.reason || null,
        twoFactorUsed: Boolean(entry.twoFactorUsed),
      }));

      return {
        history,
        summary: {
          total,
          success: entries.filter((entry) => entry.status === 'success').length,
          failed: entries.filter((entry) => entry.status === 'failed').length,
        },
        pagination: {
          page: safePage,
          limit: safeLimit,
          total,
          totalPages: Math.max(1, Math.ceil(total / safeLimit)),
        },
      };
    } catch (error) {
      logger.error('Error in getLoginActivity:', error);
      throw error;
    }
  }

  /* ================================================================ */
  /* 3. security logs                                                  */
  /* ================================================================ */

  buildSecurityLogQuery(userId, filters = {}) {
    const query = { user: userId };

    if (filters.type && filters.type !== 'all') {
      // Accepts a single type or a comma-separated group (the UI's "2FA Events"
      // filter spans 2fa_enabled + 2fa_disabled + 2fa_failed).
      const types = String(filters.type)
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);

      if (types.length > 1) {
        query.type = { $in: types };
      } else if (types.length === 1) {
        query.type = types[0];
      }
    }

    if (filters.severity && filters.severity !== 'all') {
      query.severity = filters.severity;
    }

    const range = buildDateFilter(filters.startDate, filters.endDate);
    if (range) {
      query.timestamp = range;
    }

    if (filters.search) {
      const term = new RegExp(escapeRegex(filters.search), 'i');
      query.$or = [
        { action: term },
        { ip: term },
        { device: term },
        { type: term },
      ];
    }

    return query;
  }

  async getSecurityLogs(userId, filters = {}) {
    try {
      const page = clampInt(filters.page, 1, 1, 10000);
      const limit = clampInt(filters.limit, 10, 1, 100);
      const query = this.buildSecurityLogQuery(userId, filters);

      const [logs, total] = await Promise.all([
        SecurityEvent.find(query)
          .sort({ timestamp: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        SecurityEvent.countDocuments(query),
      ]);

      // Stats describe the whole trail, not just the current page.
      const [totalEvents, critical, warning, info] = await Promise.all([
        SecurityEvent.countDocuments({ user: userId }),
        SecurityEvent.countDocuments({ user: userId, severity: 'critical' }),
        SecurityEvent.countDocuments({ user: userId, severity: 'warning' }),
        SecurityEvent.countDocuments({ user: userId, severity: 'info' }),
      ]);

      return {
        logs: logs.map((event) => ({
          id: event._id.toString(),
          type: event.type,
          action: event.action,
          severity: event.severity,
          ip: event.ip || '',
          location: event.location || 'Unknown',
          device: event.device || UNKNOWN,
          userAgent: event.userAgent || '',
          timestamp: event.timestamp,
          details: event.details || {},
        })),
        stats: { total: totalEvents, critical, warning, info },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      };
    } catch (error) {
      logger.error('Error in getSecurityLogs:', error);
      throw error;
    }
  }

  /**
   * CSV export of the same filtered trail.
   */
  async exportSecurityLogs(userId, filters = {}) {
    try {
      const query = this.buildSecurityLogQuery(userId, filters);

      const logs = await SecurityEvent.find(query)
        .sort({ timestamp: -1 })
        .limit(5000)
        .lean();

      const header = [
        'Timestamp',
        'Event Type',
        'Action',
        'Severity',
        'IP Address',
        'Location',
        'Device',
        'Details',
      ];

      const escapeCsv = (value) => {
        const text = value === null || value === undefined ? '' : String(value);
        return `"${text.replace(/"/g, '""')}"`;
      };

      const rows = logs.map((event) =>
        [
          event.timestamp ? new Date(event.timestamp).toISOString() : '',
          event.type,
          event.action,
          event.severity,
          event.ip || '',
          event.location || 'Unknown',
          event.device || UNKNOWN,
          JSON.stringify(event.details || {}),
        ]
          .map(escapeCsv)
          .join(','),
      );

      return [header.map(escapeCsv).join(','), ...rows].join('\n');
    } catch (error) {
      logger.error('Error in exportSecurityLogs:', error);
      throw error;
    }
  }

  /* ================================================================ */
  /* 4. two-factor authentication (real TOTP)                          */
  /* ================================================================ */

  /**
   * Step 1 — generate a candidate secret + QR code. Nothing is enabled yet and
   * the live secret (if any) is left untouched.
   */
  async beginTwoFactorSetup(userId) {
    try {
      const user = await User.findById(userId).select(
        'email +security.twoFactorPendingSecret',
      );

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const secret = totp.generateSecret();
      const accountName = user.email || String(userId);
      const otpauthUrl = totp.buildOtpAuthUrl({ secret, accountName });

      const qrCode = await QRCode.toDataURL(otpauthUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 240,
      });

      await User.updateOne(
        { _id: userId },
        { $set: { 'security.twoFactorPendingSecret': secret } },
      );

      // Never log or return the pending secret beyond this payload.
      return {
        secret,
        otpauthUrl,
        qrCode,
        // Grouped for manual entry, 4 characters at a time.
        secretFormatted: secret.match(/.{1,4}/g)?.join(' ') || secret,
      };
    } catch (error) {
      logger.error('Error in beginTwoFactorSetup:', error);
      throw error;
    }
  }

  /**
   * Step 2 — prove possession of the authenticator, promote the secret and
   * hand back the one-time recovery codes.
   */
  async verifyTwoFactorSetup(userId, code, context = {}) {
    try {
      const user = await User.findById(userId).select(
        '+security.twoFactorPendingSecret +security.twoFactorRecoveryCodes',
      );

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const pendingSecret = user.security?.twoFactorPendingSecret;

      if (!pendingSecret) {
        throw new AppError(
          'No two-factor setup is in progress. Start the setup again.',
          400,
        );
      }

      if (!totp.verifyTOTP(code, pendingSecret)) {
        await this.recordEvent(userId, {
          type: '2fa_failed',
          action: 'Invalid code during two-factor setup',
          severity: 'warning',
          ip: context.ip,
          userAgent: context.userAgent,
          device: parseUserAgent(context.userAgent).device,
        });

        throw new AppError('Invalid verification code. Please try again.', 400);
      }

      const plainRecoveryCodes = totp.generateRecoveryCodes(RECOVERY_CODE_COUNT);
      const hashedCodes = await Promise.all(
        plainRecoveryCodes.map(async (recoveryCode) => ({
          hash: await bcrypt.hash(recoveryCode, BCRYPT_ROUNDS),
          usedAt: null,
        })),
      );

      await User.updateOne(
        { _id: userId },
        {
          $set: {
            'security.twoFactorEnabled': true,
            'security.twoFactorSecret': pendingSecret,
            'security.twoFactorEnabledAt': new Date(),
            'security.twoFactorRecoveryCodes': hashedCodes,
          },
          $unset: { 'security.twoFactorPendingSecret': '' },
        },
      );

      await this.recordEvent(userId, {
        type: '2fa_enabled',
        action: 'Two-factor authentication enabled',
        severity: 'info',
        ip: context.ip,
        userAgent: context.userAgent,
        device: parseUserAgent(context.userAgent).device,
        details: { method: 'authenticator_app', recoveryCodes: RECOVERY_CODE_COUNT },
      });

      return {
        enabled: true,
        // Returned exactly once — only hashes are stored.
        recoveryCodes: plainRecoveryCodes,
      };
    } catch (error) {
      logger.error('Error in verifyTwoFactorSetup:', error);
      throw error;
    }
  }

  /**
   * Disable 2FA. Requires the account password, plus a valid second factor when
   * one is already configured (so a stolen session alone cannot disable it).
   */
  async disableTwoFactor(userId, { password, token } = {}, context = {}) {
    try {
      const user = await User.findById(userId).select(
        '+password +security.twoFactorSecret +security.twoFactorRecoveryCodes',
      );

      if (!user) {
        throw new AppError('User not found', 404);
      }

      if (!password) {
        throw new AppError('Password is required to disable two-factor authentication', 400);
      }

      const passwordMatches = await user.comparePassword(password);
      if (!passwordMatches) {
        throw new AppError('Incorrect password', 401);
      }

      const configured = Boolean(
        user.security?.twoFactorEnabled && user.security?.twoFactorSecret,
      );

      if (!configured) {
        throw new AppError('Two-factor authentication is not enabled', 400);
      }

      if (!token) {
        throw new AppError('A current authentication code is required', 400);
      }

      const verification = await this.verifySecondFactor(user, token);

      if (!verification.valid) {
        await this.recordEvent(userId, {
          type: '2fa_failed',
          action: 'Invalid code supplied while disabling 2FA',
          severity: 'warning',
          ip: context.ip,
          userAgent: context.userAgent,
          device: parseUserAgent(context.userAgent).device,
        });

        throw new AppError('Invalid authentication code', 401);
      }

      await User.updateOne(
        { _id: userId },
        {
          $set: {
            'security.twoFactorEnabled': false,
            'security.twoFactorEnabledAt': null,
            'security.twoFactorRecoveryCodes': [],
          },
          $unset: {
            'security.twoFactorSecret': '',
            'security.twoFactorPendingSecret': '',
          },
        },
      );

      await this.recordEvent(userId, {
        type: '2fa_disabled',
        action: 'Two-factor authentication disabled',
        severity: 'critical',
        ip: context.ip,
        userAgent: context.userAgent,
        device: parseUserAgent(context.userAgent).device,
      });

      return { enabled: false };
    } catch (error) {
      logger.error('Error in disableTwoFactor:', error);
      throw error;
    }
  }

  /**
   * How many recovery codes are still unused.
   */
  async getRecoveryCodesStatus(userId) {
    try {
      const user = await User.findById(userId).select(
        '+security.twoFactorRecoveryCodes',
      );

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const codes = user.security?.twoFactorRecoveryCodes || [];

      return {
        total: codes.length,
        remaining: codes.filter((entry) => !entry.usedAt).length,
      };
    } catch (error) {
      logger.error('Error in getRecoveryCodesStatus:', error);
      throw error;
    }
  }

  /**
   * Issue a fresh set of recovery codes (invalidates the previous ones).
   */
  async regenerateRecoveryCodes(userId, password, context = {}) {
    try {
      const user = await User.findById(userId).select('+password');

      if (!user) {
        throw new AppError('User not found', 404);
      }

      if (!password) {
        throw new AppError('Password is required', 400);
      }

      const passwordMatches = await user.comparePassword(password);
      if (!passwordMatches) {
        throw new AppError('Incorrect password', 401);
      }

      const plainRecoveryCodes = totp.generateRecoveryCodes(RECOVERY_CODE_COUNT);
      const hashedCodes = await Promise.all(
        plainRecoveryCodes.map(async (recoveryCode) => ({
          hash: await bcrypt.hash(recoveryCode, BCRYPT_ROUNDS),
          usedAt: null,
        })),
      );

      await User.updateOne(
        { _id: userId },
        { $set: { 'security.twoFactorRecoveryCodes': hashedCodes } },
      );

      await this.recordEvent(userId, {
        type: 'recovery_codes_regenerated',
        action: 'Recovery codes regenerated',
        severity: 'warning',
        ip: context.ip,
        userAgent: context.userAgent,
        device: parseUserAgent(context.userAgent).device,
      });

      return { recoveryCodes: plainRecoveryCodes };
    } catch (error) {
      logger.error('Error in regenerateRecoveryCodes:', error);
      throw error;
    }
  }

  /**
   * Verify a TOTP code or a one-time recovery code.
   * Requires `security.twoFactorSecret` / `security.twoFactorRecoveryCodes` to
   * have been selected on the passed document.
   */
  async verifySecondFactor(user, code) {
    const security = user?.security || {};
    const supplied = String(code || '').trim().toUpperCase();

    if (!supplied) {
      return { valid: false, method: null };
    }

    if (security.twoFactorSecret && totp.verifyTOTP(code, security.twoFactorSecret)) {
      return { valid: true, method: 'totp' };
    }

    const unusedCodes = (security.twoFactorRecoveryCodes || []).filter(
      (entry) => !entry.usedAt,
    );

    for (const entry of unusedCodes) {
      try {
        // eslint-disable-next-line no-await-in-loop
        if (await bcrypt.compare(supplied, entry.hash)) {
          entry.usedAt = new Date();
          user.markModified('security.twoFactorRecoveryCodes');
          // eslint-disable-next-line no-await-in-loop
          await user.save();

          return { valid: true, method: 'recovery_code' };
        }
      } catch {
        /* ignore a malformed stored hash and keep checking */
      }
    }

    return { valid: false, method: null };
  }

  /**
   * Called by the login flow. Throws with a machine-readable `errors.code` when
   * a configured account does not present a valid second factor.
   *
   * IMPORTANT: enforcement only applies when 2FA is *fully configured*
   * (enabled AND a secret exists). Accounts that only ever had the legacy
   * `twoFactorEnabled` flag flipped can still log in — otherwise enabling the
   * flag through the old settings endpoint would lock users out.
   */
  async requireSecondFactor(user, code) {
    const security = user?.security || {};
    const configured = Boolean(
      security.twoFactorEnabled && security.twoFactorSecret,
    );

    if (!configured) {
      return { required: false, used: false, method: null };
    }

    if (!code) {
      throw new AppError('Two-factor authentication code required', 401, {
        code: 'TWO_FACTOR_REQUIRED',
      });
    }

    const verification = await this.verifySecondFactor(user, code);

    if (!verification.valid) {
      throw new AppError('Invalid two-factor authentication code', 401, {
        code: 'TWO_FACTOR_INVALID',
      });
    }

    return { required: true, used: true, method: verification.method };
  }

  /* ================================================================ */
  /* 5. preferences + trusted devices                                  */
  /* ================================================================ */

  async updatePreferences(userId, data = {}, context = {}) {
    try {
      const update = {};

      if (data.loginAlerts !== undefined) {
        update['security.securityAlerts.loginAlerts'] = Boolean(data.loginAlerts);
      }

      if (data.deviceTrust !== undefined) {
        update['security.securityAlerts.deviceTrust'] = Boolean(data.deviceTrust);
      }

      if (!Object.keys(update).length) {
        throw new AppError('No supported security preference supplied', 400);
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { $set: update },
        { new: true },
      ).select('security.securityAlerts');

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const alerts = user.security?.securityAlerts || {};

      await this.recordEvent(userId, {
        type: 'settings_change',
        action: 'Security preferences updated',
        severity: 'info',
        ip: context.ip,
        userAgent: context.userAgent,
        device: parseUserAgent(context.userAgent).device,
        details: { changes: Object.keys(update) },
      });

      return {
        loginAlerts: alerts.loginAlerts !== false,
        deviceTrust: alerts.deviceTrust === true,
      };
    } catch (error) {
      logger.error('Error in updatePreferences:', error);
      throw error;
    }
  }

  async listTrustedDevices(userId) {
    try {
      const user = await User.findById(userId).select('security.trustedDevices');

      if (!user) {
        throw new AppError('User not found', 404);
      }

      const devices = (user.security?.trustedDevices || [])
        .slice()
        .sort((a, b) => new Date(b.lastUsedAt || b.createdAt) - new Date(a.lastUsedAt || a.createdAt))
        .map((entry) => ({
          id: entry.deviceId || `${entry.createdAt}-${entry.name}`,
          deviceId: entry.deviceId,
          name: entry.name || UNKNOWN,
          ip: entry.ipAddress || '',
          lastUsed: entry.lastUsedAt || entry.createdAt,
          createdAt: entry.createdAt,
        }));

      return { devices };
    } catch (error) {
      logger.error('Error in listTrustedDevices:', error);
      throw error;
    }
  }

  async revokeTrustedDevice(userId, deviceId, context = {}) {
    try {
      if (!deviceId) {
        throw new AppError('Device id is required', 400);
      }

      const result = await User.updateOne(
        { _id: userId },
        { $pull: { 'security.trustedDevices': { deviceId } } },
      );

      if (!result.modifiedCount) {
        throw new AppError('Trusted device not found', 404);
      }

      await this.recordEvent(userId, {
        type: 'settings_change',
        action: 'Trusted device removed',
        severity: 'warning',
        ip: context.ip,
        userAgent: context.userAgent,
        device: parseUserAgent(context.userAgent).device,
        details: { deviceId },
      });

      return { message: 'Trusted device removed' };
    } catch (error) {
      logger.error('Error in revokeTrustedDevice:', error);
      throw error;
    }
  }

  /* ================================================================ */
  /* 6. vendor API keys                                                */
  /* ================================================================ */

  computeKeyExpiry(expiresIn) {
    if (expiresIn === undefined || expiresIn === null || expiresIn === '' || expiresIn === 'never') {
      return null;
    }

    const days = parseInt(expiresIn, 10);
    if (Number.isNaN(days) || days <= 0) {
      throw new AppError('Invalid key expiry', 400);
    }

    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  normalisePermissions(permissions) {
    if (!Array.isArray(permissions) || permissions.length === 0) {
      return [...DEFAULT_KEY_PERMISSIONS];
    }

    const cleaned = [...new Set(permissions)].filter((permission) =>
      KEY_PERMISSIONS.includes(permission),
    );

    if (!cleaned.length) {
      throw new AppError(
        `Permissions must be one of: ${KEY_PERMISSIONS.join(', ')}`,
        400,
      );
    }

    return cleaned;
  }

  normaliseAllowedIPs(allowedIPs) {
    if (allowedIPs === undefined || allowedIPs === null) {
      return [];
    }

    const list = Array.isArray(allowedIPs)
      ? allowedIPs
      : String(allowedIPs)
          .split(',')
          .map((entry) => entry.trim());

    const cleaned = list.map((entry) => String(entry).trim()).filter(Boolean);

    const ipPattern =
      /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^[0-9a-fA-F:]+(\/\d{1,3})?$/;

    const invalid = cleaned.filter((entry) => !ipPattern.test(entry));

    if (invalid.length) {
      throw new AppError(`Invalid IP address: ${invalid.join(', ')}`, 400);
    }

    return cleaned;
  }

  async listApiKeys(userId) {
    try {
      const keys = await VendorApiKey.find({ user: userId }).sort({ createdAt: -1 });
      return { apiKeys: keys.map((key) => key.toClientJSON()) };
    } catch (error) {
      logger.error('Error in listApiKeys:', error);
      throw error;
    }
  }

  async getApiKeyStats(userId) {
    try {
      const keys = await VendorApiKey.find({ user: userId });

      const now = Date.now();
      const isLive = (key) =>
        key.status === 'active' && !(key.expiresAt && key.expiresAt.getTime() <= now);

      const active = keys.filter(isLive);

      return {
        totalKeys: keys.length,
        activeKeys: active.length,
        revokedKeys: keys.filter((key) => key.status === 'revoked').length,
        expiredKeys: keys.filter(
          (key) => key.status !== 'revoked' && key.expiresAt && key.expiresAt.getTime() <= now,
        ).length,
        totalRequests: keys.reduce((sum, key) => sum + (key.usageCount || 0), 0),
        maxRateLimit: active.reduce(
          (max, key) => Math.max(max, key.rateLimit?.limit || 0),
          0,
        ),
        lastUsedAt: keys.reduce(
          (latest, key) =>
            key.lastUsedAt && (!latest || key.lastUsedAt > latest)
              ? key.lastUsedAt
              : latest,
          null,
        ),
      };
    } catch (error) {
      logger.error('Error in getApiKeyStats:', error);
      throw error;
    }
  }

  async createApiKey(userId, payload = {}, context = {}) {
    try {
      const vendor = await Vendor.findOne({ user: userId })
        .select('_id business.name')
        .lean();

      if (!vendor) {
        throw new AppError('Vendor profile not found for this account.', 403);
      }

      const user = await User.findById(userId)
        .select('email profile.firstName profile.lastName')
        .lean();

      const name = String(payload.name || '').trim();

      if (!name) {
        throw new AppError('API key name is required', 400);
      }

      if (name.length > 100) {
        throw new AppError('API key name must be 100 characters or fewer', 400);
      }

      const permissions = this.normalisePermissions(payload.permissions);
      const allowedIPs = this.normaliseAllowedIPs(payload.allowedIPs);
      const expiresAt = this.computeKeyExpiry(payload.expiresIn);
      const rateLimitValue = clampInt(payload.rateLimit, 1000, 1, 100000);

      const plaintextKey = VendorApiKey.generatePlaintext(
        payload.environment === 'test' ? 'test' : 'live',
      );

      const apiKey = await VendorApiKey.create({
        vendor: vendor._id,
        user: userId,
        name,
        keyPrefix: VendorApiKey.buildPrefix(plaintextKey),
        keyHash: VendorApiKey.hashKey(plaintextKey),
        maskedKey: VendorApiKey.maskKey(plaintextKey),
        permissions,
        rateLimit: { enabled: true, limit: rateLimitValue, window: 60 },
        allowedIPs,
        expiresAt,
        status: 'active',
      });

      await this.recordEvent(userId, {
        type: 'api_key_created',
        action: `API key "${name}" created`,
        severity: 'info',
        ip: context.ip,
        userAgent: context.userAgent,
        device: parseUserAgent(context.userAgent).device,
        details: { keyId: apiKey._id.toString(), permissions, expiresAt },
      });

      return {
        apiKey: apiKey.toClientJSON(),
        // Shown once in the UI and never retrievable again.
        plaintextKey,
      };
    } catch (error) {
      logger.error('Error in createApiKey:', error);
      throw error;
    }
  }

  async findOwnedApiKey(userId, keyId) {
    if (!keyId || !mongoose.isValidObjectId(keyId)) {
      throw new AppError('API key not found', 404);
    }

    const apiKey = await VendorApiKey.findOne({ _id: keyId, user: userId });

    if (!apiKey) {
      throw new AppError('API key not found', 404);
    }

    return apiKey;
  }

  async revokeApiKey(userId, keyId, reason, context = {}) {
    try {
      const apiKey = await this.findOwnedApiKey(userId, keyId);

      if (apiKey.status === 'revoked') {
        return { apiKey: apiKey.toClientJSON() };
      }

      apiKey.status = 'revoked';
      apiKey.revokedAt = new Date();
      apiKey.revokedReason = reason || 'Revoked by vendor';
      await apiKey.save();

      await this.recordEvent(userId, {
        type: 'api_key_revoked',
        action: `API key "${apiKey.name}" revoked`,
        severity: 'warning',
        ip: context.ip,
        userAgent: context.userAgent,
        device: parseUserAgent(context.userAgent).device,
        details: { keyId: apiKey._id.toString(), reason: apiKey.revokedReason },
      });

      return { apiKey: apiKey.toClientJSON() };
    } catch (error) {
      logger.error('Error in revokeApiKey:', error);
      throw error;
    }
  }

  async regenerateApiKey(userId, keyId, context = {}) {
    try {
      const apiKey = await this.findOwnedApiKey(userId, keyId);

      if (apiKey.status === 'revoked') {
        throw new AppError('Cannot regenerate a revoked API key', 400);
      }

      const plaintextKey = VendorApiKey.generatePlaintext(
        apiKey.keyPrefix.includes('_test_') ? 'test' : 'live',
      );

      // The previous secret is destroyed immediately — the old key stops
      // working the moment this returns.
      apiKey.keyPrefix = VendorApiKey.buildPrefix(plaintextKey);
      apiKey.keyHash = VendorApiKey.hashKey(plaintextKey);
      apiKey.maskedKey = VendorApiKey.maskKey(plaintextKey);
      apiKey.rotatedAt = new Date();
      apiKey.lastUsedAt = null;
      apiKey.status = 'active';
      await apiKey.save();

      await this.recordEvent(userId, {
        type: 'api_key_regenerated',
        action: `API key "${apiKey.name}" regenerated`,
        severity: 'warning',
        ip: context.ip,
        userAgent: context.userAgent,
        device: parseUserAgent(context.userAgent).device,
        details: { keyId: apiKey._id.toString() },
      });

      return { apiKey: apiKey.toClientJSON(), plaintextKey };
    } catch (error) {
      logger.error('Error in regenerateApiKey:', error);
      throw error;
    }
  }
}

module.exports = new VendorSecurityService();
module.exports.VendorSecurityService = VendorSecurityService;
module.exports.RECOVERY_CODE_COUNT = RECOVERY_CODE_COUNT;
module.exports.KEY_PERMISSIONS = KEY_PERMISSIONS;
