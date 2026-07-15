// models/Payment.model.js
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  paymentNumber: {
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
  rental: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rental',
    required: true,
    index: true
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  type: {
    type: String,
    enum: [
      'security_deposit',
      'rent',
      'delivery',
      'late_fee',
      'damage_charge',
      'extension',
      'refund'
    ],
    required: true,
    index: true
  },
  method: {
    type: String,
    enum: [
      'credit_card',
      'debit_card',
      'upi',
      'net_banking',
      'wallet',
      'cash',
      'bank_transfer'
    ],
    required: true
  },
  paymentDetails: {
    gateway: {
      type: String,
      enum: ['razorpay', 'stripe'],
      default: 'razorpay'
    },
    breakdown: mongoose.Schema.Types.Mixed,
    cardLast4: String,
    cardBrand: String,
    upiId: String,
    bankName: String,
    accountNumber: String,
    transactionId: String,
    referenceNumber: String,
    razorpayPaymentId: String,
    razorpayOrderId: String,
    razorpaySignature: String
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'success', 'failed', 'refunded', 'cancelled'],
    default: 'pending',
    index: true
  },
  timestamps: {
    initiated: { type: Date, default: Date.now },
    processed: Date,
    completed: Date,
    failed: Date,
    refunded: Date
  },
  failureReason: String,
  refundDetails: {
    amount: Number,
    reason: String,
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    processedAt: Date,
    transactionId: String
  },
  receipt: {
    url: String,
    generatedAt: Date,
    sentToEmail: Boolean
  },
  metadata: {
    ipAddress: String,
    userAgent: String,
    notes: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }
}, {
  timestamps: true
});

// Indexes
// paymentSchema.index({ paymentNumber: 1 });
paymentSchema.index({ user: 1, createdAt: -1 });
paymentSchema.index({ rental: 1, type: 1 });
paymentSchema.index({ status: 1, createdAt: 1 });

// Pre-save middleware to generate payment number
paymentSchema.pre('save', async function(next) {
  if (this.isNew) {
    const count = await mongoose.model('Payment').countDocuments();
    this.paymentNumber = `PAY${Date.now().toString().slice(-8)}${(count + 1).toString().padStart(4, '0')}`;
  }
  // next();
});

// Methods
paymentSchema.methods.markSuccess = async function(transactionId) {
  this.status = 'success';
  this.timestamps.completed = new Date();
  if (transactionId) {
    this.paymentDetails.transactionId = transactionId;
  }
  await this.save();
  
  // Update rental payment status
  const Rental = mongoose.model('Rental');
  await Rental.updateOne(
    { _id: this.rental },
    { 
      $push: { 'payment.paymentHistory': this._id },
      $inc: { 'payment.paidAmount': this.amount },
      $set: { 
        'payment.status': 'partial',
        'payment.nextDueDate': this.calculateNextDueDate()
      }
    }
  );
};

paymentSchema.methods.markFailed = function(reason) {
  this.status = 'failed';
  this.timestamps.failed = new Date();
  this.failureReason = reason;
  return this.save();
};

paymentSchema.methods.calculateNextDueDate = function() {
  // Logic to calculate next due date based on rental
  return new Date();
};

module.exports = mongoose.model('Payment', paymentSchema);