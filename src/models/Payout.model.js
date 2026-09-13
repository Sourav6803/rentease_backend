/**
 * models/Payout.model.js
 *
 * A single settlement run that pays a vendor the money the ledger says is owed.
 *
 * State machine (enforced in settlement.service.js, not here):
 *
 *   pending ──process──> processing ──success──> paid
 *      │                     │
 *      │                     └──failure──> failed ──retry──> processing
 *      └──cancel──> cancelled   (entries returned to `available`)
 *
 * `requiresManualTransfer` is set when the gateway payout flag is off, so the
 * record is an honest instruction to finance rather than a fake success.
 */
const mongoose = require('mongoose');

const PAYOUT_METHODS = ['razorpay_payout', 'bank_transfer', 'upi', 'manual'];
const PAYOUT_STATUSES = ['pending', 'processing', 'paid', 'failed', 'cancelled'];

const payoutSchema = new mongoose.Schema(
  {
    payoutNumber: { type: String, required: true, unique: true },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
      index: true,
    },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    method: { type: String, enum: PAYOUT_METHODS, default: 'manual' },
    status: { type: String, enum: PAYOUT_STATUSES, default: 'pending', index: true },

    /** The window these earnings came from. */
    periodStart: Date,
    periodEnd: Date,

    /** The ledger entries this payout settles. */
    entryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'VendorLedger' }],

    /** How `amount` was arrived at, kept for the receipt and for audit. */
    deductions: {
      grossAmount: { type: Number, default: 0 },
      commission: { type: Number, default: 0 },
      platformFee: { type: Number, default: 0 },
      tax: { type: Number, default: 0 },
      processingFee: { type: Number, default: 0 },
      netAmount: { type: Number, default: 0 },
    },

    /**
     * Snapshot of where the money was sent. Deliberately a copy, never a
     * reference: the vendor may change bank details later and the receipt must
     * still show where this particular payout went.
     */
    bankAccountSnapshot: {
      accountHolderName: String,
      accountNumberMasked: String,
      ifscCode: String,
      bankName: String,
      upiId: String,
    },

    gateway: {
      payoutId: String,
      utr: String,
      failureReason: String,
      attemptedAt: Date,
      attempts: { type: Number, default: 0 },
      /**
       * 'test' or 'live' — which RazorpayX environment handled this payout. Read off
       * the key prefix at send time, because that is what actually decides it. A
       * payout receipt has to be able to say whether real money moved, so this is
       * recorded rather than inferred later.
       */
      mode: { type: String, enum: ['test', 'live', null], default: null },
    },

    /**
     * True when the gateway integration is switched off and this payout has to
     * be settled by finance manually. Never silently mark these as paid.
     */
    requiresManualTransfer: { type: Boolean, default: false },

    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    processedAt: Date,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: Date,
    cancellationReason: String,

    receiptNumber: String,
    notes: String,
  },
  { timestamps: true },
);

/** Admin payout queue, and the vendor's payout history. */
payoutSchema.index({ vendor: 1, status: 1, createdAt: -1 });
payoutSchema.index({ status: 1, createdAt: -1 });
/** Finance worklist: everything waiting on a human. */
payoutSchema.index({ requiresManualTransfer: 1, status: 1 });

const Payout = mongoose.model('Payout', payoutSchema);

module.exports = Payout;
module.exports.PAYOUT_METHODS = PAYOUT_METHODS;
module.exports.PAYOUT_STATUSES = PAYOUT_STATUSES;
