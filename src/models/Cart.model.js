// const mongoose = require('mongoose');

// const cartItemSchema = new mongoose.Schema(
//   {
//     product: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'Product',
//       required: true,
//     },
//     quantity: {
//       type: Number,
//       required: true,
//       min: 1,
//       default: 1,
//     },
//     rentalMonths: {
//       type: Number,
//       required: true,
//       min: 1,
//     },
//     pricing: {
//       monthlyRent: { type: Number, required: true, min: 0 },
//       effectiveMonthlyRent: { type: Number, required: true, min: 0 },
//       securityDeposit: { type: Number, required: true, min: 0 },
//       deliveryCharges: { type: Number, required: true, min: 0 },
//       discountPercent: { type: Number, default: 0, min: 0, max: 100 },
//     },
//     totals: {
//       monthlySubtotal: { type: Number, required: true, min: 0 },
//       tenureSubtotal: { type: Number, required: true, min: 0 },
//       securityDepositTotal: { type: Number, required: true, min: 0 },
//       deliveryChargesTotal: { type: Number, required: true, min: 0 },
//       lineTotal: { type: Number, required: true, min: 0 },
//     },
//     addedAt: {
//       type: Date,
//       default: Date.now,
//     },
//   },
//   { _id: true }
// );

// const cartSchema = new mongoose.Schema(
//   {
//     user: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'User',
//       required: true,
//       unique: true,
//       index: true,
//     },
//     items: [cartItemSchema],
//     summary: {
//       itemsCount: { type: Number, default: 0 },
//       totalQuantity: { type: Number, default: 0 },
//       monthlyRentTotal: { type: Number, default: 0 },
//       securityDepositTotal: { type: Number, default: 0 },
//       deliveryChargesTotal: { type: Number, default: 0 },
//       grandTotal: { type: Number, default: 0 },
//     },
//   },
//   {
//     timestamps: true,
//     toJSON: { virtuals: true },
//     toObject: { virtuals: true },
//   }
// );

// module.exports = mongoose.model('Cart', cartSchema);

const mongoose = require('mongoose');

// models/cart.model.js - Add these fields if not present
const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      default: 1
    },
    rentalMonths: {
      type: Number,
      required: true,
      min: 1,
      default: 1
    },
    pricing: {
      monthlyRent: Number,
      effectiveMonthlyRent: Number,
      securityDeposit: Number,
      deliveryCharges: Number,
      discountPercent: Number
    },
    totals: {
      monthlySubtotal: Number,
      tenureSubtotal: Number,
      securityDepositTotal: Number,
      deliveryChargesTotal: Number,
      lineTotal: Number
    },
    addedAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  }],
  summary: {
    itemsCount: { type: Number, default: 0 },
    totalQuantity: { type: Number, default: 0 },
    monthlyRentTotal: { type: Number, default: 0 },
    securityDepositTotal: { type: Number, default: 0 },
    deliveryChargesTotal: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 }
  },
  // Add these fields for reservation
  reserved: {
    type: Boolean,
    default: false
  },
  reservedUntil: {
    type: Date,
    default: null
  },
  reservationToken: {
    type: String,
    default: null
  },
  coupon: {
    code: String,
    type: String,
    value: Number,
    maxDiscount: Number,
    discountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Discount' },
    discountAmount: Number,
    isValid: Boolean,
    appliedAt: Date
  },
  version: {
    type: Number,
    default: 1
  }
}, {
  timestamps: true
});


module.exports = mongoose.model('Cart', cartSchema);