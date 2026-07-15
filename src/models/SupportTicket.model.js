const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
  ticketNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  type: {
    type: String,
    enum: [
      'user_issue',
      'vendor_issue',
      'rental_dispute',
      'payment_dispute',
      'technical_issue',
      'content_moderation',
      'account_issue',
      'feature_request',
      'complaint',
      'other'
    ],
    required: true,
    index: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent', 'critical'],
    default: 'medium',
    index: true
  },
  status: {
    type: String,
    enum: [
      'open',
      'assigned',
      'in_progress',
      'pending',
      'resolved',
      'closed',
      'reopened',
      'escalated'
    ],
    default: 'open',
    index: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    index: true
  },
  relatedTo: {
    type: {
      type: String,
      enum: ['user', 'vendor', 'rental', 'payment', 'product']
    },
    id: mongoose.Schema.Types.ObjectId,
    model: String
  },
  subject: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  attachments: [{
    url: String,
    filename: String,
    uploadedAt: Date
  }],
  messages: [{
    sender: {
      type: {
        type: String,
        enum: ['user', 'admin', 'system']
      },
      id: mongoose.Schema.Types.ObjectId,
      name: String
    },
    message: String,
    attachments: [String],
    isInternal: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    readBy: [{
      admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
      readAt: Date
    }]
  }],
  timeline: [{
    action: String,
    performedBy: {
      type: { type: String, enum: ['user', 'admin', 'system'] },
      id: mongoose.Schema.Types.ObjectId
    },
    note: String,
    timestamp: { type: Date, default: Date.now }
  }],
  resolution: {
    summary: String,
    resolvedAt: Date,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    feedback: {
      rating: { type: Number, min: 1, max: 5 },
      comment: String,
      providedAt: Date
    }
  },
  escalation: {
    level: { type: Number, default: 0 },
    reason: String,
    escalatedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    escalatedAt: Date,
    resolvedAt: Date
  },
  sla: {
    responseDue: Date,
    resolutionDue: Date,
    breached: { type: Boolean, default: false }
  },
  metadata: {
    source: { type: String, enum: ['web', 'mobile', 'email', 'phone', 'chat'] },
    browserInfo: String,
    ipAddress: String,
    tags: [String]
  }
}, {
  timestamps: true
});

// Indexes
// supportTicketSchema.index({ ticketNumber: 1 });
supportTicketSchema.index({ assignedTo: 1, status: 1 });
supportTicketSchema.index({ priority: 1, status: 1, createdAt: 1 });
supportTicketSchema.index({ 'relatedTo.id': 1, 'relatedTo.type': 1 });

// Pre-save middleware
supportTicketSchema.pre('save', async function(next) {
  if (this.isNew) {
    const count = await mongoose.model('SupportTicket').countDocuments();
    this.ticketNumber = `TKT${Date.now().toString().slice(-8)}${(count + 1).toString().padStart(4, '0')}`;
    
    // Set SLA
    const slaHours = {
      critical: 1,
      urgent: 4,
      high: 8,
      medium: 24,
      low: 48
    };
    this.sla = {
      responseDue: new Date(Date.now() + slaHours[this.priority] * 60 * 60 * 1000),
      resolutionDue: new Date(Date.now() + slaHours[this.priority] * 24 * 60 * 60 * 1000)
    };
  }
  // next();
});

module.exports = mongoose.model('SupportTicket', supportTicketSchema);