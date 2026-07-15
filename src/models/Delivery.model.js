const mongoose = require('mongoose');

const deliverySchema = new mongoose.Schema({
  deliveryNumber: {
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
  type: {
    type: String,
    enum: ['delivery', 'pickup', 'exchange', 'return', 'maintenance'],
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: [
      'scheduled',
      'batched',
      'assigned',
      'out_for_delivery',
      'in_transit',
      'reached',
      'delivered',
      'picked_up',
      'failed',
      'cancelled',
      'rescheduled',
      'returned_to_warehouse'
    ],
    default: 'scheduled',
    index: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  schedule: {
    requestedDate: {
      type: Date,
      required: true
    },
    scheduledDate: Date,
    scheduledSlot: {
      start: String,
      end: String
    },
    confirmedDate: Date,
    confirmedSlot: String,
    rescheduledCount: {
      type: Number,
      default: 0
    },
    rescheduleReason: String,
    deadline: Date
  },
  address: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Address',
    required: true
  },
  contact: {
    name: String,
    phone: String,
    alternatePhone: String,
    email: String
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    inventory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inventory'
    },
    name: String,
    sku: String,
    quantity: Number,
    condition: String,
    images: [String],
    notes: String
  }],
  deliveryPerson: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryPerson',
    index: true
  },
  assignedDeliveryPerson: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryPerson',
    index: true
  },
  dispatchBatch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DispatchBatch',
    index: true
  },
  stopSequence: {
    type: Number,
    default: null
  },
  deliveryTeam: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  vehicle: {
    type: {
      type: String,
      enum: ['bike', 'car', 'van', 'truck']
    },
    number: String,
    assignedAt: Date
  },
  route: {
    distance: Number,
    duration: Number,
    polyline: String,
    waypoints: [{
      type: { type: String, enum: ['Point'] },
      coordinates: [Number],
      address: String,
      stopType: String
    }],
    optimized: { type: Boolean, default: false }
  },
  tracking: {
    currentLocation: {
      type: { type: String, enum: ['Point'] },
      coordinates: [Number],
      updatedAt: Date
    },
    lastKnownLocation: {
      type: { type: String, enum: ['Point'] },
      coordinates: [Number]
    },
    timeline: [{
      status: String,
      timestamp: Date,
      location: {
        coordinates: [Number],
        address: String
      },
      note: String,
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }],
    estimatedArrival: Date,
    actualArrival: Date
  },
  proof: {
    deliveredTo: String,
    signature: {
      data: String,
      capturedAt: Date
    },
    photos: [{
      url: String,
      caption: String,
      timestamp: Date
    }],
    otp: {
      code: String,
      verifiedAt: Date,
      verifiedBy: String
    },
    document: {
      type: String,
      url: String,
      number: String
    }
  },
  charges: {
    baseCharge: Number,
    distanceCharge: Number,
    weightCharge: Number,
    specialCharge: Number,
    totalCharge: Number,
    paymentMethod: {
      type: String,
      enum: ['cash', 'card', 'wallet', 'prepaid']
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending'
    }
  },
  issues: [{
    type: {
      type: String,
      enum: ['wrong_address', 'customer_not_available', 'damaged_item', 'missing_item', 'other']
    },
    description: String,
    reportedAt: Date,
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
    resolution: String,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  feedback: {
    rating: { type: Number, min: 1, max: 5 },
    comment: String,
    submittedAt: Date
  },
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    source: { type: String, enum: ['web', 'mobile', 'admin', 'system'] },
    notes: String,
    tags: [String]
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
// deliverySchema.index({ deliveryNumber: 1 });
deliverySchema.index({ rental: 1, type: 1 });
deliverySchema.index({ 'schedule.scheduledDate': 1, status: 1 });
deliverySchema.index({ deliveryPerson: 1, status: 1 });
deliverySchema.index({ assignedDeliveryPerson: 1, status: 1 });
deliverySchema.index({ dispatchBatch: 1, status: 1 });
deliverySchema.index({ 'tracking.currentLocation': '2dsphere' });

// Pre-save middleware to generate delivery number
deliverySchema.pre('save', async function(next) {
  if (this.isNew) {
    const count = await mongoose.model('Delivery').countDocuments();
    const prefix = this.type === 'pickup' ? 'PCK' : 'DLV';
    this.deliveryNumber = `${prefix}${Date.now().toString().slice(-8)}${(count + 1).toString().padStart(4, '0')}`;
  }
  // next();
});

// Method to update tracking
deliverySchema.methods.updateTracking = function(location, status, note) {
  this.tracking.currentLocation = {
    type: 'Point',
    coordinates: location.coordinates,
    updatedAt: new Date()
  };
  
  this.tracking.timeline.push({
    status: status || this.status,
    timestamp: new Date(),
    location: {
      coordinates: location.coordinates,
      address: location.address
    },
    note
  });
};

// Method to mark as delivered
deliverySchema.methods.markDelivered = async function(proofData) {
  this.status = 'delivered';
  this.tracking.actualArrival = new Date();
  this.proof = { ...this.proof, ...proofData };
  
  this.tracking.timeline.push({
    status: 'delivered',
    timestamp: new Date(),
    note: 'Delivery completed'
  });

  await this.save();

  // Update rental status
  const Rental = mongoose.model('Rental');
  await Rental.findByIdAndUpdate(this.rental, {
    status: 'delivered',
    'delivery.actualDate': new Date(),
    'delivery.status': 'delivered'
  });
};

// Static method to get today's deliveries
deliverySchema.statics.getTodaysDeliveries = function() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  return this.find({
    'schedule.scheduledDate': { $gte: start, $lte: end },
    status: { $nin: ['delivered', 'cancelled'] }
  })
    .populate('rental', 'rentalNumber')
    .populate('address')
    .sort({ 'schedule.scheduledDate': 1 });
};

// Static method to assign delivery person
deliverySchema.statics.assignDeliveryPerson = async function(deliveryId, personId) {
  const delivery = await this.findByIdAndUpdate(
    deliveryId,
    {
      deliveryPerson: personId,
      status: 'assigned',
      $push: {
        'tracking.timeline': {
          status: 'assigned',
          timestamp: new Date(),
          note: `Assigned to delivery person`
        }
      }
    },
    { new: true }
  );
  return delivery;
};

module.exports = mongoose.model('Delivery', deliverySchema);