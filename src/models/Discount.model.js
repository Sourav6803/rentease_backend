const mongoose = require('mongoose');

const discountSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  description: String,
  type: {
    type: String,
    enum: [
      'percentage', 'fixed', 'free_delivery', 'no_deposit',
      'cashback', 'referral', 'festival', 'birthday', 'first_rental', 'return_customer',
    ],
    required: true
  },
  value: {
    type: Number,
    required: function() {
      return this.type === 'percentage' || this.type === 'fixed';
    },
    min: 0
  },
  maxDiscountAmount: {
    type: Number,
    min: 0
  },
  minOrderValue: {
    type: Number,
    min: 0,
    default: 0
  },
  applicableOn: {
    type: {
      type: String,
      enum: ['all', 'category', 'product', 'vendor', 'rental_tenure', 'first_rental', 'customer', 'festival'],
      default: 'all'
    },
    categoryIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category'
    }],
    productIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    }],
    vendorIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    tenureMonths: [Number]
  },
  userEligibility: {
    userType: {
      type: String,
      enum: ['all', 'new', 'existing', 'specific'],
      default: 'all'
    },
    userIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    minRentalsCompleted: Number,
    minAmountSpent: Number,
    userSegment: [String]
  },
  usageLimits: {
    perUser: {
      type: Number,
      default: 1
    },
    global: {
      type: Number,
      default: null
    },
    perDay: Number,
    perWeek: Number,
    perMonth: Number
  },
  usageCount: {
    type: Number,
    default: 0
  },
  usageHistory: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rental: { type: mongoose.Schema.Types.ObjectId, ref: 'Rental' },
    usedAt: { type: Date, default: Date.now },
    discountAmount: Number,
    orderValue: Number
  }],
  validity: {
    startDate: {
      type: Date,
      required: true,
      index: true
    },
    endDate: {
      type: Date,
      required: true,
      index: true
    },
    isActive: {
      type: Boolean,
      default: true
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata'
    }
  },
  stackable: {
    type: Boolean,
    default: false
  },
  priority: {
    type: Number,
    default: 0
  },
  displayConditions: {
    showOnCheckout: { type: Boolean, default: true },
    showOnProduct: { type: Boolean, default: false },
    autoApply: { type: Boolean, default: false },
    requireMinimumItems: Number
  },
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    campaign: String,
    source: String,
    notes: String,
    tags: [String]
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'expired', 'disabled'],
    default: 'active',
    index: true
  }
}, {
  timestamps: true
});

// Indexes
discountSchema.index({ code: 1, status: 1 });
discountSchema.index({ 'validity.startDate': 1, 'validity.endDate': 1 });
discountSchema.index({ 'usageLimits.perUser': 1 });
discountSchema.index({ 'applicableOn.categoryIds': 1 });
discountSchema.index({ 'applicableOn.productIds': 1 });

// Pre-save middleware to validate dates
discountSchema.pre('save', function(next) {
  if (this.validity.startDate >= this.validity.endDate) {
    next(new Error('End date must be after start date'));
  }
  
  // Update status based on validity
  const now = new Date();
  if (now < this.validity.startDate) {
    this.status = 'inactive';
  } else if (now > this.validity.endDate) {
    this.status = 'expired';
  }
  
  // next();
});

// Method to check if discount is valid
discountSchema.methods.isValid = function() {
  const now = new Date();
  return (
    this.status === 'active' &&
    now >= this.validity.startDate &&
    now <= this.validity.endDate &&
    (this.usageLimits.global === null || this.usageCount < this.usageLimits.global)
  );
};

// Method to validate for user
discountSchema.methods.validateForUser = async function(userId, orderValue = 0, rentalMonths = null, productIds = []) {
  // Check basic validity
  if (!this.isValid()) {
    return { valid: false, reason: 'Discount is not active' };
  }

  // Check minimum order value
  if (orderValue < this.minOrderValue) {
    return { valid: false, reason: `Minimum order value should be ${this.minOrderValue}` };
  }

  // Check user eligibility
  if (this.userEligibility.userType === 'specific') {
    if (!this.userEligibility.userIds.includes(userId)) {
      return { valid: false, reason: 'Discount not applicable for this user' };
    }
  }

  // Check per-user usage limit
  if (this.usageLimits.perUser) {
    const userUsage = this.usageHistory.filter(h => h.user.toString() === userId.toString()).length;
    if (userUsage >= this.usageLimits.perUser) {
      return { valid: false, reason: 'You have already used this discount' };
    }
  }

  // Check product applicability
  if (this.applicableOn.type === 'product' && productIds.length > 0) {
    const applicable = productIds.some(id => 
      this.applicableOn.productIds.includes(id)
    );
    if (!applicable) {
      return { valid: false, reason: 'Discount not applicable for selected products' };
    }
  }

  // Check category applicability
  if (this.applicableOn.type === 'category' && productIds.length > 0) {
    const Product = mongoose.model('Product');
    const products = await Product.find({ _id: { $in: productIds } }).select('category');
    const applicable = products.some(p => 
      this.applicableOn.categoryIds.includes(p.category)
    );
    if (!applicable) {
      return { valid: false, reason: 'Discount not applicable for selected categories' };
    }
  }

  // Check tenure applicability
  if (this.applicableOn.tenureMonths && this.applicableOn.tenureMonths.length > 0 && rentalMonths) {
    if (!this.applicableOn.tenureMonths.includes(rentalMonths)) {
      return { valid: false, reason: 'Discount not applicable for this rental tenure' };
    }
  }

  return { valid: true };
};

// Method to calculate discount amount
discountSchema.methods.calculateDiscount = function(orderValue) {
  let discountAmount = 0;
  
  switch (this.type) {
    case 'percentage':
      discountAmount = (orderValue * this.value) / 100;
      if (this.maxDiscountAmount) {
        discountAmount = Math.min(discountAmount, this.maxDiscountAmount);
      }
      break;
    case 'fixed':
      discountAmount = Math.min(this.value, orderValue);
      break;
    case 'free_delivery':
      // Handle in rental calculation
      discountAmount = 0;
      break;
    case 'no_deposit':
      // Handle in rental calculation
      discountAmount = 0;
      break;
  }
  
  return discountAmount;
};

// Method to apply discount
discountSchema.methods.apply = async function(userId, rentalId, orderValue) {
  if (!this.isValid()) {
    throw new Error('Discount is not valid');
  }

  const discountAmount = this.calculateDiscount(orderValue);
  
  this.usageCount += 1;
  this.usageHistory.push({
    user: userId,
    rental: rentalId,
    usedAt: new Date(),
    discountAmount,
    orderValue
  });
  
  await this.save();
  
  return {
    code: this.code,
    type: this.type,
    value: this.value,
    discountAmount
  };
};

// Static method to find applicable discounts
discountSchema.statics.findApplicable = async function(userId, orderValue, rentalMonths, productIds) {
  const now = new Date();
  
  const discounts = await this.find({
    status: 'active',
    'validity.startDate': { $lte: now },
    'validity.endDate': { $gte: now },
    $or: [
      { 'usageLimits.global': null },
      { 'usageLimits.global': { $gt: 0 }, usageCount: { $lt: '$usageLimits.global' } }
    ]
  }).sort({ priority: -1, createdAt: -1 });

  const applicableDiscounts = [];
  
  for (const discount of discounts) {
    const validation = await discount.validateForUser(userId, orderValue, rentalMonths, productIds);
    if (validation.valid) {
      const discountAmount = discount.calculateDiscount(orderValue);
      applicableDiscounts.push({
        ...discount.toObject(),
        calculatedDiscount: discountAmount
      });
    }
  }
  
  return applicableDiscounts;
};

module.exports = mongoose.model('Discount', discountSchema);