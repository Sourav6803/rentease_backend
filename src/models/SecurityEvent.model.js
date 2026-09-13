/**
 * models/SecurityEvent.model.js
 *
 * Append-only security audit trail for a user / vendor account, powering the
 * "Security Logs" tab of the vendor Security Centre.
 *
 * Why a new collection rather than reusing models/SystemLog.model.js:
 * SystemLog rows are surfaced exclusively through the admin-only
 * `/admin/logs` endpoints, and (verified) nothing in the codebase currently
 * writes to that collection at all. Writing vendor security events into it
 * would both leave the vendor tab empty and risk leaking into admin views, so
 * the vendor trail lives in its own collection.
 */

const mongoose = require('mongoose');

const SECURITY_EVENT_TYPES = [
  'login',
  'logout',
  'failed_login',
  'password_change',
  '2fa_enabled',
  '2fa_disabled',
  '2fa_failed',
  'recovery_codes_regenerated',
  'session_revoked',
  'logout_all',
  'api_key_created',
  'api_key_revoked',
  'api_key_regenerated',
  'settings_change',
  'security_alert',
];

const SECURITY_SEVERITIES = ['info', 'warning', 'critical'];

const securityEventSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      index: true,
      default: null,
    },
    type: {
      type: String,
      enum: SECURITY_EVENT_TYPES,
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
    },
    severity: {
      type: String,
      enum: SECURITY_SEVERITIES,
      default: 'info',
      index: true,
    },
    ip: { type: String, default: null },
    location: { type: String, default: null },
    device: { type: String, default: null },
    userAgent: { type: String, default: null },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

securityEventSchema.index({ user: 1, timestamp: -1 });
securityEventSchema.index({ user: 1, type: 1, timestamp: -1 });

/**
 * Client shape consumed by the Security Logs table.
 */
securityEventSchema.methods.toClientJSON = function toClientJSON() {
  return {
    id: this._id.toString(),
    type: this.type,
    action: this.action,
    severity: this.severity,
    ip: this.ip || '',
    location: this.location || 'Unknown',
    device: this.device || 'Unknown',
    userAgent: this.userAgent || '',
    timestamp: this.timestamp,
    details: this.details || {},
  };
};

/**
 * Fire-and-forget writer. Auditing must never break the request that produced
 * the event, so every failure is swallowed after being logged.
 */
securityEventSchema.statics.record = async function record(event) {
  try {
    if (!event || !event.user) {
      return null;
    }

    return await this.create({
      user: event.user,
      vendor: event.vendor || null,
      type: event.type,
      action: event.action,
      severity: event.severity || 'info',
      ip: event.ip || null,
      location: event.location || null,
      device: event.device || null,
      userAgent: event.userAgent || null,
      details: event.details || {},
      timestamp: event.timestamp || new Date(),
    });
  } catch (error) {
    // Lazy require avoids a config <-> model import cycle at boot.
    try {
      // eslint-disable-next-line global-require
      require('../config/logger').error(
        'Failed to record security event:',
        error.message,
      );
    } catch {
      /* nothing else we can safely do here */
    }

    return null;
  }
};

const SecurityEvent = mongoose.model('SecurityEvent', securityEventSchema);

module.exports = SecurityEvent;
