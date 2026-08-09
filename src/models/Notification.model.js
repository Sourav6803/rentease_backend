const mongoose = require('mongoose');
const crypto = require('crypto');

const notificationSchema = new mongoose.Schema({
  notificationNumber: {
    type: String,
    unique: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: [
      'email',
      'sms',
      'push',
      'in_app',
      'whatsapp'
    ],
    required: true,
    index: true
  },
  category: {
    type: String,
    enum: [
      'transactional',
      'promotional',
      'alert',
      'reminder',
      'update',
      'security',
      'marketing',
      'system'
    ],
    required: true,
    index: true
  },
  template: {
    type: String,
    index: true
  },
  title: {
    type: String,
    required: true
  },
  content: {
    text: String,
    html: String,
    preview: String
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  actions: [{
    type: {
      type: String,
      enum: ['link', 'button', 'deep_link', 'api']
    },
    label: String,
    url: String,
    data: mongoose.Schema.Types.Mixed
  }],
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: [
      'pending',
      'queued',
      'processing',
      'sent',
      'delivered',
      'read',
      'clicked',
      'failed',
      'cancelled',
      'expired'
    ],
    default: 'pending',
    index: true
  },
  channelDetails: {
    email: {
      from: String,
      to: [String],
      cc: [String],
      bcc: [String],
      replyTo: String,
      subject: String,
      attachments: [{
        filename: String,
        url: String,
        contentType: String
      }],
      headers: mongoose.Schema.Types.Mixed,
      messageId: String
    },
    sms: {
      from: String,
      to: String,
      sid: String,
      segments: Number,
      cost: Number
    },
    push: {
      deviceTokens: [String],
      platforms: [String],
      badge: Number,
      sound: String,
      category: String,
      threadId: String,
      collapseKey: String
    },
    whatsapp: {
      template: String,
      namespace: String,
      language: String,
      components: [mongoose.Schema.Types.Mixed]
    }
  },
  tracking: {
    sentAt: Date,
    deliveredAt: Date,
    readAt: Date,
    clickedAt: Date,
    openedAt: Date,
    failedAt: Date,
    failureReason: String,
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    events: [{
      event: String,
      timestamp: Date,
      metadata: mongoose.Schema.Types.Mixed
    }]
  },
  schedule: {
    scheduledFor: Date,
    timezone: { type: String, default: 'Asia/Kolkata' },
    recurring: {
      enabled: Boolean,
      pattern: String, // cron expression
      endDate: Date,
      interval: String // daily, weekly, monthly
    }
  },
  preferences: {
    allowOverride: { type: Boolean, default: true },
    respectUserSettings: { type: Boolean, default: true },
    consolidate: { type: Boolean, default: false },
    consolidateKey: String
  },
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    source: { type: String, enum: ['system', 'admin', 'api', 'cron'] },
    requestId: String,
    ipAddress: String,
    userAgent: String,
    tags: [String],
    notes: String
  },
  expiryDate: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, status: 1, createdAt: -1 });
notificationSchema.index({ type: 1, status: 1, 'schedule.scheduledFor': 1 });
notificationSchema.index({ 'tracking.sentAt': 1 });
notificationSchema.index({ expiryDate: 1 }, { expireAfterSeconds: 0 });

// Pre-save middleware to generate notification number.
// NOTE: this is an async hook with NO `next` parameter — Mongoose awaits the
// returned promise, so there is nothing to call. Do not re-introduce a `next`
// arg: mixing `next` with an async function is the fragile trap that the old
// commented-out `next()` left behind (change it back to non-async and saves
// would hang forever).
notificationSchema.pre('save', async function () {
  // Generate a collision-resistant number WITHOUT a COUNT query. The previous
  // `countDocuments() + 1` approach raced under concurrent creates (e.g. an
  // admin broadcast fanning out 25-at-a-time): two docs read the same count,
  // built the same number, and collided on the unique index — so those saves
  // failed. Timestamp + high-entropy random is race-free.
  if (this.isNew && !this.notificationNumber) {
    // crypto random with a 2^48 space so concurrent creates (an admin broadcast
    // fanning out many-at-a-time within the same millisecond) cannot collide on
    // the unique index — no COUNT query, no race.
    const random = crypto.randomBytes(6).toString('hex').toUpperCase();
    this.notificationNumber = `NOT${Date.now().toString().slice(-8)}${random}`;
  }

  // Set expiry date (30 days from creation)
  if (!this.expiryDate) {
    this.expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
});

// Method to mark as sent
notificationSchema.methods.markSent = async function(details = {}) {
  this.status = 'sent';
  this.tracking.sentAt = new Date();
  if (details.messageId) {
    this.channelDetails.email.messageId = details.messageId;
  }
  this.tracking.events.push({
    event: 'sent',
    timestamp: new Date(),
    metadata: details
  });
  await this.save();
};

// Method to mark as delivered
notificationSchema.methods.markDelivered = async function(details = {}) {
  this.status = 'delivered';
  this.tracking.deliveredAt = new Date();
  this.tracking.events.push({
    event: 'delivered',
    timestamp: new Date(),
    metadata: details
  });
  await this.save();
};

// Method to mark as read
notificationSchema.methods.markRead = async function() {
  if (this.type === 'in_app') {
    this.status = 'read';
    this.tracking.readAt = new Date();
    this.tracking.events.push({
      event: 'read',
      timestamp: new Date()
    });
    await this.save();
  }
};

// Method to mark as failed
notificationSchema.methods.markFailed = async function(reason, details = {}) {
  this.status = 'failed';
  this.tracking.failedAt = new Date();
  this.tracking.failureReason = reason;
  this.tracking.retryCount += 1;
  this.tracking.events.push({
    event: 'failed',
    timestamp: new Date(),
    metadata: { reason, ...details }
  });
  await this.save();
};

// Static method to create notification
notificationSchema.statics.createNotification = async function(data) {
  // Check if user has opted out of this notification type
  if (data.preferences?.respectUserSettings) {
    const User = mongoose.model('User');
    const user = await User.findById(data.user);
    
    if (user && user.preferences?.notifications) {
      const userPrefs = user.preferences.notifications;
      
      // Map notification type to user preference
      const typeMap = {
        email: 'email',
        sms: 'sms',
        push: 'push',
        in_app: 'in_app'
      };
      
      const prefType = typeMap[data.type];
      if (prefType && userPrefs[prefType] === false) {
        // User has opted out
        return null;
      }
    }
  }
  
  // Check for consolidation
  if (data.preferences?.consolidate && data.preferences?.consolidateKey) {
    const existing = await this.findOne({
      user: data.user,
      type: data.type,
      'preferences.consolidateKey': data.preferences.consolidateKey,
      status: { $in: ['pending', 'queued'] },
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
    });
    
    if (existing) {
      // Update existing notification
      existing.content = data.content;
      existing.data = { ...existing.data, ...data.data };
      existing.tracking.retryCount = 0;
      return existing.save();
    }
  }
  
  return this.create(data);
};

// Static method to get unread count.
// "Unread" == an in-app notification the user has not opened yet. Defined by
// `readAt` (not status) so this static and NotificationService.getUnreadCount
// can never disagree on the badge count.
notificationSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({
    user: userId,
    type: 'in_app',
    readAt: { $exists: false }
  });
};

// Static method to mark all as read (readAt-based, matching the service).
notificationSchema.statics.markAllAsRead = async function(userId) {
  const now = new Date();
  return this.updateMany(
    {
      user: userId,
      type: 'in_app',
      readAt: { $exists: false }
    },
    {
      $set: {
        status: 'read',
        readAt: now,
        'tracking.readAt': now
      }
    }
  );
};

// Static method to process scheduled notifications
notificationSchema.statics.processScheduled = async function() {
  const now = new Date();
  
  const notifications = await this.find({
    // Scheduled docs are written with status 'scheduled' (see
    // NotificationService.createNotification). The old 'pending' filter never
    // matched them, so this sweep silently found nothing.
    status: 'scheduled',
    'schedule.scheduledFor': { $lte: now },
    expiryDate: { $gt: now }
  });
  
  for (const notification of notifications) {
    notification.status = 'queued';
    await notification.save();
    // Add to queue for processing
  }
  
  return notifications.length;
};

// Virtual for time elapsed
notificationSchema.virtual('timeElapsed').get(function() {
  if (!this.createdAt) return null;
  
  const now = new Date();
  const diff = now - this.createdAt;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
});

module.exports = mongoose.model('Notification', notificationSchema);