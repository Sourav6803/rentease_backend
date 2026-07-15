// models/Product.model.js
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true,
    index: true
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true,
    index: true
  },
  basicInfo: {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String, required: true },
    shortDescription: String,
    brand: String,
    model: String,
    sku: { type: String, unique: true, sparse: true }
  },
  pricing: {
    monthlyRent: { type: Number, required: true, min: 0 },
    securityDeposit: { type: Number, required: true, min: 0 },
    deliveryCharges: { type: Number, default: 0 },
    rentalOptions: [{
      months: { type: Number, required: true },
      discount: { type: Number, default: 0 },
      monthlyPrice: Number,
      totalPrice: Number
    }],
    lateFeePerDay: { type: Number, default: 0 },
    damageCharges: {
      small: Number,
      medium: Number,
      large: Number
    }
  },
  inventory: {
    totalQuantity: { type: Number, required: true, min: 0 },
    availableQuantity: { type: Number, required: true, min: 0 },
    rentedQuantity: { type: Number, default: 0 },
    maintenanceQuantity: { type: Number, default: 0 },
    minAlertQuantity: { type: Number, default: 5 }
  },
  specifications: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  },
  condition: {
    type: String,
    enum: ['new', 'like-new', 'good', 'fair', 'refurbished'],
    required: true
  },
  dimensions: {
    length: Number,
    width: Number,
    height: Number,
    weight: Number,
    unit: { type: String, enum: ['cm', 'inch', 'm'], default: 'cm' }
  },
  media: {
    images: [{
      url: String,
      thumbnail: String,
      isPrimary: Boolean,
      alt: String,
      order: Number
    }],
    videos: [{
      url: String,
      thumbnail: String,
      title: String
    }],
    documents: [{
      type: String,
      url: String,
      title: String
    }]
  },
  rentalTerms: {
    minRentalMonths: { type: Number, default: 3 },
    maxRentalMonths: { type: Number, default: 12 },
    cancellationPolicy: String,
    termsAndConditions: String,
    deliveryAvailable: { type: Boolean, default: true },
    pickupAvailable: { type: Boolean, default: true },
    serviceablePincodes: [String]
  },
  ratings: {
    average: { type: Number, default: 0, min: 0, max: 5 },
    count: { type: Number, default: 0 },
    distribution: {
      1: Number,
      2: Number,
      3: Number,
      4: Number,
      5: Number
    }
  },
  tags: [{
    type: String,
    index: true
  }],
  features: [String],
  status: {
    isActive: { type: Boolean, default: true, index: true },
    isFeatured: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    rejectionReason: String,
    approvedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  // Add to inventorySchema:
  statusHistory: [{
    status: String,
    reason: String,
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now }
  }],
  transferHistory: [{
    from: Object,
    to: Object,
    reason: String,
    transferredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    transferredAt: { type: Date, default: Date.now }
  }],
  retiredAt: Date,
  retiredReason: String,
  seo: {
    title: String,
    description: String,
    keywords: [String],
    slug: String
  },
  views: {
    count: { type: Number, default: 0 },
    uniqueVisitors: { type: Number, default: 0 },
    lastViewed: Date
  },
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for search and filtering
productSchema.index({ 'basicInfo.name': 'text', 'basicInfo.description': 'text', tags: 'text' });
productSchema.index({ 'pricing.monthlyRent': 1 });
productSchema.index({ category: 1, 'pricing.monthlyRent': 1 });
productSchema.index({ vendor: 1, status: 1 });
productSchema.index({ 'ratings.average': -1 });
productSchema.index({ 'inventory.availableQuantity': 1 });
productSchema.index({ 'rentalTerms.serviceablePincodes': 1 });

// Virtual for items
productSchema.virtual('items', {
  ref: 'Inventory',
  localField: '_id',
  foreignField: 'product'
});

// After your existing virtuals in Product.model.js
productSchema.virtual('reviews', {
  ref: 'Review',
  localField: '_id',
  foreignField: 'product',
  options: { sort: { createdAt: -1 } }
});

// Methods
productSchema.methods.updateAvailability = async function() {
  const Inventory = mongoose.model('Inventory');
  const available = await Inventory.countDocuments({
    product: this._id,
    status: 'available'
  });
  this.inventory.availableQuantity = available;
  await this.save();
};

productSchema.methods.updateRating = async function() {
  const Review = mongoose.model('Review');
  const stats = await Review.aggregate([
    { $match: { product: this._id } },
    { $group: {
      _id: null,
      average: { $avg: '$rating' },
      count: { $sum: 1 },
      distribution: {
        $push: '$rating'
      }
    }}
  ]);
  
  if (stats.length > 0) {
    this.ratings.average = stats[0].average;
    this.ratings.count = stats[0].count;
    // Calculate distribution
    const dist = {1:0,2:0,3:0,4:0,5:0};
    stats[0].distribution.forEach(r => dist[r]++);
    this.ratings.distribution = dist;
    await this.save();
  }
};

module.exports = mongoose.model('Product', productSchema);