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
      push: { type: Boolean, default: true }
    }
  },
  // ── Push notification device tokens (FCM / Web Push) ──────────────
  // Flat list of active FCM registration tokens, used for multicast sends.
  pushTokens: [{ type: String, index: true }],
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
  security: {
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: Date,
    refreshTokens: [{
      token: String,
      deviceInfo: String,
      ipAddress: String,
      expiresAt: Date,
      createdAt: Date
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