const mongoose = require('mongoose');

const adminActivitySchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'LOGIN', 'LOGOUT', 'LOGIN_FAILED',
      'VIEW', 'CREATE', 'UPDATE', 'DELETE', 'BULK_UPDATE',
      'APPROVE', 'REJECT', 'BLOCK', 'UNBLOCK',
      'EXPORT', 'IMPORT', 'DOWNLOAD',
      'ASSIGN', 'ESCALATE', 'RESOLVE',
      'CHANGE_ROLE', 'CHANGE_PERMISSIONS',
      'SYSTEM_CONFIG', 'BACKUP', 'RESTORE'
    ],
    index: true
  },
  resource: {
    type: {
      type: String,
      enum: [
        'USER', 'VENDOR', 'PRODUCT', 'RENTAL', 'PAYMENT',
        'DELIVERY', 'MAINTENANCE', 'CATEGORY', 'DISCOUNT',
        'REVIEW', 'SUPPORT_TICKET', 'ADMIN', 'SYSTEM'
      ],
      required: true
    },
    id: mongoose.Schema.Types.ObjectId,
    identifier: String,
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed
  },
  details: {
    description: String,
    reason: String,
    changes: [String],
    metadata: mongoose.Schema.Types.Mixed
  },
  ipAddress: String,
  userAgent: String,
  sessionId: String,
  responseTime: Number,
  status: {
    type: String,
    enum: ['SUCCESS', 'FAILURE'],
    default: 'SUCCESS'
  },
  error: {
    message: String,
    stack: String
  }
}, {
  timestamps: true,
  capped: { size: 104857600, max: 500000 } // 100MB, max 500k documents
});

// Indexes
adminActivitySchema.index({ admin: 1, createdAt: -1 });
adminActivitySchema.index({ action: 1, createdAt: -1 });
adminActivitySchema.index({ 'resource.type': 1, 'resource.id': 1 });
adminActivitySchema.index({ ipAddress: 1, createdAt: -1 });

// Static methods
adminActivitySchema.statics.log = async function(data) {
  return this.create(data);
};

adminActivitySchema.statics.getAdminActivity = async function(adminId, days = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  
  return this.aggregate([
    { $match: { admin: adminId, createdAt: { $gte: since } } },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          action: '$action'
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { '_id.date': -1 } }
  ]);
};

module.exports = mongoose.model('AdminActivity', adminActivitySchema);