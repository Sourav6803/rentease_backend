const mongoose = require('mongoose');
const crypto = require('crypto');

const apiKeySchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  key: { type: String, unique: true, required: true, index: true },
  secret: { type: String, required: true, select: false },
  permissions: [{ type: String }],
  rateLimit: {
    enabled: { type: Boolean, default: false },
    limit: { type: Number, default: 100 },
    window: { type: Number, default: 60 }
  },
  allowedIPs: [{ type: String }],
  allowedDomains: [{ type: String }],
  expiresAt: { type: Date, index: true },
  lastUsedAt: Date,
  usageCount: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'revoked', 'expired'], default: 'active', index: true },
  createdBy: {
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

apiKeySchema.index({ status: 1, createdAt: -1 });
apiKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

apiKeySchema.pre('save', function(next) {
  if (this.isNew && !this.key) {
    this.key = crypto.randomBytes(24).toString('hex');
  }
  if (this.isNew && !this.secret) {
    this.secret = crypto.randomBytes(32).toString('hex');
  }
  next();
});

const ApiKey = mongoose.model('ApiKey', apiKeySchema);
module.exports = ApiKey;
