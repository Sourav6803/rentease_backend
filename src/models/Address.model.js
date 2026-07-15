const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['home', 'work', 'other'],
    default: 'home'
  },
  addressLine1: {
    type: String,
    required: true,
    trim: true
  },
  addressLine2: {
    type: String,
    trim: true
  },
  landmark: String,
  city: {
    type: String,
    required: true,
    trim: true
  },
  state: {
    type: String,
    required: true,
    trim: true
  },
  pincode: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  country: {
    type: String,
    default: 'India',
    trim: true
  },
  coordinates: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      // index: '2dsphere'
    }
  },
  contactDetails: {
    name: String,
    phone: {
      type: String,
      validate: {
        validator: function(v) {
          return /^[0-9]{10}$/.test(v);
        },
        message: 'Invalid phone number'
      }
    },
    email: String
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationDetails: {
    verifiedAt: Date,
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    proofDocument: String,
    method: { type: String, enum: ['geocode', 'manual', 'delivery'] }
  },
  deliveryInstructions: String,
  tags: [String],
  status: {
    type: String,
    enum: ['active', 'inactive', 'deleted'],
    default: 'active'
  },
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ipAddress: String,
    userAgent: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
// addressSchema.index({ user: 1, isDefault: 1 });
addressSchema.index({ pincode: 1, city: 1 });
addressSchema.index({ 'coordinates.coordinates': '2dsphere' });
addressSchema.index({ status: 1, createdAt: -1 });

// Compound index for unique default address per user
addressSchema.index({ user: 1, isDefault: 1 }, { 
  unique: true,
  partialFilterExpression: { isDefault: true }
});

// Virtual for full address
addressSchema.virtual('fullAddress').get(function() {
  const parts = [
    this.addressLine1,
    this.addressLine2,
    this.landmark,
    this.city,
    this.state,
    this.pincode,
    this.country
  ].filter(Boolean);
  return parts.join(', ');
});

// Pre-save middleware
addressSchema.pre('save', async function(next) {
  // If this address is set as default, remove default from other addresses
  if (this.isDefault) {
    await this.constructor.updateMany(
      { user: this.user, _id: { $ne: this._id } },
      { $set: { isDefault: false } }
    );
  }
 
});

// Static methods
addressSchema.statics.findNearby = function(lng, lat, maxDistance = 5000) {
  return this.find({
    'coordinates.coordinates': {
      $near: {
        $geometry: { type: 'Point', coordinates: [lng, lat] },
        $maxDistance: maxDistance // meters
      }
    }
  });
};

// Instance methods
addressSchema.methods.verify = async function(userId, proofUrl) {
  this.isVerified = true;
  this.verificationDetails = {
    verifiedAt: new Date(),
    verifiedBy: userId,
    proofDocument: proofUrl,
    method: 'manual'
  };
  return this.save();
};

module.exports = mongoose.model('Address', addressSchema);