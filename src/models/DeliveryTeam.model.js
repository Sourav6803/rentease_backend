// models/DeliveryTeam.model.js
const mongoose = require('mongoose');

const deliveryTeamSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  teamCode: {
    type: String,
    required: true,
    // unique: true
  },
  teamLead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryPerson',
    required: true
  },
  members: [{
    deliveryPerson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DeliveryPerson'
    },
    role: {
      type: String,
      enum: ['driver', 'helper', 'technician', 'installer', 'supervisor'],
      default: 'helper'
    },
    joinedAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true }
  }],
  vehicle: {
    type: {
      type: String,
      enum: ['bike', 'car', 'van', 'truck', 'mini-truck', 'tempo'],
      default: 'van'
    },
    number: String,
    model: String,
    capacity: Number,
    registrationNumber: String
  },
  zone: [{
    type: String,
    enum: ['north', 'south', 'east', 'west', 'central']
  }],
  serviceablePincodes: [String],
  equipment: [{
    name: String,
    quantity: Number,
    description: String
  }],
  availability: {
    isAvailable: { type: Boolean, default: true },
    isOnDuty: { type: Boolean, default: false },
    currentLocation: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: [Number],
      updatedAt: Date
    },
    workingHours: {
      start: { type: String, default: '09:00' },
      end: { type: String, default: '18:00' }
    }
  },
  performance: {
    totalDeliveries: { type: Number, default: 0 },
    completedDeliveries: { type: Number, default: 0 },
    failedDeliveries: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    onTimeRate: { type: Number, default: 0 },
    totalDistance: { type: Number, default: 0 },
    totalEarnings: { type: Number, default: 0 }
  },
  currentDeliveries: [{
    delivery: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery' },
    assignedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['assigned', 'started', 'completed', 'failed'] }
  }],
  maxConcurrentDeliveries: {
    type: Number,
    default: 10
  },
  status: {
    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    reason: String
  },
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
    notes: String
  }
}, { timestamps: true });

// Indexes
deliveryTeamSchema.index({ teamCode: 1 });
deliveryTeamSchema.index({ teamLead: 1 });
deliveryTeamSchema.index({ zone: 1 });
deliveryTeamSchema.index({ serviceablePincodes: 1 });
deliveryTeamSchema.index({ 'availability.currentLocation': '2dsphere' });

// Virtual for team size
deliveryTeamSchema.virtual('teamSize').get(function() {
  return this.members.length + 1; // +1 for team lead
});

// Methods
deliveryTeamSchema.methods.isAvailableForDelivery = async function(pincode) {
  if (!this.availability.isAvailable || !this.availability.isOnDuty) return false;
  if (this.currentDeliveries.length >= this.maxConcurrentDeliveries) return false;
  if (!this.serviceablePincodes.includes(pincode)) return false;
  return true;
};

deliveryTeamSchema.methods.updatePerformance = async function(deliveryData) {
  this.performance.totalDeliveries += 1;
  if (deliveryData.status === 'delivered') {
    this.performance.completedDeliveries += 1;
    if (deliveryData.onTime) {
      this.performance.onTimeRate = 
        ((this.performance.onTimeRate * (this.performance.completedDeliveries - 1)) + 100) / this.performance.completedDeliveries;
    }
  } else if (deliveryData.status === 'failed') {
    this.performance.failedDeliveries += 1;
  }
  if (deliveryData.distance) this.performance.totalDistance += deliveryData.distance;
  if (deliveryData.earnings) this.performance.totalEarnings += deliveryData.earnings;
  await this.save();
};

// Pre-save middleware to generate team code
deliveryTeamSchema.pre('save', async function(next) {
  if (this.isNew && !this.teamCode) {
    const count = await mongoose.model('DeliveryTeam').countDocuments();
    this.teamCode = `TEAM${(count + 1).toString().padStart(4, '0')}`;
  }
  // next();
});

module.exports = mongoose.model('DeliveryTeam', deliveryTeamSchema);