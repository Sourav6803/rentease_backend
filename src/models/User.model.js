// models/User.model.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  phone: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  password: {
    type: String,
    required: true,
    select: false
  },
  profile: {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    avatar: { type: String },
    dateOfBirth: Date,
    gender: { type: String, enum: ['male', 'female', 'other'] }
  },
  role: {
    type: String,
    enum: ['user', 'vendor', 'admin', 'super-admin', 'delivery_person', 'delivery_team', 'delivery'],
    default: 'user',
    index: true
  },
  verification: {
    email: { type: Boolean, default: false },
    phone: { type: Boolean, default: false },
    kyc: {
      status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
      aadharNumber: { type: String, select: false },
      panNumber: { type: String, select: false },
      verifiedAt: Date,
      documents: [{
        type: { type: String },
        url: String,
        uploadedAt: Date
      }]
    },
    emailVerificationToken: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },
  },
  addresses: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Address'
  }],
  preferences: {
    language: { type: String, default: 'en' },
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      in_app: { type: Boolean, default: true }
    }
  },
  // ── Push notification device tokens (FCM / Web Push) ──────────────
  // Flat list of active FCM registration tokens, used for multicast sends.
  pushTokens: [{ type: String }],
  // Rich per-device subscription records for metadata + safe cleanup.
  deviceTokens: [{
    token: { type: String, required: true },
    platform: { type: String, enum: ['web', 'android', 'ios'], default: 'web' },
    deviceId: { type: String }, // stable per-device id for de-duplication
    appVersion: { type: String },
    isActive: { type: Boolean, default: true },
    lastUsedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
  }],
  stats: {
    totalRentals: { type: Number, default: 0 },
    activeRentals: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    memberSince: { type: Date, default: Date.now },
    lastActive: Date
  },
  status: {
    isActive: { type: Boolean, default: true, index: true },
    isBlocked: { type: Boolean, default: false },
    deactivationReason: String,
    deactivatedAt: Date
  },
  // security: {
  //   twoFactorEnabled: { type: Boolean, default: false },
  //   twoFactorSecret: { type: String, select: false },
  //   loginAttempts: { type: Number, default: 0 },
  //   lockUntil: Date,
  //   refreshTokens: [{
  //     token: String,
  //     deviceInfo: String,
  //     ipAddress: String,
  //     expiresAt: Date,
  //     createdAt: Date
  //   }]
  // },
  security: {
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: Date,
    // Timestamp of the most recent failed password attempt. login() uses it to
    // decay a stale `loginAttempts` counter, which previously only reset on a
    // fully successful login.
    lastFailedLoginAt: { type: Date },
    refreshTokens: [{
      // `sid` claim shared with the matching access token, so the security
      // centre can identify the caller's own session exactly.
      sessionId: String,
      token: String,
      deviceInfo: String,
      ipAddress: String,
      // auth.service#saveRefreshToken has always written `userAgent`, but the
      // path was missing from the schema so Mongoose (strict mode) dropped it on
      // every save — which is why active sessions showed no device at all.
      userAgent: String,
      device: String,
      browser: String,
      os: String,
      expiresAt: Date,
      createdAt: Date
    }],
    // ✅ Add these missing fields
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    passwordHistory: [{
      password: { type: String, select: false },
      changedAt: Date
    }],
    passwordLastChanged: { type: Date },

    // ------------------------------------------------------------------
    // Two-factor authentication (real TOTP, see utils/totp.js)
    // ------------------------------------------------------------------
    twoFactorEnabledAt: { type: Date },
    // Secret generated during setup, promoted to `twoFactorSecret` only after
    // the user proves possession by submitting a valid code. Keeping it
    // separate means an abandoned setup can never overwrite a live secret.
    twoFactorPendingSecret: { type: String, select: false },
    // Recovery codes are only ever persisted as bcrypt hashes and the whole
    // array is excluded from queries by default.
    twoFactorRecoveryCodes: {
      type: [{
        hash: String,
        usedAt: { type: Date, default: null }
      }],
      select: false,
      default: undefined
    },

    // ------------------------------------------------------------------
    // Security centre: alert preferences, trusted devices, login timeline
    // ------------------------------------------------------------------
    securityAlerts: {
      loginAlerts: { type: Boolean, default: true },
      deviceTrust: { type: Boolean, default: false }
    },
    trustedDevices: [{
      deviceId: String,
      name: String,
      ipAddress: String,
      userAgent: String,
      lastUsedAt: Date,
      createdAt: { type: Date, default: Date.now }
    }],
    // Rolling window of the most recent login attempts. Capped in
    // vendor-security.service so it can never grow unbounded.
    loginHistory: [{
      ip: String,
      userAgent: String,
      device: String,
      browser: String,
      os: String,
      status: { type: String, enum: ['success', 'failed'], default: 'success' },
      reason: String,
      twoFactorUsed: { type: Boolean, default: false },
      timestamp: { type: Date, default: Date.now }
    }]
  },
 
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
}
);


// Indexes
userSchema.index({ 'profile.firstName': 'text', 'profile.lastName': 'text', email: 'text' });
userSchema.index({ 'verification.kyc.status': 1 });
userSchema.index({ role: 1, status: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ pushTokens: 1 });
userSchema.index({ 'deviceTokens.token': 1, 'deviceTokens.isActive': 1 });

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.profile.firstName} ${this.profile.lastName}`;
});

// Pre-save middleware
// userSchema.pre('save', async function(next) {
//   if (!this.isModified('password')) return next();
//   this.password = await bcrypt.hash(this.password, 12);
//   next();
// });

// Methods
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.generateOTP = function() {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

module.exports = mongoose.model('User', userSchema);