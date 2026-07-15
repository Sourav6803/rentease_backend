// models/Rental.model.js
const mongoose = require('mongoose');

const rentalSchema = new mongoose.Schema({
  rentalNumber: {
    type: String,
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
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true,
    index: true
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  inventory: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inventory',
    required: true
  }],
  address: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Address',
    required: true
  },
  rentalDetails: {
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    actualEndDate: Date,
    tenureMonths: { type: Number, required: true },
    monthlyRent: { type: Number, required: true },
    securityDeposit: { type: Number, required: true },
    deliveryCharges: { type: Number, default: 0 },
    discount: {
      type: { type: String, enum: ['percentage', 'fixed'] },
      value: Number,
      amount: Number,
      couponCode: String
    },
    subtotal: Number,
    tax: Number,
    totalAmount: Number
  },
  payment: {
    status: {
      type: String,
      enum: ['pending', 'partial', 'completed', 'refunded'],
      default: 'pending',
      index: true
    },
    paidAmount: { type: Number, default: 0 },
    dueAmount: Number,
    nextDueDate: Date,
    paymentHistory: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment'
    }],
    refundAmount: Number,
    refundDate: Date,
    refundReason: String
  },
  delivery: {
    deliveryNumber: String,
    scheduledDate: Date,
    actualDate: Date,
    status: String,
    deliveredBy: String,
    receivedBy: String,
    signature: String,
    photos: [String],
    notes: String
  },
  pickup: {
    scheduledDate: Date,
    actualDate: Date,
    status: String,
    pickedBy: String,
    condition: String,
    photos: [String],
    notes: String
  },
  status: {
    type: String,
    enum: [
      'pending', 'confirmed', 'ready_for_delivery', 'out_for_delivery',
      'delivered', 'active', 'extension_requested', 'return_initiated',
      'out_for_pickup', 'completed', 'cancelled', 'overdue', 'disputed'
    ],
    default: 'pending',
    index: true
  },
  timeline: [{
    status: String,
    timestamp: Date,
    note: String,
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  extensions: [{
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requestedDate: Date,
    newEndDate: Date,
    additionalMonths: Number,
    additionalAmount: Number,
    status: { type: String, enum: ['pending', 'approved', 'rejected'] },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }
  }],
  cancellation: {
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requestedAt: Date,
    reason: String,
    cancellationCharge: Number,
    refundAmount: Number,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    status: { type: String, enum: ['pending', 'approved', 'rejected'] }
  },
  damages: [{
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reportedAt: Date,
    description: String,
    images: [String],
    severity: { type: String, enum: ['minor', 'major', 'severe'] },
    charge: Number,
    status: { type: String, enum: ['pending', 'approved', 'waived', 'paid'] },
    resolvedAt: Date,
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }
  }],
  maintenance: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Maintenance'
  }],
  reviews: {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'Review' },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Review' }
  },
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    source: { type: String, enum: ['web', 'mobile', 'admin'] }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});



// Indexes
// rentalSchema.index({ rentalNumber: 1 });
rentalSchema.index({ user: 1, status: 1 });
rentalSchema.index({ vendor: 1, status: 1 });
rentalSchema.index({ 'rentalDetails.startDate': 1, 'rentalDetails.endDate': 1 });
rentalSchema.index({ 'payment.status': 1, 'payment.nextDueDate': 1 });
rentalSchema.index({ createdAt: -1 });

// Pre-save middleware to generate rental number
rentalSchema.pre('save', async function(next) {
  if (this.isNew) {
    const count = await mongoose.model('Rental').countDocuments();
    this.rentalNumber = `RENT${Date.now().toString().slice(-8)}${(count + 1).toString().padStart(4, '0')}`;
  }
  // next();
});

// Methods
rentalSchema.methods.calculateTotal = function() {
  const details = this.rentalDetails;
  const subtotal = details.monthlyRent * details.tenureMonths;
  const discountAmount = details.discount?.type === 'percentage' 
    ? subtotal * details.discount.value / 100
    : details.discount?.amount || 0;
  
  this.rentalDetails.subtotal = subtotal;
  this.rentalDetails.totalAmount = subtotal + details.securityDeposit + details.deliveryCharges - discountAmount;
  this.payment.dueAmount = this.rentalDetails.totalAmount;
};

rentalSchema.methods.addTimeline = function(status, note, userId) {
  this.timeline.push({
    status,
    timestamp: new Date(),
    note,
    updatedBy: userId
  });
};

module.exports = mongoose.model('Rental', rentalSchema);