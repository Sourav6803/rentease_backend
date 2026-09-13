/**
 * models/VendorLedger.model.js
 *
 * Append-only money ledger for vendor earnings.
 *
 * Why it exists: `Payment` records money coming IN from the customer, but there
 * was nowhere to record what the platform owes the vendor, what was deducted, or
 * what was paid out. Every future payout is now derived from these entries
 * instead of being recomputed from rentals on the fly.
 *
 * Entry shape for one successful rent payment of ₹10,000 at 10% commission:
 *   credit  earning      8800   -> vendor's money, becomes `available` after holdDays
 *   debit   commission   1000   -> platform income
 *   debit   platform_fee  200   -> platform income
 *   debit   tax          1800   -> pass-through liability, NOT platform income
 *
 * `Payment.vendor` holds the Vendor document _id, so `vendor` here does too.
 */
const mongoose = require('mongoose');

/** Every kind of movement the ledger understands. */
const LEDGER_TYPES = [
  'earning', // vendor's net share of a payment
  'commission', // platform's commission on a payment
  'platform_fee', // platform's flat/percentage fee
  'tax', // collected from the customer, owed onward
  'refund', // reversal of a payment
  'adjustment', // manual correction by an admin
  'payout', // money actually sent to the vendor
  'reversal', // undo of a previous entry
];

const LEDGER_DIRECTIONS = ['credit', 'debit'];

/**
 * pending   -> recorded, still inside the hold period
 * available -> past the hold period, eligible to be included in a payout
 * settled   -> included in a payout that has been paid
 * reversed  -> undone (refund) and no longer counted
 */
const LEDGER_STATUSES = ['pending', 'available', 'settled', 'reversed'];

const vendorLedgerSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
      index: true,
    },
    rental: { type: mongoose.Schema.Types.ObjectId, ref: 'Rental' },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    payout: { type: mongoose.Schema.Types.ObjectId, ref: 'Payout' },

    type: { type: String, enum: LEDGER_TYPES, required: true },
    direction: { type: String, enum: LEDGER_DIRECTIONS, required: true },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },

    status: { type: String, enum: LEDGER_STATUSES, default: 'pending', index: true },
    /** When this entry leaves the hold period and becomes payable. */
    availableAt: { type: Date, index: true },
    settledAt: Date,

    description: String,
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

/**
 * Idempotency guard.
 *
 * A replayed gateway webhook, a retried verification or a double-clicked verify
 * must not credit the vendor twice. One entry of each type per payment is the
 * unit of uniqueness. Entries with no payment (manual adjustments) are excluded
 * from the index so they can repeat.
 */
vendorLedgerSchema.index(
  { payment: 1, type: 1 },
  {
    unique: true,
    // Scoped to the four types that are created exactly once per payment.
    // refund/reversal/adjustment/payout are excluded so a payment can be
    // partially refunded more than once; those carry their own idempotency key
    // in `metadata.idempotencyKey`, checked by the service.
    partialFilterExpression: {
      payment: { $exists: true },
      type: { $in: ['earning', 'commission', 'platform_fee', 'tax'] },
    },
  },
);

/** The query the payout builder runs: this vendor's payable entries. */
vendorLedgerSchema.index({ vendor: 1, status: 1, availableAt: 1 });

/** Vendor ledger statement, newest first. */
vendorLedgerSchema.index({ vendor: 1, createdAt: -1 });

const VendorLedger = mongoose.model('VendorLedger', vendorLedgerSchema);

module.exports = VendorLedger;
module.exports.LEDGER_TYPES = LEDGER_TYPES;
module.exports.LEDGER_DIRECTIONS = LEDGER_DIRECTIONS;
module.exports.LEDGER_STATUSES = LEDGER_STATUSES;
