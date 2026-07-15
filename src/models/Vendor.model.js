const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  vendorId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  business: {
    name: {
      type: String,
      required: true,
      trim: true
    },
    legalName: String,
    registrationNumber: String,
    gstin: {
      type: String,
      uppercase: true,
      trim: true,
      index: true
    },
    panNumber: {
      type: String,
      uppercase: true,
      trim: true
    },
    website: String,
    description: String,
    foundedYear: Number,
    employeeCount: Number,
    businessType: {
      type: String,
      enum: [
        'individual',
        'partnership',
        'private_limited',
        'public_limited',
        'llp',
        'sole_proprietorship'
      ]
    }
  },
  contact: {
    primaryPhone: {
      type: String,
      required: true
    },
    secondaryPhone: String,
    primaryEmail: {
      type: String,
      required: true,
      lowercase: true
    },
    secondaryEmail: String,
    supportPhone: String,
    supportEmail: String,
    emergencyContact: {
      name: String,
      phone: String,
      relationship: String
    }
  },
  addresses: {
    registeredOffice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Address'
    },
    warehouse: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Address'
    }],
    serviceablePincodes: [{
      type: String,
      // index: true
    }],
    serviceableCities: [{
      city: String,
      state: String,
      isActive: { type: Boolean, default: true }
    }]
  },
  verification: {
    status: {
      type: String,
      enum: ['pending', 'verified', 'rejected', 'suspended'],
      default: 'pending',
      index: true
    },
    documents: [{
      type: {
        type: String,
        enum: [
          'gst_certificate',
          'pan_card',
          'business_registration',
          'address_proof',
          'bank_statement',
          'cancelled_cheque',
          'incorporation_certificate'
        ]
      },
      url: String,
      documentNumber: String,
      verifiedAt: Date,
      verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      expiryDate: Date,
      remarks: String
    }],
    verifiedAt: Date,
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: String
  },
  bankDetails: {
    accountHolderName: String,
    accountNumber: {
      type: String,
      select: false
    },
    confirmAccountNumber: {
      type: String,
      select: false,
      validate: {
        validator: function(value) {
          return value === this.bankDetails.accountNumber;
        },
        message: 'Account numbers do not match'
      }
    },
    ifscCode: String,
    bankName: String,
    branchName: String,
    accountType: {
      type: String,
      enum: ['savings', 'current']
    },
    upiId: String,
    verified: { type: Boolean, default: false }
  },
  commission: {
    rate: {
      type: Number,
      min: 0,
      max: 100,
      default: 10 // 10% default commission
    },
    type: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'percentage'
    },
    fixedAmount: Number,
    monthlyCap: Number,
    yearlyCap: Number,
    specialRates: [{
      category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
      rate: Number,
      validUntil: Date
    }]
  },
  products: {
    total: { type: Number, default: 0 },
    active: { type: Number, default: 0 },
    rented: { type: Number, default: 0 },
    available: { type: Number, default: 0 },
    categories: [{
      category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
      count: Number
    }],
    topProducts: [{
      product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      rentalCount: Number,
      revenue: Number
    }]
  },
  performance: {
    rating: {
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
    metrics: {
      totalRentals: { type: Number, default: 0 },
      completedRentals: { type: Number, default: 0 },
      cancelledRentals: { type: Number, default: 0 },
      totalRevenue: { type: Number, default: 0 },
      averageRentalValue: { type: Number, default: 0 },
      customerSatisfaction: { type: Number, default: 0 },
      responseRate: { type: Number, default: 0 },
      responseTime: Number, // in minutes
      fulfillmentRate: { type: Number, default: 0 },
      onTimeDelivery: { type: Number, default: 0 }
    },
    trends: {
      weeklyRentals: [{
        week: Date,
        count: Number,
        revenue: Number
      }],
      monthlyRentals: [{
        month: Date,
        count: Number,
        revenue: Number
      }]
    }
  },
  subscription: {
    plan: {
      type: String,
      enum: ['basic', 'standard', 'premium', 'enterprise'],
      default: 'basic'
    },
    validUntil: Date,
    autoRenew: { type: Boolean, default: true },
    features: [String],
    limits: {
      maxProducts: { type: Number, default: 50 },
      maxRentalsPerMonth: { type: Number, default: 100 },
      maxInventoryItems: { type: Number, default: 200 },
      prioritySupport: { type: Boolean, default: false },
      analyticsAccess: { type: Boolean, default: false }
    },
    payments: [{
      date: Date,
      amount: Number,
      transactionId: String,
      status: String
    }]
  },
  settings: {
    autoConfirmBookings: { type: Boolean, default: false },
    instantBooking: { type: Boolean, default: false },
    advanceNotice: { type: Number, default: 24 }, // hours
    minRentalDuration: { type: Number, default: 3 }, // months
    maxRentalDuration: { type: Number, default: 12 }, // months
    cancellationPolicy: {
      type: String,
      enum: ['flexible', 'moderate', 'strict'],
      default: 'moderate'
    },
    notificationPreferences: {
      newRentals: { type: Boolean, default: true },
      cancellations: { type: Boolean, default: true },
      maintenanceRequests: { type: Boolean, default: true },
      payments: { type: Boolean, default: true },
      reviews: { type: Boolean, default: true },
      dailyDigest: { type: Boolean, default: false }
    },
    businessHours: [{
      day: {
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      },
      isOpen: { type: Boolean, default: true },
      openTime: String,
      closeTime: String,
      breaks: [{
        start: String,
        end: String
      }]
    }]
  },
  payments: {
    pending: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },
    dueDate: Date,
    paymentHistory: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment'
    }],
    payoutSchedule: {
      type: String,
      enum: ['daily', 'weekly', 'biweekly', 'monthly'],
      default: 'weekly'
    },
    nextPayoutDate: Date
  },
  compliance: {
    termsAccepted: { type: Boolean, default: false },
    termsAcceptedAt: Date,
    agreementSigned: { type: Boolean, default: false },
    agreementUrl: String,
    dataProcessingAccepted: { type: Boolean, default: false },
    trainingCompleted: [{
      module: String,
      completedAt: Date
    }]
  },
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    onboardedAt: Date,
    lastActive: Date,
    tags: [String],
    notes: String
  },
  status: {
    isActive: { type: Boolean, default: true, index: true },
    isBlocked: { type: Boolean, default: false },
    blockReason: String,
    blockedAt: Date,
    blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isOnboarded: { type: Boolean, default: false },
    onboardedAt: Date,
    deactivationReason: String,
    deactivatedAt: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
// vendorSchema.index({ vendorId: 1 });
vendorSchema.index({ 'business.name': 'text', 'business.gstin': 1 });
vendorSchema.index({ 'verification.status': 1, status: 1 });
vendorSchema.index({ 'performance.rating.average': -1 });
vendorSchema.index({ 'addresses.serviceablePincodes': 1 });
vendorSchema.index({ 'subscription.plan': 1, 'subscription.validUntil': 1 });

// Pre-save middleware to generate vendor ID (async hooks must not use `next`; Mongoose awaits the promise)
vendorSchema.pre('save', async function () {
  if (this.isNew && !this.vendorId) {
    const count = await mongoose.model('Vendor').countDocuments();
    this.vendorId = `VEN${Date.now().toString().slice(-8)}${(count + 1).toString().padStart(4, '0')}`;
  }
});

// Method to update performance metrics
vendorSchema.methods.updatePerformanceMetrics = async function() {
  const Rental = mongoose.model('Rental');
  const Review = mongoose.model('Review');

  // Get rental stats
  const rentalStats = await Rental.aggregate([
    { $match: { vendor: this.user } },
    {
      $group: {
        _id: null,
        totalRentals: { $sum: 1 },
        completedRentals: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
        },
        cancelledRentals: {
          $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
        },
        totalRevenue: { $sum: '$rentalDetails.totalAmount' }
      }
    }
  ]);

  // Get review stats
  const reviewStats = await Review.aggregate([
    { $match: { vendor: this.user, 'moderation.status': 'approved' } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$ratings.overall' },
        totalReviews: { $sum: 1 },
        distribution: {
          $push: '$ratings.overall'
        }
      }
    }
  ]);

  if (rentalStats.length > 0) {
    this.performance.metrics.totalRentals = rentalStats[0].totalRentals;
    this.performance.metrics.completedRentals = rentalStats[0].completedRentals;
    this.performance.metrics.cancelledRentals = rentalStats[0].cancelledRentals;
    this.performance.metrics.totalRevenue = rentalStats[0].totalRevenue;
    this.performance.metrics.averageRentalValue = 
      rentalStats[0].totalRevenue / rentalStats[0].completedRentals || 0;
    this.performance.metrics.fulfillmentRate = 
      (rentalStats[0].completedRentals / rentalStats[0].totalRentals) * 100 || 0;
  }

  if (reviewStats.length > 0) {
    this.performance.rating.average = reviewStats[0].averageRating;
    this.performance.rating.count = reviewStats[0].totalReviews;
    
    const dist = {1:0,2:0,3:0,4:0,5:0};
    reviewStats[0].distribution.forEach(r => dist[r]++);
    this.performance.rating.distribution = dist;
  }

  await this.save();
};

// Method to check if vendor can accept new rental
vendorSchema.methods.canAcceptRental = async function() {
  // Check if vendor is active
  if (!this.status.isActive || this.status.isBlocked) {
    return { allowed: false, reason: 'Vendor account is not active' };
  }

  // Check verification status
  if (this.verification.status !== 'verified') {
    return { allowed: false, reason: 'Vendor is not verified' };
  }

  // Check subscription limits
  if (this.subscription.limits) {
    const activeRentals = await mongoose.model('Rental').countDocuments({
      vendor: this.user,
      status: { $in: ['active', 'confirmed', 'delivered'] }
    });

    if (activeRentals >= this.subscription.limits.maxRentalsPerMonth) {
      return { allowed: false, reason: 'Monthly rental limit reached' };
    }

    const activeProducts = await mongoose.model('Product').countDocuments({
      vendor: this.user,
      'status.isActive': true
    });

    if (activeProducts >= this.subscription.limits.maxProducts) {
      return { allowed: false, reason: 'Product limit reached' };
    }
  }

  return { allowed: true };
};

// Method to calculate commission
vendorSchema.methods.calculateCommission = function(amount, categoryId = null) {
  // Check for special rates
  if (categoryId && this.commission.specialRates) {
    const special = this.commission.specialRates.find(
      s => s.category.toString() === categoryId.toString() && 
      (!s.validUntil || s.validUntil > new Date())
    );
    if (special) {
      return special.rate;
    }
  }

  // Use default commission
  if (this.commission.type === 'percentage') {
    const commissionAmount = (amount * this.commission.rate) / 100;
    
    // Check caps
    if (this.commission.monthlyCap) {
      // Would need to calculate monthly commission total
      // This is simplified
      return Math.min(commissionAmount, this.commission.monthlyCap);
    }
    
    return commissionAmount;
  } else {
    return this.commission.fixedAmount || 0;
  }
};

// Static method to get top vendors
vendorSchema.statics.getTopVendors = async function(limit = 10, categoryId = null) {
  const match = { status: 'active', 'verification.status': 'verified' };
  
  if (categoryId) {
    match['products.categories.category'] = categoryId;
  }

  return this.find(match)
    .sort({ 'performance.rating.average': -1, 'performance.metrics.completedRentals': -1 })
    .limit(limit)
    .populate('user', 'profile.firstName profile.lastName profile.avatar')
    .select('vendorId business.name performance.rating performance.metrics.completedRentals');
};

// Static method to generate vendor report
vendorSchema.statics.generateReport = async function(vendorId, startDate, endDate) {
  const Rental = mongoose.model('Rental');
  const Product = mongoose.model('Product');
  const Maintenance = mongoose.model('Maintenance');

  const [rentals, products, maintenance, revenue] = await Promise.all([
    // Rental stats
    Rental.aggregate([
      {
        $match: {
          vendor: vendorId,
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
          revenue: { $sum: '$rentalDetails.totalAmount' }
        }
      },
      { $sort: { _id: 1 } }
    ]),

    // Product stats
    Product.countDocuments({ vendor: vendorId, createdAt: { $gte: startDate, $lte: endDate } }),

    // Maintenance stats
    Maintenance.aggregate([
      {
        $match: {
          vendor: vendorId,
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          cost: { $sum: '$resolution.cost.total' }
        }
      }
    ]),

    // Total revenue
    Rental.aggregate([
      {
        $match: {
          vendor: vendorId,
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$rentalDetails.totalAmount' },
          commission: { $sum: { $multiply: ['$rentalDetails.totalAmount', 0.1] } } // 10% commission
        }
      }
    ])
  ]);

  return {
    period: { startDate, endDate },
    rentals: {
      daily: rentals,
      total: rentals.reduce((sum, d) => sum + d.count, 0)
    },
    products: {
      newProducts: products
    },
    maintenance: maintenance[0] || { total: 0, completed: 0, cost: 0 },
    revenue: revenue[0] || { totalRevenue: 0, commission: 0 },
    netEarnings: (revenue[0]?.totalRevenue || 0) - (revenue[0]?.commission || 0)
  };
};

// Virtual for completion rate
vendorSchema.virtual('completionRate').get(function() {
  if (this.performance.metrics.totalRentals === 0) return 0;
  return (this.performance.metrics.completedRentals / this.performance.metrics.totalRentals) * 100;
});

// Virtual for monthly revenue
vendorSchema.virtual('monthlyRevenue').get(function() {
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  
  const monthlyRentals = this.performance.trends.monthlyRentals?.find(
    m => new Date(m.month) > oneMonthAgo
  );
  
  return monthlyRentals?.revenue || 0;
});

module.exports = mongoose.model('Vendor', vendorSchema);