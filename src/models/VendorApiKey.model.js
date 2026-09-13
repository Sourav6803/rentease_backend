/**
 * models/VendorApiKey.model.js
 *
 * Vendor-scoped API keys for the vendor Security Centre ("API Access" tab).
 *
 * Why a separate collection instead of extending models/ApiKey.model.js:
 * the existing ApiKey collection backs the admin-only `/admin/api-keys`
 * endpoints. Adding a `vendor` owner to it would make vendor keys show up in
 * every existing admin query, so this stays completely separate — the admin
 * API-key feature is untouched.
 *
 * Security posture:
 *   - the plaintext key is returned EXACTLY ONCE, at creation / regeneration;
 *   - only a SHA-256 hash is persisted (`keyHash`, excluded from queries);
 *   - lookup is prefix-narrowed and then compared with a constant-time check.
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const KEY_ENVIRONMENTS = ['live', 'test'];
const KEY_STATUSES = ['active', 'revoked', 'expired'];
const KEY_PERMISSIONS = ['read', 'write', 'admin'];

/** Length of the `rk_live_xxxxxxxx` searchable prefix. */
const PREFIX_LENGTH = 12;

const vendorApiKeySchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
      index: true,
    },
    // Owning login, kept alongside `vendor` so auditing never needs a join.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'API key name is required'],
      trim: true,
      maxlength: 100,
    },
    keyPrefix: {
      type: String,
      required: true,
      index: true,
    },
    keyHash: {
      type: String,
      required: true,
      select: false,
    },
    maskedKey: {
      type: String,
      required: true,
    },
    permissions: {
      type: [{ type: String, enum: KEY_PERMISSIONS }],
      default: ['read'],
    },
    rateLimit: {
      enabled: { type: Boolean, default: true },
      limit: { type: Number, default: 1000, min: 1 },
      window: { type: Number, default: 60, min: 1 }, // seconds
    },
    allowedIPs: {
      type: [{ type: String, trim: true }],
      default: [],
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
    usageCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: KEY_STATUSES,
      default: 'active',
      index: true,
    },
    revokedAt: Date,
    revokedReason: String,
    rotatedAt: Date,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

vendorApiKeySchema.index({ vendor: 1, status: 1, createdAt: -1 });

/* ------------------------------------------------------------------ */
/* statics                                                             */
/* ------------------------------------------------------------------ */

/**
 * Create a new plaintext key, e.g. `rk_live_9f2c...` (32 hex chars).
 */
vendorApiKeySchema.statics.generatePlaintext = function generatePlaintext(
  environment = 'live',
) {
  const env = KEY_ENVIRONMENTS.includes(environment) ? environment : 'live';
  return `rk_${env}_${crypto.randomBytes(16).toString('hex')}`;
};

vendorApiKeySchema.statics.hashKey = function hashKey(plaintext) {
  return crypto.createHash('sha256').update(String(plaintext)).digest('hex');
};

/**
 * The searchable prefix plus a partially masked form for list screens.
 */
vendorApiKeySchema.statics.buildPrefix = function buildPrefix(plaintext) {
  return String(plaintext).slice(0, PREFIX_LENGTH);
};

vendorApiKeySchema.statics.maskKey = function maskKey(plaintext) {
  const value = String(plaintext);
  return `${value.slice(0, PREFIX_LENGTH)}${'*'.repeat(8)}${value.slice(-4)}`;
};

/**
 * Resolve a presented API key to its document, or null.
 * Only active, non-expired keys are considered.
 */
vendorApiKeySchema.statics.findByPlaintext = async function findByPlaintext(
  plaintext,
) {
  const presented = String(plaintext || '').trim();

  if (!presented) {
    return null;
  }

  const candidates = await this.find({
    keyPrefix: this.buildPrefix(presented),
    status: 'active',
  }).select('+keyHash');

  if (!candidates.length) {
    return null;
  }

  const presentedHash = Buffer.from(this.hashKey(presented), 'hex');

  const match = candidates.find((candidate) => {
    const storedHash = Buffer.from(candidate.keyHash || '', 'hex');

    if (storedHash.length !== presentedHash.length) {
      return false;
    }

    return crypto.timingSafeEqual(storedHash, presentedHash);
  });

  if (!match) {
    return null;
  }

  if (match.expiresAt && match.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return match;
};

/* ------------------------------------------------------------------ */
/* instance helpers                                                    */
/* ------------------------------------------------------------------ */

vendorApiKeySchema.methods.isExpired = function isExpired() {
  return Boolean(this.expiresAt && this.expiresAt.getTime() <= Date.now());
};

/**
 * Client-facing representation. Never exposes the hash, and never exposes a
 * usable key (only the masked form) — the plaintext is shown once, at creation.
 */
vendorApiKeySchema.methods.toClientJSON = function toClientJSON() {
  const expired = this.isExpired();
  const status = expired && this.status === 'active' ? 'expired' : this.status;

  return {
    id: this._id.toString(),
    name: this.name,
    key: this.maskedKey,
    maskedKey: this.maskedKey,
    permissions: this.permissions || [],
    createdAt: this.createdAt,
    lastUsed: this.lastUsedAt,
    expiresAt: this.expiresAt,
    status,
    usageCount: this.usageCount || 0,
    rateLimit: this.rateLimit?.limit ?? 1000,
    allowedIPs: this.allowedIPs || [],
  };
};

const VendorApiKey = mongoose.model('VendorApiKey', vendorApiKeySchema);

module.exports = VendorApiKey;
