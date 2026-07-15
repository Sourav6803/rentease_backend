const mongoose = require('mongoose');

const maintenanceSchema = new mongoose.Schema({
  requestNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  rental: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rental',
    required: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  inventory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inventory',
    required: true
  },
  issueType: {
    type: String,
    enum: [
      'not_working',
      'damaged',
      'cleaning',
      'replacement',
      'installation',
      'uninstallation',
      'repair',
      'parts_replacement',
      'technical_issue',
      'electrical_issue',
      'plumbing_issue',
      'other'
    ],
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent', 'emergency'],
    default: 'medium',
    index: true
  },
  status: {
    type: String,
    enum: [
      'pending',
      'assigned',
      'scheduled',
      'in_progress',
      'on_hold',
      'completed',
      'cancelled',
      'rejected',
      'escalated'
    ],
    default: 'pending',
    index: true
  },
  description: {
    title: String,
    issue: {
      type: String,
      required: true
    },
    steps: [String],
    frequency: String,
    whenStarted: Date,
    lastWorkingDate: Date
  },
  attachments: [{
    type: {
      type: String,
      enum: ['image', 'video', 'document', 'audio']
    },
    url: String,
    thumbnail: String,
    caption: String,
    uploadedAt: Date,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  schedule: {
    requestedDate: Date,
    preferredSlot: {
      start: String,
      end: String
    },
    scheduledDate: Date,
    scheduledSlot: String,
    estimatedDuration: Number, // in minutes
    actualStartDate: Date,
    actualEndDate: Date,
    rescheduledCount: { type: Number, default: 0 },
    rescheduleReason: String
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  assignedTeam: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  diagnosis: {
    findings: String,
    rootCause: String,
    partsRequired: [{
      name: String,
      partNumber: String,
      quantity: Number,
      cost: Number,
      isAvailable: Boolean,
      estimatedArrival: Date
    }],
    estimatedCost: Number,
    estimatedTime: Number,
    diagnosedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    diagnosedAt: Date
  },
  resolution: {
    action: String,
    partsUsed: [{
      name: String,
      partNumber: String,
      quantity: Number,
      cost: Number
    }],
    labourHours: Number,
    cost: {
      parts: Number,
      labour: Number,
      travel: Number,
      other: Number,
      total: Number
    },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
    notes: String
  },
  charges: {
    isChargeable: { type: Boolean, default: false },
    estimate: Number,
    actual: Number,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'waived', 'disputed'],
      default: 'pending'
    },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }
  },
  feedback: {
    rating: { type: Number, min: 1, max: 5 },
    comment: String,
    serviceQuality: { type: Number, min: 1, max: 5 },
    timeliness: { type: Number, min: 1, max: 5 },
    professionalism: { type: Number, min: 1, max: 5 },
    submittedAt: Date
  },
  timeline: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    note: String,
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    attachments: [String]
  }],
  communication: [{
    type: {
      type: String,
      enum: ['call', 'email', 'sms', 'chat', 'in_app']
    },
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    message: String,
    attachments: [String],
    timestamp: { type: Date, default: Date.now },
    readAt: Date
  }],
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    source: { type: String, enum: ['web', 'mobile', 'admin', 'auto'] },
    ipAddress: String,
    userAgent: String,
    tags: [String],
    internalNotes: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
// maintenanceSchema.index({ requestNumber: 1 });
maintenanceSchema.index({ rental: 1, status: 1 });
maintenanceSchema.index({ user: 1, status: 1 });
maintenanceSchema.index({ vendor: 1, status: 1 });
maintenanceSchema.index({ assignedTo: 1, status: 1 });
maintenanceSchema.index({ priority: 1, status: 1, createdAt: 1 });
maintenanceSchema.index({ 'schedule.scheduledDate': 1, status: 1 });

// Pre-save middleware to generate request number
maintenanceSchema.pre('save', async function(next) {
  if (this.isNew) {
    const count = await mongoose.model('Maintenance').countDocuments();
    this.requestNumber = `MNT${Date.now().toString().slice(-8)}${(count + 1).toString().padStart(4, '0')}`;
  }
  next();
});

// Pre-save middleware to set priority based on issue type
maintenanceSchema.pre('save', function(next) {
  if (this.isNew && !this.priority) {
    const priorityMap = {
      'not_working': 'high',
      'damaged': 'medium',
      'cleaning': 'low',
      'replacement': 'medium',
      'installation': 'low',
      'uninstallation': 'low',
      'repair': 'medium',
      'parts_replacement': 'medium',
      'technical_issue': 'medium',
      'electrical_issue': 'urgent',
      'plumbing_issue': 'urgent',
      'other': 'low'
    };
    this.priority = priorityMap[this.issueType] || 'medium';
  }
  next();
});

// Method to add timeline entry
maintenanceSchema.methods.addTimeline = function(status, note, userId, attachments = []) {
  this.timeline.push({
    status: status || this.status,
    timestamp: new Date(),
    note,
    updatedBy: userId,
    attachments
  });
};

// Method to assign technician
maintenanceSchema.methods.assignTechnician = async function(technicianId, assignedBy) {
  this.assignedTo = technicianId;
  this.status = 'assigned';
  this.addTimeline('assigned', `Assigned to technician`, assignedBy);
  await this.save();
};

// Method to start maintenance
maintenanceSchema.methods.startMaintenance = async function(technicianId) {
  this.status = 'in_progress';
  this.schedule.actualStartDate = new Date();
  this.addTimeline('in_progress', 'Maintenance work started', technicianId);
  await this.save();
};

// Method to complete maintenance
maintenanceSchema.methods.completeMaintenance = async function(resolutionData, completedBy) {
  this.status = 'completed';
  this.schedule.actualEndDate = new Date();
  this.resolution = {
    ...resolutionData,
    resolvedBy: completedBy,
    resolvedAt: new Date()
  };
  this.addTimeline('completed', 'Maintenance completed', completedBy);
  
  // Update inventory if needed
  if (this.resolution.partsUsed && this.resolution.partsUsed.length > 0) {
    const Inventory = mongoose.model('Inventory');
    await Inventory.findByIdAndUpdate(this.inventory, {
      $push: {
        'maintenanceHistory': this._id
      }
    });
  }
  
  await this.save();
};

// Method to calculate SLA breach
maintenanceSchema.methods.checkSLABreach = function() {
  const slaHours = {
    'emergency': 1,
    'urgent': 4,
    'high': 24,
    'medium': 48,
    'low': 72
  };
  
  const slaTime = slaHours[this.priority] * 60 * 60 * 1000;
  const createdTime = this.createdAt.getTime();
  const currentTime = new Date().getTime();
  
  return (currentTime - createdTime) > slaTime && this.status === 'pending';
};

// Static method to get pending maintenance requests
maintenanceSchema.statics.getPendingRequests = function(priority = null) {
  const query = { status: { $in: ['pending', 'assigned', 'scheduled'] } };
  if (priority) query.priority = priority;
  
  return this.find(query)
    .populate('user', 'profile.firstName profile.lastName phone email')
    .populate('product', 'basicInfo.name')
    .populate('rental', 'rentalNumber')
    .sort({ priority: -1, createdAt: 1 });
};

// Static method to get technician workload
maintenanceSchema.statics.getTechnicianWorkload = function(technicianId) {
  return this.countDocuments({
    assignedTo: technicianId,
    status: { $in: ['assigned', 'scheduled', 'in_progress'] }
  });
};

// Static method to generate maintenance report
maintenanceSchema.statics.generateReport = async function(startDate, endDate, vendorId = null) {
  const match = {
    createdAt: { $gte: startDate, $lte: endDate }
  };
  if (vendorId) match.vendor = vendorId;

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalRequests: { $sum: 1 },
        completedRequests: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
        },
        pendingRequests: {
          $sum: { $cond: [{ $in: ['$status', ['pending', 'assigned', 'scheduled', 'in_progress']] }, 1, 0] }
        },
        avgResolutionTime: {
          $avg: {
            $cond: [
              { $and: [{ $ne: ['$schedule.actualEndDate', null] }, { $ne: ['$schedule.actualStartDate', null] }] },
              { $subtract: ['$schedule.actualEndDate', '$schedule.actualStartDate'] },
              null
            ]
          }
        },
        totalCost: { $sum: '$resolution.cost.total' },
        byPriority: {
          $push: {
            priority: '$priority',
            count: 1
          }
        },
        byIssueType: {
          $push: {
            type: '$issueType',
            count: 1
          }
        }
      }
    },
    {
      $project: {
        totalRequests: 1,
        completedRequests: 1,
        pendingRequests: 1,
        avgResolutionTime: 1,
        totalCost: 1,
        byPriority: { $arrayToObject: { $zip: { inputs: ['$byPriority.priority', '$byPriority.count'] } } },
        byIssueType: { $arrayToObject: { $zip: { inputs: ['$byIssueType.type', '$byIssueType.count'] } } }
      }
    }
  ]);
};

module.exports = mongoose.model('Maintenance', maintenanceSchema);