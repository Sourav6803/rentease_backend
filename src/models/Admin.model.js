const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  // Link to User model (optional - can be null for system admins)
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    sparse: true,
    unique: true,
    index: true
  },
  
  // Admin credentials (if not linked to User)
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
    sparse: true,
    unique: true,
    index: true
  },
  password: {
    type: String,
    required: true,
    select: false
  },
  
  // Admin profile
  profile: {
    firstName: {
      type: String,
      required: true
    },
    lastName: {
      type: String,
      required: true
    },
    avatar: String,
    department: {
      type: String,
      enum: [
        'super_admin',
        'operations',
        'customer_support',
        'vendor_management',
        'finance',
        'inventory',
        'marketing',
        'technical',
        'legal',
        'hr'
      ],
      required: true
    },
    designation: String,
    employeeId: {
      type: String,
      unique: true,
      sparse: true
    },
    joiningDate: Date,
    reportingTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin'
    }
  },
  
  // Admin roles and permissions
  role: {
    type: String,
    enum: [
      'super_admin',           // Full access
      'admin',                  // General admin
      'operations_manager',     // Operations management
      'support_manager',        // Customer support
      'vendor_manager',         // Vendor management
      'finance_manager',        // Finance & payments
      'inventory_manager',      // Inventory management
      'content_manager',        // Content & marketing
      'analytics_viewer',       // Read-only analytics
      'auditor'                 // Audit & compliance
    ],
    required: true,
    index: true
  },
  
  // Granular permissions (overrides role-based permissions)
  permissions: {
    users: {
      view: { type: Boolean, default: true },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false },
      block: { type: Boolean, default: false },
      verifyKyc: { type: Boolean, default: false }
    },
    vendors: {
      view: { type: Boolean, default: true },
      approve: { type: Boolean, default: false },
      suspend: { type: Boolean, default: false },
      manageCommission: { type: Boolean, default: false },
      viewPayouts: { type: Boolean, default: false }
    },
    products: {
      view: { type: Boolean, default: true },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false },
      approve: { type: Boolean, default: false },
      feature: { type: Boolean, default: false }
    },
    rentals: {
      view: { type: Boolean, default: true },
      manage: { type: Boolean, default: false },
      cancel: { type: Boolean, default: false },
      refund: { type: Boolean, default: false },
      disputeResolution: { type: Boolean, default: false }
    },
    payments: {
      view: { type: Boolean, default: true },
      process: { type: Boolean, default: false },
      refund: { type: Boolean, default: false },
      adjust: { type: Boolean, default: false },
      viewPayouts: { type: Boolean, default: false }
    },
    inventory: {
      view: { type: Boolean, default: true },
      manage: { type: Boolean, default: false },
      transfer: { type: Boolean, default: false },
      writeoff: { type: Boolean, default: false }
    },
    maintenance: {
      view: { type: Boolean, default: true },
      assign: { type: Boolean, default: false },
      approveCharges: { type: Boolean, default: false }
    },
    discounts: {
      view: { type: Boolean, default: true },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    },
    content: {
      manageCategories: { type: Boolean, default: false },
      manageBlog: { type: Boolean, default: false },
      manageFaqs: { type: Boolean, default: false },
      managePages: { type: Boolean, default: false }
    },
    analytics: {
      view: { type: Boolean, default: true },
      export: { type: Boolean, default: false },
      manageReports: { type: Boolean, default: false }
    },
    admins: {
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false },
      manageRoles: { type: Boolean, default: false }
    },
    system: {
      manageSettings: { type: Boolean, default: false },
      viewLogs: { type: Boolean, default: false },
      manageBackup: { type: Boolean, default: false },
      manageMaintenance: { type: Boolean, default: false }
    }
  },
  
  // Admin activity tracking
  activity: {
    lastLogin: Date,
    lastLoginIp: String,
    lastLoginDevice: String,
    loginCount: { type: Number, default: 0 },
    lastActive: Date,
    currentSession: {
      token: String,
      deviceInfo: String,
      loggedInAt: Date,
      expiresAt: Date
    },
    loginHistory: [{
      timestamp: Date,
      ipAddress: String,
      deviceInfo: String,
      location: String,
      success: Boolean,
      failureReason: String
    }],
    actions: [{
      action: String,
      resource: String,
      resourceId: mongoose.Schema.Types.ObjectId,
      timestamp: { type: Date, default: Date.now },
      ipAddress: String,
      details: mongoose.Schema.Types.Mixed
    }]
  },
  
  // Admin access control
  access: {
    ipWhitelist: [String],
    allowedIpRanges: [String],
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false },
    backupCodes: [{
      code: { type: String, select: false },
      used: { type: Boolean, default: false },
      usedAt: Date
    }],
    sessionTimeout: { type: Number, default: 60 }, // minutes
    maxSessions: { type: Number, default: 3 },
    requirePasswordChange: { type: Boolean, default: false },
    passwordLastChanged: Date,
    passwordHistory: [{
      password: { type: String, select: false },
      changedAt: Date
    }]
  },
  
  // Admin notifications and preferences
  preferences: {
    language: { type: String, default: 'en' },
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    dateFormat: { type: String, default: 'DD/MM/YYYY' },
    notifications: {
      email: {
        newVendors: { type: Boolean, default: true },
        newRentals: { type: Boolean, default: true },
        maintenanceRequests: { type: Boolean, default: true },
        disputes: { type: Boolean, default: true },
        systemAlerts: { type: Boolean, default: true },
        dailyDigest: { type: Boolean, default: true },
        weeklyReport: { type: Boolean, default: true }
      },
      push: {
        enabled: { type: Boolean, default: false },
        devices: [{
          token: String,
          platform: String,
          lastUsed: Date
        }]
      },
      dashboard: {
        showQuickStats: { type: Boolean, default: true },
        defaultView: { type: String, default: 'dashboard' },
        widgets: [String]
      }
    }
  },
  
  // Admin work assignment
  assignments: {
    currentTickets: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupportTicket'
    }],
    assignedVendors: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor'
    }],
    assignedCategories: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category'
    }],
    workload: {
      type: String,
      enum: ['low', 'medium', 'high', 'overloaded'],
      default: 'low'
    }
  },
  
  // Performance metrics
  performance: {
    ticketsResolved: { type: Number, default: 0 },
    avgResponseTime: Number, // in hours
    customerSatisfaction: { type: Number, default: 0 },
    vendorsOnboarded: { type: Number, default: 0 },
    productsApproved: { type: Number, default: 0 },
    disputesResolved: { type: Number, default: 0 },
    weeklyMetrics: [{
      week: Date,
      ticketsResolved: Number,
      avgResponseTime: Number,
      satisfaction: Number
    }]
  },
  
  // Security
  security: {
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: Date,
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: Date,
    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, select: false },
    emailVerificationExpires : { type: Date , select: false },
    phoneVerified: { type: Boolean, default: false },
    securityQuestions: [{
      question: String,
      answer: { type: String, select: false }
    }]
  },
  
  // Audit
  audit: {
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin'
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin'
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin'
    },
    deletedAt: Date,
    deleteReason: String
  },
  
  // Status
  status: {
    isActive: { type: Boolean, default: true, index: true },
    isBlocked: { type: Boolean, default: false },
    blockedReason: String,
    blockedAt: Date,
    blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    isOnLeave: { type: Boolean, default: false },
    leaveStartDate: Date,
    leaveEndDate: Date,
    availableForChat: { type: Boolean, default: true },
    availableForCalls: { type: Boolean, default: true }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
// adminSchema.index({ email: 1 });
adminSchema.index({ 'profile.department': 1, role: 1 });
adminSchema.index({ status: 1, 'profile.department': 1 });
adminSchema.index({ 'activity.lastActive': -1 });
adminSchema.index({ 'assignments.workload': 1 });

// Pre-save middleware
// adminSchema.pre('save', async function(next) {
//   // Hash password if modified
//   if (this.isModified('password')) {
//     const bcrypt = require('bcryptjs');
//     this.password = await bcrypt.hash(this.password, 12);
    
//     // Store in password history
//     this.access.passwordHistory.push({
//       password: this.password,
//       changedAt: new Date()
//     });
    
//     // Keep only last 5 passwords
//     if (this.access.passwordHistory.length > 5) {
//       this.access.passwordHistory = this.access.passwordHistory.slice(-5);
//     }
    
//     this.access.passwordLastChanged = new Date();
//   }
  
//   // next();
// });

// Methods
adminSchema.methods.comparePassword = async function(candidatePassword) {
  
  return await bcrypt.compare(candidatePassword, this.password);
};

adminSchema.methods.checkPasswordHistory = async function(newPassword) {
  for (const history of this.access.passwordHistory) {
    if (await bcrypt.compare(newPassword, history.password)) {
      return true;
    }
  }
  return false;
};

adminSchema.methods.hasPermission = function(resource, action) {
  // Super admin has all permissions
  if (this.role === 'super_admin') return true;
  
  // Check granular permissions
  if (this.permissions[resource] && this.permissions[resource][action] !== undefined) {
    return this.permissions[resource][action];
  }
  
  // Fallback to role-based permissions
  return this.getRolePermission(resource, action);
};

adminSchema.methods.getRolePermission = function(resource, action) {
  const rolePermissions = {
    admin: {
      users: { view: true, create: true, edit: true, block: true },
      vendors: { view: true, approve: true, suspend: true },
      products: { view: true, approve: true },
      rentals: { view: true, manage: true, disputeResolution: true },
      payments: { view: true, refund: true },
      inventory: { view: true, manage: true },
      maintenance: { view: true, assign: true },
      discounts: { view: true, create: true, edit: true },
      analytics: { view: true, export: true }
    },
    operations_manager: {
      vendors: { view: true, approve: true },
      products: { view: true, approve: true },
      rentals: { view: true, manage: true },
      inventory: { view: true, manage: true, transfer: true },
      maintenance: { view: true, assign: true, approveCharges: true },
      analytics: { view: true }
    },
    support_manager: {
      users: { view: true, edit: true, block: true },
      rentals: { view: true, disputeResolution: true },
      maintenance: { view: true, assign: true },
      analytics: { view: true }
    },
    finance_manager: {
      vendors: { view: true, manageCommission: true, viewPayouts: true },
      payments: { view: true, process: true, refund: true, viewPayouts: true },
      rentals: { view: true },
      analytics: { view: true, export: true }
    }
  };
  
  return rolePermissions[this.role]?.[resource]?.[action] || false;
};

adminSchema.methods.logAction = function(action, resource, resourceId, details = {}, ipAddress) {
  this.activity.actions.push({
    action,
    resource,
    resourceId,
    timestamp: new Date(),
    ipAddress,
    details
  });
  
  // Keep only last 1000 actions
  if (this.activity.actions.length > 1000) {
    this.activity.actions = this.activity.actions.slice(-1000);
  }
};

adminSchema.methods.recordLogin = function(ipAddress, deviceInfo, success = true, failureReason = null) {
  this.activity.loginCount += 1;
  this.activity.lastLogin = new Date();
  this.activity.lastLoginIp = ipAddress;
  this.activity.lastLoginDevice = deviceInfo;
  
  this.activity.loginHistory.push({
    timestamp: new Date(),
    ipAddress,
    deviceInfo,
    success,
    failureReason
  });
  
  // Keep only last 100 login attempts
  if (this.activity.loginHistory.length > 100) {
    this.activity.loginHistory = this.activity.loginHistory.slice(-100);
  }
  
  if (!success) {
    this.security.failedLoginAttempts += 1;
  } else {
    this.security.failedLoginAttempts = 0;
    this.security.lockUntil = null;
  }
};

adminSchema.methods.isLocked = function() {
  return !!(this.security.lockUntil && this.security.lockUntil > new Date());
};

adminSchema.methods.incrementFailedLogins = function() {
  this.security.failedLoginAttempts += 1;
  
  // Lock account after 5 failed attempts
  if (this.security.failedLoginAttempts >= 5) {
    this.security.lockUntil = new Date(Date.now() + 30 * 60 * 1000); // Lock for 30 minutes
  }
};

// Static methods
adminSchema.statics.findByEmail = function(email) {
  return this.findOne({ email }).select('+password +access.twoFactorSecret +access.backupCodes +security.passwordResetToken');
};

adminSchema.statics.getOnlineAdmins = function() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return this.find({
    'activity.lastActive': { $gte: fiveMinutesAgo },
    status: { isActive: true, isBlocked: false }
  }).select('profile.firstName profile.lastName profile.department');
};

adminSchema.statics.getDepartmentStats = function() {
  return this.aggregate([
    { $match: { 'status.isActive': true } },
    {
      $group: {
        _id: '$profile.department',
        count: { $sum: 1 },
        online: {
          $sum: {
            $cond: [
              { $gte: ['$activity.lastActive', new Date(Date.now() - 5 * 60 * 1000)] },
              1,
              0
            ]
          }
        }
      }
    }
  ]);
};

// Virtual for full name
adminSchema.virtual('fullName').get(function() {
  return `${this.profile.firstName} ${this.profile.lastName}`;
});

// Virtual for is online
adminSchema.virtual('isOnline').get(function() {
  if (!this.activity.lastActive) return false;
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return this.activity.lastActive > fiveMinutesAgo;
});

module.exports = mongoose.model('Admin', adminSchema);