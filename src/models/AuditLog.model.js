const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now,
    // index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'CREATE', 'READ', 'UPDATE', 'DELETE',
      'LOGIN', 'LOGOUT', 'LOGIN_FAILED',
      'PASSWORD_CHANGE', 'PASSWORD_RESET',
      'EMAIL_VERIFY', 'PHONE_VERIFY', 'KYC_SUBMIT', 'KYC_APPROVE', 'KYC_REJECT',
      'ROLE_CHANGE', 'STATUS_CHANGE',
      'PAYMENT_INIT', 'PAYMENT_SUCCESS', 'PAYMENT_FAIL', 'PAYMENT_REFUND',
      'RENTAL_CREATE', 'RENTAL_UPDATE', 'RENTAL_CANCEL', 'RENTAL_EXTEND',
      'DELIVERY_SCHEDULE', 'DELIVERY_STATUS', 'DELIVERY_COMPLETE',
      'MAINTENANCE_REQUEST', 'MAINTENANCE_UPDATE', 'MAINTENANCE_COMPLETE',
      'PRODUCT_ADD', 'PRODUCT_UPDATE', 'PRODUCT_DELETE',
      'INVENTORY_UPDATE', 'INVENTORY_TRANSFER',
      'DISCOUNT_CREATE', 'DISCOUNT_APPLY',
      'EXPORT_DATA', 'IMPORT_DATA',
      'API_ACCESS', 'WEBHOOK_RECEIVED'
    ],
    index: true
  },
  resource: {
    type: {
      type: String,
      required: true,
      enum: [
        'User', 'Product', 'Rental', 'Payment', 'Delivery',
        'Maintenance', 'Inventory', 'Category', 'Discount',
        'Address', 'Review', 'Notification', 'Vendor'
      ]
    },
    id: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'resource.type'
    },
    name: String,
    identifier: String // e.g., rental number, order number
  },
  changes: {
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
    modified: [String]
  },
  metadata: {
    ipAddress: {
      type: String,
      required: true
    },
    userAgent: String,
    deviceInfo: {
      type: String,
      browser: String,
      os: String,
      platform: String
    },
    location: {
      country: String,
      city: String,
      latitude: Number,
      longitude: Number
    },
    sessionId: String,
    requestId: String,
    apiEndpoint: String,
    httpMethod: String,
    httpStatus: Number,
    responseTime: Number
  },
  details: {
    description: String,
    notes: String,
    reason: String,
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'LOW'
    }
  },
  outcome: {
    status: {
      type: String,
      enum: ['SUCCESS', 'FAILURE', 'PENDING'],
      required: true
    },
    error: {
      code: String,
      message: String,
      stack: String
    }
  },
  isSensitive: {
    type: Boolean,
    default: false
  },
  retention: {
    expiresAt: Date,
    archived: { type: Boolean, default: false }
  }
}, {
  timestamps: true,
  capped: { size: 524288000, max: 1000000 } // 500MB, max 1M documents
});

// Compound indexes for efficient querying
auditLogSchema.index({ 'resource.type': 1, 'resource.id': 1 });
auditLogSchema.index({ user: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ 'metadata.ipAddress': 1, timestamp: -1 });
auditLogSchema.index({ 'outcome.status': 1, timestamp: -1 });
auditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 }); // 90 days TTL

// Static method to create audit entry
auditLogSchema.statics.log = async function(data) {
  try {
    // Sanitize sensitive data
    if (data.isSensitive && data.changes) {
      if (data.changes.before && data.changes.before.password) {
        data.changes.before.password = '[REDACTED]';
      }
      if (data.changes.after && data.changes.after.password) {
        data.changes.after.password = '[REDACTED]';
      }
    }

    return await this.create(data);
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw - audit logging should not break the main flow
  }
};

// Static method to get user activity timeline
auditLogSchema.statics.getUserTimeline = async function(userId, limit = 50) {
  return this.find({ user: userId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

// Static method to get resource history
auditLogSchema.statics.getResourceHistory = async function(resourceType, resourceId) {
  return this.find({
    'resource.type': resourceType,
    'resource.id': resourceId
  })
    .sort({ timestamp: -1 })
    .populate('user', 'profile.firstName profile.lastName email')
    .lean();
};

module.exports = mongoose.model('AuditLog', auditLogSchema);