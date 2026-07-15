// models/DeliveryPerson.model.js
const mongoose = require('mongoose');

const deliveryPersonSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  employeeId: {
    type: String,
    required: true,
    unique: true
  },
  vehicle: {
    type: {
      type: String,
      enum: ['bike', 'scooter', 'car', 'van', 'truck', 'mini-truck'],
      default: 'bike'
    },
    number: {
      type: String,
      trim: true
    },
    model: String,
    registrationNumber: String,
    capacity: Number // in kg
  },
  zone: {
    type: String,
    enum: ['north', 'south', 'east', 'west', 'central', 'all'],
    default: 'all'
  },
  serviceablePincodes: [{
    type: String,
    trim: true
  }],
  availability: {
    isAvailable: {
      type: Boolean,
      default: true
    },
    isOnDuty: {
      type: Boolean,
      default: false
    },
    currentLocation: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: [Number],
      // validate: {
      //   validator: v => v.length === 2,
      //   message: 'Coordinates must contain longitude and latitude'
      // },
      updatedAt: Date
    },
    shifts: {
      start: { type: String, default: '09:00' },
      end: { type: String, default: '18:00' },
      workingDays: [{
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        default: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
      }]
    }
  },

  locationHistory: [{
  coordinates: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: [Number] // [longitude, latitude]
  },
  timestamp: { type: Date, default: Date.now },
  speed: Number, // km/h
  battery: Number, // battery percentage
  accuracy: Number, // GPS accuracy in meters
  address: String
}],
otpConfig: {
  enabled: { type: Boolean, default: true },
  length: { type: Number, default: 6 },
  expiryMinutes: { type: Number, default: 5 }
},
aiPreferences: {
  autoAcceptAssignments: { type: Boolean, default: false },
  maxAcceptanceDistance: { type: Number, default: 10 }, // km
  preferredDeliveryTypes: [String],
  avoidHighTraffic: { type: Boolean, default: true }
},
  performance: {
    totalDeliveries: { type: Number, default: 0 },
    completedDeliveries: { type: Number, default: 0 },
    failedDeliveries: { type: Number, default: 0 },
    cancelledDeliveries: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    onTimeRate: { type: Number, default: 0 },
    totalDistance: { type: Number, default: 0 },
    totalEarnings: { type: Number, default: 0 },
    lastDeliveryAt: Date
  },
  documents: [{
    type: {
      type: String,
      enum: ['license', 'aadhar', 'pan', 'vehicle_rc', 'insurance', 'background_check']
    },
    number: String,
    url: String,
    verified: { type: Boolean, default: false },
    verifiedAt: Date,
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    expiryDate: Date,
    uploadedAt: { type: Date, default: Date.now },
    notes: String
  }],
  bankDetails: {
    accountHolderName: String,
    accountNumber: String,
    ifscCode: String,
    bankName: String,
    upiId: String
  },
  currentAssignments: [{
    delivery: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery' },
    assignedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['assigned', 'started', 'completed', 'failed'] }
  }],
  maxConcurrentDeliveries: {
    type: Number,
    default: 5
  },
  status: {
    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected', 'suspended'],
      default: 'pending'
    },
    reason: String,
    suspendedAt: Date,
    suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    hiredAt: { type: Date, default: Date.now },
    notes: String
  }
}, { timestamps: true });

// Indexes
deliveryPersonSchema.index({ 'availability.currentLocation': '2dsphere' });
deliveryPersonSchema.index({ serviceablePincodes: 1 });
deliveryPersonSchema.index({ zone: 1, 'availability.isAvailable': 1 });
deliveryPersonSchema.index({ employeeId: 1 });
deliveryPersonSchema.index({ 'status.verificationStatus': 1 });

// Virtual for full name
deliveryPersonSchema.virtual('fullName').get(async function() {
  if (this.user) {
    const user = await mongoose.model('User').findById(this.user);
    return user ? `${user.profile.firstName} ${user.profile.lastName}` : 'Unknown';
  }
  return 'Unknown';
});

// Methods
deliveryPersonSchema.methods.isAvailableForDelivery = async function(pincode) {
  if (!this.availability.isAvailable || !this.availability.isOnDuty) return false;
  if (this.currentAssignments.length >= this.maxConcurrentDeliveries) return false;
  if (!this.serviceablePincodes.includes(pincode) && this.zone !== 'all') return false;
  
  // Check shift timing
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const shiftStart = this.availability.shifts.start.split(':').map(Number);
  const shiftEnd = this.availability.shifts.end.split(':').map(Number);
  
  const currentTime = currentHour * 60 + currentMinute;
  const startTime = shiftStart[0] * 60 + (shiftStart[1] || 0);
  const endTime = shiftEnd[0] * 60 + (shiftEnd[1] || 0);
  
  if (currentTime < startTime || currentTime > endTime) return false;
  
  return true;
};

deliveryPersonSchema.methods.updatePerformance = async function(deliveryData) {
  this.performance.totalDeliveries += 1;
  if (deliveryData.status === 'delivered') {
    this.performance.completedDeliveries += 1;
    if (deliveryData.onTime) this.performance.onTimeRate = 
      ((this.performance.onTimeRate * (this.performance.completedDeliveries - 1) + 100) / this.performance.completedDeliveries);
  } else if (deliveryData.status === 'failed') {
    this.performance.failedDeliveries += 1;
  }
  
  if (deliveryData.distance) this.performance.totalDistance += deliveryData.distance;
  if (deliveryData.earnings) this.performance.totalEarnings += deliveryData.earnings;
  if (deliveryData.rating) {
    const totalRatings = this.performance.completedDeliveries;
    this.performance.averageRating = 
      ((this.performance.averageRating * (totalRatings - 1)) + deliveryData.rating) / totalRatings;
  }
  
  this.performance.lastDeliveryAt = new Date();
  await this.save();
};

module.exports = mongoose.model('DeliveryPerson', deliveryPersonSchema);