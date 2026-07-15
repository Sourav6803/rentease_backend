const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  reviewNumber: {
    type: String,
    unique: true,
    index: true
  },
  rental: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rental',
    required: true,
    unique: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    index: true
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  ratings: {
    overall: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    product: {
      quality: { type: Number, min: 1, max: 5 },
      condition: { type: Number, min: 1, max: 5 },
      valueForMoney: { type: Number, min: 1, max: 5 },
      matchesDescription: { type: Number, min: 1, max: 5 }
    },
    vendor: {
      communication: { type: Number, min: 1, max: 5 },
      deliveryTimeliness: { type: Number, min: 1, max: 5 },
      professionalism: { type: Number, min: 1, max: 5 },
      support: { type: Number, min: 1, max: 5 }
    },
    delivery: {
      timeliness: { type: Number, min: 1, max: 5 },
      packaging: { type: Number, min: 1, max: 5 },
      handling: { type: Number, min: 1, max: 5 }
    }
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  pros: [String],
  cons: [String],
  tips: String,
  attachments: [{
    type: {
      type: String,
      enum: ['image', 'video']
    },
    url: String,
    caption: String,
    isVerified: { type: Boolean, default: false }
  }],
  helpful: {
    count: { type: Number, default: 0 },
    users: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      votedAt: { type: Date, default: Date.now }
    }]
  },
  reported: {
    count: { type: Number, default: 0 },
    reasons: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reason: String,
      reportedAt: { type: Date, default: Date.now },
      status: { type: String, enum: ['pending', 'reviewed', 'dismissed'] }
    }]
  },
  responses: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    content: {
      type: String,
      required: true,
      maxlength: 500
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: Date,
    isVendorResponse: { type: Boolean, default: false },
    helpful: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      votedAt: Date
    }]
  }],
  verification: {
    isVerifiedPurchase: { type: Boolean, default: true },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: Date,
    verificationMethod: String
  },
  moderation: {
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'flagged'],
      default: 'pending',
      index: true
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    rejectionReason: String,
    moderationNotes: String,
    flags: [{
      type: { type: String },
      description: String,
      flaggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      flaggedAt: Date
    }]
  },
  statistics: {
    viewCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 },
    shareCount: { type: Number, default: 0 },
    lastViewedAt: Date
  },
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    source: { type: String, enum: ['web', 'mobile', 'email', 'admin'] },
    ipAddress: String,
    userAgent: String,
    tags: [String]
  },
  status: {
    type: String,
    enum: ['active', 'hidden', 'deleted'],
    default: 'active',
    index: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
// reviewSchema.index({ reviewNumber: 1 });
reviewSchema.index({ product: 1, 'moderation.status': 1, createdAt: -1 });
reviewSchema.index({ vendor: 1, 'ratings.overall': 1 });
reviewSchema.index({ user: 1, createdAt: -1 });
reviewSchema.index({ 'ratings.overall': 1, 'helpful.count': -1 });
reviewSchema.index({ 'verification.isVerifiedPurchase': 1 });

// Pre-save middleware to generate review number
reviewSchema.pre('save', async function(next) {
  if (this.isNew && !this.reviewNumber) {
    const count = await mongoose.model('Review').countDocuments();
    this.reviewNumber = `REV${Date.now().toString().slice(-8)}${(count + 1).toString().padStart(4, '0')}`;
  }
  next();
});

// Pre-save middleware to ensure only one review per rental
reviewSchema.pre('save', async function(next) {
  if (this.isNew) {
    const existing = await this.constructor.findOne({ rental: this.rental });
    if (existing) {
      next(new Error('Review already exists for this rental'));
    }
  }
  next();
});

// Post-save middleware to update product ratings
reviewSchema.post('save', async function() {
  const Product = mongoose.model('Product');
  await Product.findByIdAndUpdate(this.product, {
    $inc: { 'ratings.count': 1 },
    $set: { 'ratings.average': await this.constructor.getAverageRating(this.product) }
  });
});

// Post-save middleware to update vendor ratings
reviewSchema.post('save', async function() {
  const User = mongoose.model('User');
  // You might want to store vendor ratings in vendor profile
  // This is just an example
});

// Method to mark as helpful
reviewSchema.methods.markHelpful = async function(userId) {
  if (!this.helpful.users.some(u => u.user.toString() === userId.toString())) {
    this.helpful.count += 1;
    this.helpful.users.push({
      user: userId,
      votedAt: new Date()
    });
    await this.save();
  }
};

// Method to report review
reviewSchema.methods.report = async function(userId, reason) {
  this.reported.count += 1;
  this.reported.reasons.push({
    user: userId,
    reason,
    reportedAt: new Date(),
    status: 'pending'
  });
  
  // Auto-flag if multiple reports
  if (this.reported.count >= 3) {
    this.moderation.status = 'flagged';
  }
  
  await this.save();
};

// Method to add vendor response
reviewSchema.methods.addResponse = async function(userId, content, isVendorResponse = false) {
  this.responses.push({
    user: userId,
    content,
    isVendorResponse,
    createdAt: new Date()
  });
  await this.save();
};

// Static method to get average rating for product
reviewSchema.statics.getAverageRating = async function(productId) {
  const result = await this.aggregate([
    { $match: { product: productId, 'moderation.status': 'approved', status: 'active' } },
    { $group: { _id: null, average: { $avg: '$ratings.overall' } } }
  ]);
  return result.length > 0 ? result[0].average : 0;
};

// Static method to get product reviews with pagination
reviewSchema.statics.getProductReviews = async function(productId, query = {}) {
  const {
    page = 1,
    limit = 10,
    sortBy = '-createdAt',
    rating,
    hasMedia,
    verifiedOnly
  } = query;

  const filter = {
    product: productId,
    'moderation.status': 'approved',
    status: 'active'
  };

  if (rating) filter['ratings.overall'] = parseInt(rating);
  if (hasMedia) filter['attachments.0'] = { $exists: true };
  if (verifiedOnly) filter['verification.isVerifiedPurchase'] = true;

  const reviews = await this.find(filter)
    .populate('user', 'profile.firstName profile.lastName profile.avatar verification.kyc.status')
    .populate('responses.user', 'profile.firstName profile.lastName role')
    .sort(sortBy)
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  const total = await this.countDocuments(filter);

  // Get rating distribution
  const distribution = await this.aggregate([
    { $match: { product: productId, 'moderation.status': 'approved', status: 'active' } },
    { $group: { _id: '$ratings.overall', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);

  const distributionMap = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  distribution.forEach(d => { distributionMap[d._id] = d.count; });

  return {
    reviews,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    },
    summary: {
      averageRating: await this.getAverageRating(productId),
      totalReviews: total,
      distribution: distributionMap,
      withMedia: await this.countDocuments({ ...filter, 'attachments.0': { $exists: true } }),
      verifiedOnly: await this.countDocuments({ ...filter, 'verification.isVerifiedPurchase': true })
    }
  };
};

// Static method to moderate reviews
reviewSchema.statics.moderateReviews = async function() {
  const pendingReviews = await this.find({
    'moderation.status': 'pending',
    status: 'active'
  }).populate('user', 'profile.firstName profile.lastName');

  // Auto-moderate based on rules
  for (const review of pendingReviews) {
    let autoApproved = true;
    let rejectionReason = null;

    // Check for inappropriate content
    const inappropriateWords = ['spam', 'abuse', 'hate']; // Add more
    if (inappropriateWords.some(word => review.content.toLowerCase().includes(word))) {
      autoApproved = false;
      rejectionReason = 'Contains inappropriate content';
    }

    // Check content length
    if (review.content.length < 10) {
      autoApproved = false;
      rejectionReason = 'Review is too short';
    }

    if (autoApproved) {
      review.moderation.status = 'approved';
    } else {
      review.moderation.status = 'rejected';
      review.moderation.rejectionReason = rejectionReason;
    }

    await review.save();
  }

  return pendingReviews.length;
};

// Virtual for helpful percentage
reviewSchema.virtual('helpfulPercentage').get(function() {
  if (this.helpful.count === 0) return 0;
  return Math.round((this.helpful.count / (this.helpful.count + this.reported.count)) * 100);
});

// Virtual for time since posted
reviewSchema.virtual('timeSincePosted').get(function() {
  const now = new Date();
  const diff = now - this.createdAt;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(months / 12);

  if (years > 0) return `${years} year${years > 1 ? 's' : ''} ago`;
  if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`;
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
});

module.exports = mongoose.model('Review', reviewSchema);