/**
 * services/settlement.service.js
 *
 * The money-out side of the platform: recording what a vendor is owed, holding
 * it for a safety window, and paying it out.
 *
 * LEDGER CONVENTION (important — read before changing anything)
 * ------------------------------------------------------------
 * A customer's payment is split once, by utils/feeCalculator, and recorded as:
 *
 *   credit  earning        = vendorNet            <- already net of all deductions
 *   debit   commission     = commission           <- audit only
 *   debit   platform_fee   = platformFee          <- audit only
 *   debit   tax            = tax                  <- audit only, a liability
 *
 * `earning` is already net, so the vendor's payable balance counts ONLY:
 *   credit earning, credit adjustment, credit reversal, credit refund
 *   debit  payout,   debit  refund,     debit  reversal
 * The commission / platform_fee / tax rows exist so a payout receipt can show
 * exactly how the gross was reduced. Counting them again in the balance would
 * double-deduct — this is the one invariant to keep intact.
 *
 * HOLD WINDOW
 * -----------
 * `earning` entries start as `pending` with `availableAt = now + holdDays`, so a
 * refund or dispute inside the window can still reverse them. The informational
 * rows are `available` immediately because they are recognised on receipt.
 *
 * MONEY MOVEMENT
 * --------------
 * The only place that talks to a payout gateway is transferToVendor(). It is
 * hard-gated on `payout.razorpayPayoutEnabled`; while that is false every payout
 * is created with `requiresManualTransfer: true` and left `pending` for finance.
 * Nothing here ever marks a payout paid without either a gateway confirmation or
 * an explicit admin action carrying a UTR.
 */
const mongoose = require('mongoose');
const { Vendor, VendorLedger, Payout, Payment, SystemSettings } = require('../models');
// utils/AppError.js does `module.exports = AppError`, so the destructured form
// (`const { AppError } = ...`) is undefined and `new AppError(...)` would throw
// "AppError is not a constructor". Import the class itself.
const AppError = require('../utils/AppError');
const logger = require('../config/logger');
const fee = require('../utils/feeCalculator');
const encryption = require('../utils/encryption');

const DEFAULTS = {
  holdDays: 7,
  minPayoutAmount: 500,
  /** A `pending` payment older than this is presumed abandoned. */
  paymentTimeoutMinutes: 30,
  /** A `processing` payment older than this needs reconciliation, never a blind cancel. */
  processingGraceMinutes: 24 * 60,
};

/** Types that move the vendor's payable balance. */
const BALANCE_TYPES = ['earning', 'payout', 'refund', 'adjustment', 'reversal'];

/** Types created exactly once per payment, so they carry the unique index. */
const PAYMENT_SCOPED_TYPES = ['earning', 'commission', 'platform_fee', 'tax'];

/**
 * `payout` is only ever stamped on an entry once a payout reserves it; until then
 * the field is ABSENT from the document.
 *
 * An aggregation `$eq`/`$ne` against `null` does NOT treat a missing field as
 * null — it compares the "missing" type against "null" and reports them as
 * different. So `{ $eq: ['$payout', null] }` was FALSE for every unreserved
 * entry, which bucketed all genuinely-available money into `reserved` and left
 * every vendor showing an available balance of 0 while the platform-wide
 * overview (which uses a *query* filter, where missing DOES match null) reported
 * the money correctly. `$ifNull` normalises missing to null before comparing.
 */
const RESERVATION = { $ifNull: ['$payout', null] };

function pickNumber(...candidates) {
  for (const candidate of candidates) {
    const parsed = typeof candidate === 'number' ? candidate : Number(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** The shape `encryption.encryptToString` writes into a String field. */
const ENCRYPTED_ENVELOPE = /^\s*\{\s*"encrypted"\s*:/;

/**
 * The plaintext behind a stored value that may be an encryption envelope.
 *
 * Needed wherever a secret has to be USED rather than displayed — a bank account
 * number on its way to the payout gateway, for instance. Returns '' when it cannot
 * be read, so a caller can refuse rather than send ciphertext.
 */
function decryptStoredField(stored) {
  if (!stored) return '';
  const value = String(stored);
  if (!ENCRYPTED_ENVELOPE.test(value)) return value;

  try {
    return String(encryption.decryptFromString(value) || '');
  } catch (error) {
    logger.warn(`Could not decrypt a stored field: ${error.message}`);
    return '';
  }
}

/**
 * Last-4 mask of a vendor's bank account, for display and for the payout audit
 * snapshot.
 *
 * `Vendor.bankDetails.accountNumber` is written with
 * `encryption.encryptToString()`, so the database does NOT hold a number — it
 * holds a JSON envelope like
 * `{"encrypted":"422c793c..","iv":"69e620c9..","authTag":"3cbb0.."}` (119 chars).
 * Masking that string produced a meaningless run of 119 asterisks with the tail of
 * the envelope glued on, which told the admin nothing about which account would be
 * paid AND leaked the envelope's length.
 *
 * Decryption is therefore a prerequisite. If it fails we return undefined rather
 * than falling back to the stored value: showing unreadable ciphertext is worse
 * than showing nothing, and it must never reach a finance screen.
 */
function maskAccountNumber(accountNumber) {
  if (!accountNumber) return undefined;

  const stored = String(accountNumber).trim();
  if (!stored) return undefined;

  let value = stored;
  if (ENCRYPTED_ENVELOPE.test(stored)) {
    try {
      value = String(encryption.decryptFromString(stored) ?? '').trim();
    } catch (error) {
      logger.warn(`Could not decrypt a stored account number for masking: ${error.message}`);
      return undefined;
    }

    // `decryptFromString` returns its input unchanged when no key is configured.
    // Never let an envelope reach a finance screen just because the key is missing.
    if (ENCRYPTED_ENVELOPE.test(value)) {
      logger.warn('Stored account number is encrypted but no decryption key is available; hiding it');
      return undefined;
    }
  }

  if (!value) return undefined;
  if (value.length <= 4) return '****';
  return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
}

function generatePayoutNumber() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, '0');
  return `PAY-${stamp}-${random}`;
}

/** Duplicate-key write errors are the expected outcome of a replayed operation. */
function isDuplicateKeyError(error) {
  const writeErrors = error?.writeErrors || error?.result?.result?.writeErrors || [];
  if (!Array.isArray(writeErrors) || writeErrors.length === 0) {
    return error?.code === 11000;
  }
  return writeErrors.every((entry) => (entry?.err?.code ?? entry?.code) === 11000);
}

function countWriteErrors(error) {
  const writeErrors = error?.writeErrors || error?.result?.result?.writeErrors || [];
  return Array.isArray(writeErrors) ? writeErrors.length : 0;
}

class SettlementService {
  // ── configuration ──────────────────────────────────────────────────────────

  /**
   * Resolve the payout policy. The schema carries duplicate keys for the same
   * concept (`holdDays` and `holdPeriod`, `minPayoutAmount` and `minimumAmount`)
   * from an older edit, so both spellings are read and the first that is set
   * wins, then the code default.
   */
  async getPayoutConfig() {
    const settings = await SystemSettings.getInstance();
    const payout = settings?.payment?.payout || {};

    return {
      holdDays:
        pickNumber(payout.holdDays, payout.holdPeriod, process.env.PAYOUT_HOLD_DAYS) ??
        DEFAULTS.holdDays,
      minPayoutAmount:
        pickNumber(payout.minPayoutAmount, payout.minimumAmount, process.env.MIN_PAYOUT_AMOUNT) ??
        DEFAULTS.minPayoutAmount,
      processingFee: pickNumber(payout.processingFee) ?? 0,
      autoPayout: payout.autoPayout === true,
      razorpayPayoutEnabled: payout.razorpayPayoutEnabled === true,
      schedule: payout.schedule || payout.payoutCycle || 'weekly',
      // RazorpayX source account (the account payouts are debited from).
      accountNumber: payout.razorpayAccount || process.env.RAZORPAYX_ACCOUNT_NUMBER || null,
      /**
       * Whether the payout gateway runs in test mode. Defaults to TRUE — a fresh
       * install must not be one toggle away from moving real money.
       */
      testMode: payout.testMode !== false,
      /**
       * `testMode` above is the operator's intent; this is what the configured key
       * actually is. RazorpayX decides the environment from the key prefix, so the
       * two can disagree (a live key with testMode still pressed) — and when they
       * do, the KEY wins. Never trust the flag alone before moving money.
       */
      credentialsMode: null, // filled in by hasPayoutCredentials() below
      hasPayoutCredentials: false,
    };
  }

  /**
   * Is the payout gateway actually usable, and in which environment?
   *
   * Separated from getPayoutConfig because it needs the credentials, which live
   * behind the same resolver the payment gateway uses (admin settings first, env
   * second). Returns `credentialsMode: 'test' | 'live' | null` derived from the key
   * prefix — the only reliable statement about which environment will be hit.
   */
  async hasPayoutCredentials() {
    const config = await this.getPayoutConfig();
    const paymentService = require('./payment.service');
    const { keyId, keySecret } = await paymentService.getPayoutCredentials();

    const usable = Boolean(config.accountNumber && keyId && keySecret);
    let credentialsMode = null;
    if (keyId) {
      if (/^rzpx?_test_/i.test(keyId) || /_test_/i.test(keyId)) credentialsMode = 'test';
      else if (/_live_/i.test(keyId)) credentialsMode = 'live';
      else credentialsMode = 'unknown';
    }

    return {
      ...config,
      keyIdConfigured: Boolean(keyId),
      credentialsMode,
      hasPayoutCredentials: usable,
    };
  }

  // ── recording ──────────────────────────────────────────────────────────────

  /**
   * Insert ledger rows, tolerating documents that already exist.
   * The unique index on { payment, type } is what makes a replayed webhook or a
   * retried verification safe: the second insert fails on the duplicate and we
   * report it as skipped rather than crediting twice.
   */
  async insertEntriesIdempotently(entries, session) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return { inserted: 0, skipped: 0 };
    }

    try {
      const inserted = await VendorLedger.insertMany(entries, {
        ordered: false,
        session: session || undefined,
      });
      return { inserted: inserted.length, skipped: 0 };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const duplicates = countWriteErrors(error);
      return { inserted: entries.length - duplicates, skipped: duplicates };
    }
  }

  /**
   * Record the split of one successful payment.
   *
   * @param {object} params
   * @param {object} params.payment  the Payment document (or lean object)
   * @param {object} params.rental   the Rental document
   * @param {object} params.breakdown the fee breakdown to record
   * @param {object} [params.session] mongoose session, to stay inside the payment transaction
   */
  async recordPaymentEntries({ payment, rental, breakdown, session, availableAt: availableAtOverride }) {
    if (!payment || !breakdown) {
      throw new AppError('payment and breakdown are required to record ledger entries', 400);
    }

    const vendorId = payment.vendor || rental?.vendor;
    if (!vendorId) {
      // A payment with no vendor (a platform-level charge) has nothing to settle.
      return { inserted: 0, skipped: 0, skippedReason: 'no vendor on payment' };
    }

    const config = await this.getPayoutConfig();
    // The hold window normally starts when the payment is recorded. A backfill
    // records a payment that was taken long ago, so it passes the real moment the
    // hold should have started from — otherwise an old earning would sit in the
    // hold window for another full cycle. Default behaviour is unchanged.
    const holdFrom = availableAtOverride ? new Date(availableAtOverride) : new Date();
    const availableAt = new Date(holdFrom.getTime() + config.holdDays * 24 * 60 * 60 * 1000);

    const base = {
      vendor: vendorId,
      rental: rental?._id || payment.rental?._id || payment.rental,
      payment: payment._id,
      currency: payment.currency || 'INR',
    };

    // Metadata on the earning row is what lets a payout receipt show the gross
    // and every deduction without re-querying rentals.
    const sharedMetadata = {
      grossAmount: fee.roundMoney(breakdown.taxableAmount),
      commission: fee.roundMoney(breakdown.commission),
      platformFee: fee.roundMoney(breakdown.platformFee),
      tax: fee.roundMoney(breakdown.tax),
      convenienceFee: fee.roundMoney(breakdown.convenienceFee),
      total: fee.roundMoney(breakdown.total),
      commissionRate: breakdown.commissionRate,
      commissionSource: breakdown.commissionSource,
      platformFeeType: breakdown.platformFeeType,
      paymentType: payment.type,
    };

    const entries = [];

    if (fee.roundMoney(breakdown.vendorNet) > 0) {
      entries.push({
        ...base,
        type: 'earning',
        direction: 'credit',
        amount: fee.roundMoney(breakdown.vendorNet),
        status: 'pending',
        availableAt,
        description: `Earning from payment ${payment.paymentNumber || payment._id}`,
        metadata: sharedMetadata,
      });
    }

    // Audit rows: recognised immediately, never part of the payable balance.
    const auditRows = [
      ['commission', breakdown.commission, 'Commission'],
      ['platform_fee', breakdown.platformFee, 'Platform fee'],
      ['tax', breakdown.tax, 'Tax'],
    ];
    for (const [type, amount, label] of auditRows) {
      if (fee.roundMoney(amount) > 0) {
        entries.push({
          ...base,
          type,
          direction: 'debit',
          amount: fee.roundMoney(amount),
          status: 'available',
          availableAt: new Date(),
          description: `${label} on payment ${payment.paymentNumber || payment._id}`,
          metadata: sharedMetadata,
        });
      }
    }

    if (entries.length === 0) return { inserted: 0, skipped: 0 };

    // Pre-check existing rows before inserting.
    //
    // Relying only on catching the duplicate-key error is not enough when this
    // runs inside the caller's transaction: a failed write poisons a Mongo
    // transaction, so the surrounding commit would abort even though the error
    // was caught here. Reading first turns a replay into a clean skip.
    const alreadyRecorded = await VendorLedger.find({ payment: payment._id })
      .select('type')
      .session(session || null)
      .lean();
    const recordedTypes = new Set(alreadyRecorded.map((row) => row.type));
    const freshEntries = entries.filter((entry) => !recordedTypes.has(entry.type));

    if (freshEntries.length === 0) {
      return { inserted: 0, skipped: entries.length, alreadyRecorded: true };
    }

    const result = await this.insertEntriesIdempotently(freshEntries, session);
    logger.info('Settlement ledger entries recorded', {
      payment: String(payment._id),
      ...result,
    });
    return result;
  }

  // ── hold window ────────────────────────────────────────────────────────────

  /**
   * Move every earning entry whose hold window has elapsed into `available`.
   * Idempotent: the filter only matches `pending` rows.
   */
  async releaseDueEntries(now = new Date()) {
    const result = await VendorLedger.updateMany(
      { type: 'earning', status: 'pending', availableAt: { $lte: now } },
      { $set: { status: 'available' } },
    );
    const released = result.modifiedCount ?? result.nModified ?? 0;
    if (released > 0) {
      logger.info(`Settlement: released ${released} ledger entries from the hold window`);
    }
    return { released };
  }

  // ── reporting ──────────────────────────────────────────────────────────────

  /**
   * Balances for one vendor. Uses the same BALANCE_TYPES rule as the payout
   * builder, so the number the vendor sees is the number that can be paid out.
   */
  async getVendorLedgerSummary(vendorId) {
    const vendorObjectId = this.toObjectId(vendorId, 'vendor id');

    const rows = await VendorLedger.aggregate([
      {
        $match: {
          vendor: vendorObjectId,
          type: { $in: BALANCE_TYPES },
          status: { $ne: 'reversed' },
        },
      },
      {
        $group: {
          // `reserved` (is this entry already claimed by a payout?) has to be part
          // of the key, so money sitting in an in-flight payout is not reported as
          // available and double-counted in the vendor's balance.
          _id: {
            type: '$type',
            direction: '$direction',
            status: '$status',
            reserved: { $ne: [RESERVATION, null] },
          },
          total: { $sum: '$amount' },
        },
      },
    ]);

    const sums = { available: 0, pending: 0, settled: 0, reserved: 0 };
    const detail = { earned: 0, paidOut: 0, refunded: 0 };

    for (const row of rows) {
      const { type, direction, status } = row._id;
      const signed = direction === 'credit' ? row.total : -row.total;

      if (type === 'earning') detail.earned += row.total;
      if (type === 'payout') detail.paidOut += row.total;
      if (type === 'refund') detail.refunded += row.total;

      if (type === 'earning') {
        // Already claimed by a payout -> reserved, not available.
        if (status === 'available' && !row._id.reserved) sums.available += row.total;
        if (status === 'available' && row._id.reserved) sums.reserved += row.total;
        if (status === 'pending') sums.pending += row.total;
        if (status === 'settled') sums.settled += row.total;
      }
      if (type === 'adjustment' || type === 'refund' || type === 'reversal') {
        sums.available += signed;
      }
    }

    const config = await this.getPayoutConfig();

    return {
      availableBalance: fee.roundMoney(Math.max(0, sums.available)),
      pendingBalance: fee.roundMoney(Math.max(0, sums.pending)),
      reservedBalance: fee.roundMoney(Math.max(0, sums.reserved)),
      settledBalance: fee.roundMoney(Math.max(0, sums.settled)),
      lifetimeEarned: fee.roundMoney(detail.earned),
      lifetimePaidOut: fee.roundMoney(detail.paidOut),
      lifetimeRefunded: fee.roundMoney(detail.refunded),
      holdDays: config.holdDays,
      minPayoutAmount: config.minPayoutAmount,
      razorpayPayoutEnabled: config.razorpayPayoutEnabled,
    };
  }

  /** Paged ledger statement for a vendor. */
  async listVendorLedger(vendorId, options = {}) {
    const vendorObjectId = this.toObjectId(vendorId, 'vendor id');
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));

    const filter = { vendor: vendorObjectId };
    if (options.type) filter.type = options.type;
    if (options.status) filter.status = options.status;

    const [entries, total] = await Promise.all([
      VendorLedger.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      VendorLedger.countDocuments(filter),
    ]);

    return {
      entries,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  // ── payouts ────────────────────────────────────────────────────────────────

  /**
   * Build a payout from this vendor's available earnings.
   *
   * The entries are reserved by stamping `payout` on them, so a second call
   * cannot pick up the same money. Entries are only ever selected when their
   * status is exactly `available`.
   *
   * `entryIds` narrows the payout to a specific set of entries. Without it the
   * call sweeps EVERY available entry the vendor has, which is the right default
   * for "settle everything outstanding" but is dangerous for callers that mean to
   * settle only part of it — an automated payout run and a test both need to be
   * able to say exactly which entries they are paying.
   */
  async createPayout({
    vendorId,
    periodStart,
    periodEnd,
    // `entryIdFilter`, not `entryIds`: the body below already uses `entryIds` for
    // the resolved list of entries being paid.
    entryIds: entryIdFilter,
    adminId,
    notes,
  } = {}) {
    const vendorObjectId = this.toObjectId(vendorId, 'vendor id');
    const config = await this.getPayoutConfig();

    // `payout: null` is essential: createPayout only stamps `payout` on the
    // entries, it does not change their status, so without this filter a second
    // call would select the very same entries and pay them out twice.
    // `null` matches both "never reserved" and "reservation cleared by cancel".
    const filter = {
      vendor: vendorObjectId,
      type: 'earning',
      status: 'available',
      payout: null,
    };
    if (Array.isArray(entryIdFilter) && entryIdFilter.length > 0) {
      filter._id = { $in: entryIdFilter.map((id) => this.toObjectId(id, 'ledger entry id')) };
    }
    if (periodStart || periodEnd) {
      filter.createdAt = {};
      if (periodStart) filter.createdAt.$gte = new Date(periodStart);
      if (periodEnd) filter.createdAt.$lte = new Date(periodEnd);
    }

    const vendor = await Vendor.findById(vendorObjectId)
      // accountNumber is `select: false`, so it must be asked for explicitly.
      .select('+bankDetails.accountNumber')
      .lean();

    if (!vendor) throw new AppError('Vendor not found', 404);

    const entries = await VendorLedger.find(filter).lean();
    if (entries.length === 0) {
      throw new AppError('No settled earnings are available for payout', 400);
    }

    const amount = fee.roundMoney(entries.reduce((sum, entry) => sum + entry.amount, 0));
    if (amount < config.minPayoutAmount) {
      throw new AppError(
        `Available balance ${amount} is below the minimum payout of ${config.minPayoutAmount}`,
        400,
      );
    }

    const bank = vendor.bankDetails || {};
    if (!bank.accountNumber && !bank.upiId) {
      throw new AppError('Vendor has no bank account or UPI on file to pay out to', 400);
    }

    // Deduction totals come from the earning rows' metadata, so the receipt can
    // show the gross without re-reading rentals.
    const deductions = entries.reduce(
      (acc, entry) => {
        const meta = entry.metadata || {};
        acc.grossAmount += pickNumber(meta.grossAmount) || 0;
        acc.commission += pickNumber(meta.commission) || 0;
        acc.platformFee += pickNumber(meta.platformFee) || 0;
        acc.tax += pickNumber(meta.tax) || 0;
        return acc;
      },
      { grossAmount: 0, commission: 0, platformFee: 0, tax: 0 },
    );

    const entryIds = entries.map((entry) => entry._id);
    const processingFee = config.processingFee;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const [payout] = await Payout.create(
        [
          {
            payoutNumber: generatePayoutNumber(),
            vendor: vendorObjectId,
            amount: fee.roundMoney(Math.max(0, amount - processingFee)),
            currency: 'INR',
            method: config.razorpayPayoutEnabled ? 'razorpay_payout' : 'manual',
            status: 'pending',
            periodStart: periodStart ? new Date(periodStart) : entries[entries.length - 1]?.createdAt,
            periodEnd: periodEnd ? new Date(periodEnd) : entries[0]?.createdAt,
            entryIds,
            deductions: {
              grossAmount: fee.roundMoney(deductions.grossAmount),
              commission: fee.roundMoney(deductions.commission),
              platformFee: fee.roundMoney(deductions.platformFee),
              tax: fee.roundMoney(deductions.tax),
              processingFee: fee.roundMoney(processingFee),
              netAmount: fee.roundMoney(Math.max(0, amount - processingFee)),
            },
            bankAccountSnapshot: {
              accountHolderName: bank.accountHolderName,
              accountNumberMasked: maskAccountNumber(bank.accountNumber),
              ifscCode: bank.ifscCode,
              bankName: bank.bankName,
              upiId: bank.upiId,
            },
            // Honest by default: the gateway path is off until it is switched on.
            requiresManualTransfer: !config.razorpayPayoutEnabled,
            requestedBy: adminId || undefined,
            notes,
          },
        ],
        { session },
      );

      // Reserve the entries so a concurrent payout cannot reuse them. Guarded on
      // `payout: null` so a racing call that already reserved them cannot be
      // overwritten by this one.
      await VendorLedger.updateMany(
        { _id: { $in: entryIds }, status: 'available', payout: null },
        { $set: { payout: payout._id } },
        { session },
      );

      await session.commitTransaction();
      logger.info('Payout created', {
        payoutNumber: payout.payoutNumber,
        vendor: String(vendorObjectId),
        amount: payout.amount,
        entries: entryIds.length,
      });
      return payout;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * pending|failed -> processing -> paid|failed
   *
   * The claim is a conditional update on the current status, so two concurrent
   * calls cannot both move the payout into processing. The gateway call is
   * deliberately OUTSIDE any database transaction: holding a Mongo transaction
   * open across a network call would risk a long lock, and the state machine
   * already makes a crash between the two steps recoverable.
   */
  async processPayout(payoutId, adminId) {
    const payoutObjectId = this.toObjectId(payoutId, 'payout id');

    const claimed = await Payout.findOneAndUpdate(
      { _id: payoutObjectId, status: { $in: ['pending', 'failed'] } },
      {
        $set: { status: 'processing', processedBy: adminId || undefined, processedAt: new Date() },
        $inc: { 'gateway.attempts': 1 },
      },
      { new: true },
    );

    console.log("claimed-->", claimed)

    if (!claimed) {
      const existing = await Payout.findById(payoutObjectId).lean();
      if (!existing) throw new AppError('Payout not found', 404);
      throw new AppError(
        `Payout cannot be processed from status "${existing.status}"`,
        409,
      );
    }

    const vendor = await Vendor.findById(claimed.vendor).select('+bankDetails.accountNumber').lean();

    let outcome;
    try {
      outcome = await this.transferToVendor(claimed, vendor);
    } catch (error) {
      logger.error('Payout transfer threw', { payout: claimed.payoutNumber, error: error.message });
      outcome = { transferred: false, failureReason: error.message };
    }

    console.log("outcome-->", outcome)

    if (outcome.transferred) {
      return this.finalisePaid(claimed._id, {
        utr: outcome.utr,
        payoutId: outcome.payoutId,
        requiresManualTransfer: false,
        mode: outcome.environment,
      });
    }

    if (outcome.requiresManualTransfer) {
      // The gateway is switched off. Leave it actionable for finance rather than
      // pretending it succeeded.
      return Payout.findByIdAndUpdate(
        claimed._id,
        {
          $set: {
            status: 'pending',
            requiresManualTransfer: true,
            'gateway.failureReason': outcome.failureReason || 'Gateway payouts disabled',
            'gateway.mode': outcome.environment || undefined,
          },
        },
        { new: true },
      );
    }

    return Payout.findByIdAndUpdate(
      claimed._id,
      {
          $set: {
            status: 'failed',
            'gateway.failureReason': outcome.failureReason || 'Transfer failed',
            'gateway.mode': outcome.environment || undefined,
          },
      },
      { new: true },
    );
  }

  /**
   * THE ONLY PLACE that may talk to a payout gateway.
   *
   * Four gates, in order, and the network is only reached after all of them pass:
   *
   *   1. `payout.razorpayPayoutEnabled` — while false this returns
   *      `requiresManualTransfer` and never touches the network, which is why the
   *      whole settlement flow can be exercised in tests without moving real money.
   *   2. the vendor has a payout destination on file,
   *   3. a RazorpayX source account AND key are configured,
   *   4. **no real money for fake money**: in LIVE mode, if any earning behind this
   *      payout came from a payment that was not itself live, the transfer is
   *      refused. The ledger cannot tell test earnings from real ones, so a live
   *      payout against test data would wire out money that never came in.
   *
   * The flow itself is the three calls RazorpayX documents — create a contact, add
   * a fund account, create the payout — with the contact and fund account cached on
   * the vendor so they are created once, not once per payout.
   *
   * Test mode is the default (`payment.payout.testMode`), and the environment is
   * read off the key prefix rather than the flag, because the key is what Razorpay
   * actually honours.
   */
  async transferToVendor(payout, vendor) {
    // `hasPayoutCredentials` extends the plain config with the resolved RazorpayX
    // credentials and the environment they actually point at.
    const config = await this.hasPayoutCredentials();

    if (!config.razorpayPayoutEnabled) {
      return {
        transferred: false,
        requiresManualTransfer: true,
        failureReason: 'Razorpay payouts are disabled (payment.payout.razorpayPayoutEnabled = false)',
      };
    }

    if (!vendor?.bankDetails?.accountNumber && !vendor?.bankDetails?.upiId) {
      return { transferred: false, failureReason: 'Vendor has no payout destination on file' };
    }

    if (!config.accountNumber) {
      return {
        transferred: false,
        failureReason:
          'Razorpay payouts are enabled but no payout source account is configured (payment.payout.razorpayAccount)',
      };
    }

    if (!config.keyIdConfigured) {
      return {
        transferred: false,
        failureReason:
          'Razorpay payouts are enabled but no RazorpayX key is configured (payment.payout.keyId / keySecret)',
      };
    }

    // The environment Razorpay will actually use is decided by the key prefix, so
    // that is what the safety check is based on — never the stored flag alone.
    const mode = config.credentialsMode === 'test' ? 'test' : 'live';

    /**
     * Real money must never leave for earnings that were only ever test-mode. The
     * ledger cannot tell the difference on its own, so ask the payments behind it.
     */
    if (mode === 'live') {
      const notLive = await this.findEarningsNotFromLivePayments(payout);
      if (notLive.length > 0) {
        logger.error(
          `Refusing a LIVE payout ${payout.payoutNumber}: ${notLive.length} earning(s) came from non-live payments`,
        );
        return {
          transferred: false,
          failureReason:
            `Refusing a LIVE payout: ${notLive.length} of ${payout.entryIds?.length || 0} earnings ` +
            `came from payments that were not live (e.g. ${notLive[0].paymentNumber} / ` +
            `${notLive[0].paymentDetails?.gatewayMode || 'unknown'}). Live keys would send real ` +
            'money for earnings that were never real.',
        };
      }
    }

    try {
      const paymentService = require('./payment.service');
      const client = await paymentService.getPayoutClient();
      if (!client) {
        return {
          transferred: false,
          failureReason: 'RazorpayX credentials are configured but the client could not be built',
        };
      }

      const contactId = await this.ensurePayoutContact(client, vendor, mode);
      const fundAccountId = await this.ensurePayoutFundAccount(client, vendor, contactId, mode);

      // Bank transfers go over IMPS; a UPI handle is paid over UPI. Mode is derived
      // from the destination rather than configured, so it cannot be set wrong.
      const transferMode = vendor?.bankDetails?.upiId ? 'UPI' : 'IMPS';

      // See the note in ensurePayoutContact — the installed SDK (2.9.6) exposes no
      // `client.payouts` resource, only the raw `client.api` helper. This is the call
      // that produced "Cannot read properties of undefined (reading 'create')".
      const created = await client.api.post({
        url: '/payouts',
        data: {
          account_number: config.accountNumber,
          fund_account_id: fundAccountId,
          amount: Math.round(Number(payout.amount) * 100), // paise
          currency: 'INR',
          mode: transferMode,
          purpose: 'payout',
          // Without this a payout larger than the RazorpayX balance is rejected
          // outright instead of being held until the account is topped up.
          queue_if_low_balance: true,
          reference_id: payout.payoutNumber,
          narration: 'RentEase vendor payout',
          notes: {
            payoutId: String(payout._id),
            payoutNumber: payout.payoutNumber,
            environment: mode,
          },
        },
      });

      logger.info(
        `Gateway payout created for ${payout.payoutNumber}: ${created?.id || 'no id'} ` +
          `(${mode} mode, status ${created?.status || 'unknown'})`,
      );

      return {
        transferred: true,
        requiresManualTransfer: false,
        payoutId: created?.id || null,
        utr: created?.utr || null,
        status: created?.status || 'queued',
        // 'test' | 'live' — which environment actually handled it.
        environment: mode,
      };
    } catch (error) {
      // The gateway's own description is far more useful than a generic message, and
      // this is a RETRYABLE failure, not a manual-transfer work item.
      const description =
        error?.error?.description || error?.error?.reason || error?.message || 'unknown error';
      logger.error(`Gateway payout failed for ${payout.payoutNumber}: ${description}`);

      return {
        transferred: false,
        requiresManualTransfer: false,
        environment: mode,
        failureReason: `Gateway payout failed: ${description}`,
      };
    }
  }

  /**
   * The RazorpayX contact for a vendor, created once and cached on the vendor.
   * Test-mode and live-mode contacts are separate objects, so they are cached
   * separately.
   */
  async ensurePayoutContact(client, vendor, mode) {
    const cached = vendor?.bankDetails?.payoutContactIds?.[mode];
    if (cached) return cached;

    // NOTE: `client.contacts` / `client.fundAccounts` / `client.payouts` do NOT exist
    // on the installed razorpay SDK (2.9.6) — it ships no RazorpayX payout resources
    // at all, so those calls threw `Cannot read properties of undefined (reading
    // 'create')` before any HTTP request was made. The SDK does expose the raw
    // `client.api` helper, whose signature is `post({ url, data })`, so the payout
    // API is called through that instead. If a future SDK version adds the typed
    // resources, prefer them.
    const contact = await client.api.post({
      url: '/contacts',
      data: {
        name: vendor?.business?.name || 'RentEase vendor',
        email: vendor?.contact?.primaryEmail || undefined,
        contact: vendor?.contact?.primaryPhone || undefined,
        type: 'vendor',
        reference_id: vendor?.vendorId || undefined,
        notes: { vendorId: vendor?.vendorId || String(vendor?._id || ''), environment: mode },
      },
    });

    if (contact?.id && vendor?._id) {
      await Vendor.updateOne(
        { _id: vendor._id },
        { $set: { [`bankDetails.payoutContactIds.${mode}`]: contact.id } },
      );
    }
    return contact?.id || null;
  }

  /**
   * The vendor's RazorpayX fund account — the actual destination money goes to.
   *
   * Prefers the UPI handle: it is stored in the clear and needs one field, whereas
   * the bank account number is encrypted at rest and has to be decrypted before it
   * can be sent to the gateway.
   */
  async ensurePayoutFundAccount(client, vendor, contactId, mode) {
    const cached = vendor?.bankDetails?.payoutFundAccountIds?.[mode];
    if (cached) return cached;

    const bank = vendor?.bankDetails || {};
    let payload;

    if (bank.upiId) {
      payload = {
        contact_id: contactId,
        account_type: 'vpa',
        vpa: { address: bank.upiId },
      };
    } else {
      const accountNumber = decryptStoredField(bank.accountNumber);
      if (!accountNumber || !bank.ifscCode) {
        throw new AppError(
          'Vendor bank details are incomplete or unreadable, so a fund account cannot be created',
          400,
        );
      }
      payload = {
        contact_id: contactId,
        account_type: 'bank_account',
        bank_account: {
          name: bank.accountHolderName || vendor?.business?.name || 'Vendor',
          ifsc: bank.ifscCode,
          account_number: accountNumber,
        },
      };
    }

    // See the note in ensurePayoutContact — the SDK has no `fundAccounts` resource,
    // only the raw `client.api` helper.
    const fundAccount = await client.api.post({ url: '/fund_accounts', data: payload });

    if (fundAccount?.id && vendor?._id) {
      await Vendor.updateOne(
        { _id: vendor._id },
        { $set: { [`bankDetails.payoutFundAccountIds.${mode}`]: fundAccount.id } },
      );
    }
    return fundAccount?.id || null;
  }

  /**
   * Claw back the vendor-side ledger for a payout the gateway reversed AFTER paying
   * it — the money left and then came back.
   *
   * Writes a compensating `reversal` DEBIT and deliberately does NOT flip the
   * earnings to `reversed`. The earning was real (the money did go out), and
   * `getVendorLedgerSummary` already subtracts `reversal` rows from the available
   * bucket while EXCLUDING reversed earnings — doing both would count the correction
   * twice and understate the balance.
   *
   * The debit lands in the available bucket, so it is recovered out of the vendor's
   * future earnings.
   */
  async reversePayoutInLedger(payout, { reason } = {}) {
    const entryIds = payout?.entryIds || [];
    if (entryIds.length === 0) return { reversed: 0, amount: 0 };

    const earnings = await VendorLedger.find({
      _id: { $in: entryIds },
      type: 'earning',
      status: 'settled',
    }).lean();

    if (earnings.length === 0) {
      logger.warn(`No settled earnings to reverse for payout ${payout.payoutNumber}`);
      return { reversed: 0, amount: 0 };
    }

    const amount = fee.roundMoney(
      earnings.reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
    );

    // Written directly rather than through the payment-scoped inserter: `reversal` is
    // not one of PAYMENT_SCOPED_TYPES, so it carries no unique index and one payout
    // reversal can cover several earnings.
    await VendorLedger.insertMany(
      [
        {
          vendor: payout.vendor,
          type: 'reversal',
          direction: 'debit',
          amount,
          currency: earnings[0].currency || 'INR',
          status: 'available',
          payout: payout._id,
          payment: earnings[0].payment,
          description: reason || `Reversal for payout ${payout.payoutNumber}`,
          metadata: {
            payoutNumber: payout.payoutNumber,
            reversedEntryIds: earnings.map((entry) => String(entry._id)),
            reason: reason || null,
          },
        },
      ],
      { ordered: false },
    );

    return { reversed: earnings.length, amount };
  }

  /**
   * The payments behind a payout's earnings that did NOT come from a live payment.
   *
   * A payment with no recorded `gatewayMode` counts as not-live: when the question is
   * "shall I send real money?", unknown provenance has to answer no.
   */
  async findEarningsNotFromLivePayments(payout) {
    const entryIds = payout?.entryIds || [];
    if (entryIds.length === 0) return [];

    const paymentIds = await VendorLedger.distinct('payment', { _id: { $in: entryIds } });
    if (paymentIds.length === 0) return [];

    return Payment.find({
      _id: { $in: paymentIds },
      'paymentDetails.gatewayMode': { $ne: 'live' },
    })
      .select('paymentNumber paymentDetails')
      .lean();
  }

  /** Shared tail of a successful payout: mark paid, settle the entries. */
  async finalisePaid(payoutId, { utr, payoutId: gatewayPayoutId, requiresManualTransfer, mode }) {
    const session = await mongoose.startSession();
    session.startTransaction();
    // Declared outside the try block: a `const` inside would be out of scope for
    // the notification step that runs after the commit.
    let payout;
    try {
      payout = await Payout.findByIdAndUpdate(
        payoutId,
        {
          $set: {
            status: 'paid',
            processedAt: new Date(),
            requiresManualTransfer: requiresManualTransfer === true,
            receiptNumber: `RCPT-${String(payoutId).slice(-8).toUpperCase()}`,
            'gateway.utr': utr || undefined,
            'gateway.payoutId': gatewayPayoutId || undefined,
            // Which environment moved the money — a receipt has to be able to say.
            'gateway.mode': mode || undefined,
          },
        },
        { new: true, session },
      );

      if (!payout) throw new AppError('Payout not found', 404);

      await VendorLedger.updateMany(
        { _id: { $in: payout.entryIds } },
        { $set: { status: 'settled', settledAt: new Date() } },
        { session },
      );

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

    // The money has moved and the transaction is committed. Tell the vendor
    // AFTER the commit, and never let a notification failure undo the payout.
    await this.notifyVendorOfPayout(payout);

    return payout;
  }

  /**
   * Tell the vendor their payout has landed (in-app + email, with the full
   * deduction breakdown).
   *
   * Deliberately swallows every error: this runs after `finalisePaid` has
   * committed, so throwing here would report a failure for a transfer that has
   * already happened — and a retry would attempt to pay twice. Failures are
   * logged and the payout stays `paid`; the notification is a nice-to-have, the
   * ledger is the source of truth.
   *
   * notification.service is required lazily because it pulls in the job queue,
   * and requiring it at module load would create a load-order dependency between
   * the settlement engine and the queue.
   */
  async notifyVendorOfPayout(payout) {
    if (!payout) return { notified: false, reason: 'no payout' };

    try {
      const vendor = await Vendor.findById(payout.vendor)
        .populate('user', 'email profile.firstName profile.lastName')
        .lean();

      const vendorUser = vendor?.user;
      const vendorUserId = vendorUser?._id || vendorUser;

      if (!vendorUserId) {
        // A vendor row without a linked user cannot receive anything. Log it
        // loudly — it means the vendor record is broken, not that we forgot.
        logger.warn('Payout notification skipped: vendor has no linked user', {
          payout: payout.payoutNumber,
          vendor: String(payout.vendor),
        });
        return { notified: false, reason: 'vendor has no linked user' };
      }

      const notificationService = require('./notification.service');
      const result = await notificationService.sendVendorPayoutNotification(
        String(vendorUserId),
        payout,
        vendor,
      );

      logger.info('Payout notification dispatched', {
        payout: payout.payoutNumber,
        vendor: String(payout.vendor),
        ...result,
      });
      return result;
    } catch (error) {
      logger.error('Payout notification failed (payout is still paid)', {
        payout: payout?.payoutNumber,
        vendor: payout?.vendor ? String(payout.vendor) : undefined,
        error: error.message,
      });
      return { notified: false, reason: error.message };
    }
  }

  /**
   * Finance marks a manual bank transfer as done. A UTR is required: without it
   * there is no evidence the money actually left.
   */
  async markPayoutPaidManually(payoutId, { utr, note }, adminId) {
    const payoutObjectId = this.toObjectId(payoutId, 'payout id');
    if (!utr || !String(utr).trim()) {
      throw new AppError('A UTR or transaction reference is required to mark a payout paid', 400);
    }

    const existing = await Payout.findById(payoutObjectId).lean();
    if (!existing) throw new AppError('Payout not found', 404);
    if (!['pending', 'processing', 'failed'].includes(existing.status)) {
      throw new AppError(`Payout is already "${existing.status}"`, 409);
    }

    await Payout.findByIdAndUpdate(payoutObjectId, {
      $set: {
        processedBy: adminId || undefined,
        notes: note ? `${existing.notes ? `${existing.notes}\n` : ''}${note}` : existing.notes,
      },
    });

    return this.finalisePaid(payoutObjectId, {
      utr: String(utr).trim(),
      requiresManualTransfer: false,
    });
  }

  /**
   * Cancel a payout that has not been paid. The reserved entries go back to
   * `available` so the next payout picks them up.
   */
  async cancelPayout(payoutId, reason, adminId) {
    const payoutObjectId = this.toObjectId(payoutId, 'payout id');

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const payout = await Payout.findOneAndUpdate(
        { _id: payoutObjectId, status: { $in: ['pending', 'processing', 'failed'] } },
        {
          $set: {
            status: 'cancelled',
            cancellationReason: reason || 'Cancelled by admin',
            cancelledBy: adminId || undefined,
            cancelledAt: new Date(),
          },
        },
        { new: true, session },
      );

      if (!payout) {
        const existing = await Payout.findById(payoutObjectId).lean();
        if (!existing) throw new AppError('Payout not found', 404);
        throw new AppError(`A payout in status "${existing.status}" cannot be cancelled`, 409);
      }

      await VendorLedger.updateMany(
        { _id: { $in: payout.entryIds }, status: { $ne: 'settled' } },
        { $set: { payout: null } },
        { session },
      );

      await session.commitTransaction();
      return payout;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  // ── refunds ────────────────────────────────────────────────────────────────

  /**
   * Reverse the ledger for a refunded payment.
   *
   * Idempotent through `metadata.idempotencyKey`, which the caller supplies (the
   * refund reference). Partial refunds are supported and each one is capped so
   * the total reversed can never exceed what was originally recorded.
   */
  async reverseEntriesForRefund({ payment, refundAmount, idempotencyKey, reason } = {}) {
    if (!payment?._id) throw new AppError('payment is required', 400);

    const entries = await VendorLedger.find({ payment: payment._id }).lean();
    if (entries.length === 0) return { reversed: 0, refundEntry: null };

    const earning = entries.find((entry) => entry.type === 'earning');
    if (!earning) return { reversed: 0, refundEntry: null };

    if (idempotencyKey) {
      const existing = await VendorLedger.findOne({
        payment: payment._id,
        type: 'refund',
        'metadata.idempotencyKey': idempotencyKey,
      }).lean();
      if (existing) {
        return { reversed: 0, refundEntry: existing, alreadyProcessed: true };
      }
    }

    const alreadyRefunded = fee.roundMoney(
      entries
        .filter((entry) => entry.type === 'refund')
        .reduce((sum, entry) => sum + entry.amount, 0),
    );
    const originalNet = fee.roundMoney(earning.amount);
    const remaining = fee.roundMoney(Math.max(0, originalNet - alreadyRefunded));
    if (remaining <= 0) {
      return { reversed: 0, refundEntry: null, alreadyFullyRefunded: true };
    }

    // Split the requested refund across the components that were recorded, so the
    // vendor's share is reduced by the same proportion as the customer's refund.
    const breakdown = earning.metadata || {};
    const split = fee.splitRefund(
      {
        total: pickNumber(breakdown.total) || originalNet,
        commission: pickNumber(breakdown.commission) || 0,
        platformFee: pickNumber(breakdown.platformFee) || 0,
        tax: pickNumber(breakdown.tax) || 0,
        convenienceFee: pickNumber(breakdown.convenienceFee) || 0,
        vendorNet: originalNet,
      },
      Math.min(refundAmount, remaining),
    );

    const vendorShare = fee.roundMoney(Math.min(split.vendorNet, remaining));
    if (vendorShare <= 0) return { reversed: 0, refundEntry: null };

    const refundEntry = await VendorLedger.create({
      vendor: earning.vendor,
      rental: earning.rental,
      payment: payment._id,
      type: 'refund',
      direction: 'debit',
      amount: vendorShare,
      status: 'available',
      availableAt: new Date(),
      description: `Refund reversal${reason ? `: ${reason}` : ''}`,
      metadata: {
        ...split,
        idempotencyKey: idempotencyKey || undefined,
        originalEarning: earning._id,
        reason,
      },
    });

    // If the earning had not been paid out yet, take it out of the payable pool.
    if (earning.status === 'pending' || earning.status === 'available') {
      await VendorLedger.updateOne(
        { _id: earning._id },
        {
          $set: {
            status: 'reversed',
            description: `${earning.description || ''} (reversed by refund)`.trim(),
          },
        },
      );
    }
    // A `settled` earning stays settled: the vendor has already been paid, so the
    // refund entry creates a negative balance that the next payout absorbs.

    return { reversed: 1, refundEntry };
  }

  // ── edge case: abandoned / timed-out payments ──────────────────────────────

  /**
   * Sweep payments the customer never completed.
   *
   * Deliberately conservative:
   *   - `pending` past the timeout  -> cancelled. Initiation writes no paid
   *     amount and does not touch the rental due amount, so cancelling cannot
   *     corrupt the rental, and the customer can retry.
   *   - `processing` past the grace -> REPORTED, not cancelled. A capture may
   *     have succeeded at the gateway and we would rather flag it for
   *     reconciliation than cancel a payment that actually took money.
   */
  async expireStalePayments(options = {}) {
    const now = options.now ? new Date(options.now) : new Date();
    const timeoutMinutes =
      pickNumber(options.timeoutMinutes, process.env.PAYMENT_TIMEOUT_MINUTES) ??
      DEFAULTS.paymentTimeoutMinutes;
    const graceMinutes =
      pickNumber(options.processingGraceMinutes, process.env.PAYMENT_PROCESSING_GRACE_MINUTES) ??
      DEFAULTS.processingGraceMinutes;

    const pendingCutoff = new Date(now.getTime() - timeoutMinutes * 60 * 1000);
    const processingCutoff = new Date(now.getTime() - graceMinutes * 60 * 1000);

    const query = {
      status: { $in: ['pending', 'processing'] },
      createdAt: { $lte: pendingCutoff },
    };
    // Scoping option: a caller (or a test) can restrict the sweep to specific
    // payments instead of touching every abandoned record in the database.
    if (Array.isArray(options.paymentIds) && options.paymentIds.length > 0) {
      query._id = { $in: options.paymentIds.map((id) => this.toObjectId(id, 'payment id')) };
    }

    const stale = await Payment.find(query)
      .limit(Math.min(500, Math.max(1, parseInt(options.limit, 10) || 200)))
      .lean();

    const cancelled = [];
    const needsReconciliation = [];

    for (const payment of stale) {
      if (payment.status === 'processing') {
        if (new Date(payment.createdAt) <= processingCutoff) {
          needsReconciliation.push({
            paymentId: String(payment._id),
            paymentNumber: payment.paymentNumber,
            status: payment.status,
            createdAt: payment.createdAt,
          });
        }
        continue;
      }

      // Conditional claim: only the winner of a race may cancel.
      const claimed = await Payment.findOneAndUpdate(
        { _id: payment._id, status: 'pending' },
        {
          $set: {
            status: 'cancelled',
            'paymentDetails.expiredAt': now,
            'paymentDetails.expiryReason': `Abandoned: no completion within ${timeoutMinutes} minutes`,
          },
        },
        { new: true },
      );

      if (claimed) {
        cancelled.push({
          paymentId: String(claimed._id),
          paymentNumber: claimed.paymentNumber,
          amount: claimed.amount,
        });
      }
    }

    if (cancelled.length > 0) {
      logger.info(`Settlement: expired ${cancelled.length} abandoned payments`);
    }
    if (needsReconciliation.length > 0) {
      logger.warn(
        `Settlement: ${needsReconciliation.length} payments are stuck in processing and need gateway reconciliation`,
      );
    }

    return { cancelled, needsReconciliation, timeoutMinutes, graceMinutes };
  }

  /**
   * Reconcile a payment whose client never came back.
   *
   * Only flips the payment when the gateway is reachable AND says the payment was
   * captured; otherwise it leaves the record untouched and reports what it found,
   * because guessing here means either losing money or double-crediting.
   */
  async reconcilePayment(paymentId) {
    const paymentObjectId = this.toObjectId(paymentId, 'payment id');
    const payment = await Payment.findById(paymentObjectId);
    if (!payment) throw new AppError('Payment not found', 404);

    if (payment.status === 'success') {
      return { reconciled: false, reason: 'Payment is already successful', status: payment.status };
    }

    const razorpayOrderId = payment.paymentDetails?.razorpayOrderId;
    if (!razorpayOrderId) {
      return {
        reconciled: false,
        reason: 'No gateway order id is recorded for this payment, so there is nothing to reconcile',
        status: payment.status,
      };
    }

    // Credentials come from the one resolver (settings first, env second) so a key
    // saved in the admin settings is actually used. Required lazily because
    // payment.service requires this module — a top-level require would be a cycle.
    const paymentService = require('./payment.service');
    const client = await paymentService.getRazorpayClient();
    if (!client) {
      return {
        reconciled: false,
        reason: 'Razorpay credentials are not configured, so the gateway cannot be queried',
        status: payment.status,
      };
    }

    try {
      const orderPayments = await client.orders.fetchPayments(razorpayOrderId);
      const captured = (orderPayments?.items || []).find((item) => item.status === 'captured');

      if (!captured) {
        return {
          reconciled: false,
          reason: 'The gateway reports no captured payment for this order',
          gatewayStatus: orderPayments?.items?.[0]?.status,
          status: payment.status,
        };
      }

      payment.status = 'success';
      payment.paymentDetails = {
        ...(payment.paymentDetails || {}),
        razorpayPaymentId: captured.id,
        reconciledAt: new Date(),
        reconciledFrom: 'gateway',
      };
      await payment.save();

      logger.info(`Reconciled payment ${payment.paymentNumber} from the gateway`);
      return { reconciled: true, status: payment.status, gatewayPaymentId: captured.id };
    } catch (error) {
      logger.error('Payment reconciliation failed', { paymentId, error: error.message });
      return { reconciled: false, reason: error.message, status: payment.status };
    }
  }

  // ── queries used by the API layer ──────────────────────────────────────────

  async listVendorPayouts(vendorId, options = {}) {
    const vendorObjectId = this.toObjectId(vendorId, 'vendor id');
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));

    const filter = { vendor: vendorObjectId };
    if (options.status) filter.status = options.status;

    const [payouts, total] = await Promise.all([
      Payout.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Payout.countDocuments(filter),
    ]);

    return {
      payouts,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async listPayouts(options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));

    const filter = {};
    if (options.status) filter.status = options.status;
    if (options.vendorId) filter.vendor = this.toObjectId(options.vendorId, 'vendor id');
    if (options.requiresManualTransfer === true) filter.requiresManualTransfer = true;

    const [payouts, total] = await Promise.all([
      Payout.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('vendor', 'business.name vendorId')
        .lean(),
      Payout.countDocuments(filter),
    ]);

    return {
      payouts,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async getPayout(payoutId) {
    const payoutObjectId = this.toObjectId(payoutId, 'payout id');
    const payout = await Payout.findById(payoutObjectId)
      .populate('vendor', 'business.name vendorId')
      .lean();
    if (!payout) throw new AppError('Payout not found', 404);
    return payout;
  }

  /**
   * Headline numbers for the admin payouts screen.
   *
   * `totalAvailable` and `totalPending` are platform-wide ledger balances, i.e.
   * money owed to vendors that has not been paid out yet. `totalAvailable`
   * excludes entries already reserved by an in-flight payout, so the figure
   * matches what a new payout could actually draw on.
   */
  async getPayoutOverview() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [byStatus, reservedAgg, availableAgg, pendingAgg, needsManual, paidThisMonth] =
      await Promise.all([
        Payout.aggregate([
          { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
        ]),
        VendorLedger.aggregate([
          { $match: { type: 'earning', status: 'available', payout: { $ne: null } } },
          { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
        VendorLedger.aggregate([
          { $match: { type: 'earning', status: 'available', payout: null } },
          { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
        VendorLedger.aggregate([
          { $match: { type: 'earning', status: 'pending' } },
          { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
        Payout.countDocuments({
          requiresManualTransfer: true,
          status: { $in: ['pending', 'processing', 'failed'] },
        }),
        Payout.aggregate([
          { $match: { status: 'paid', processedAt: { $gte: startOfMonth } } },
          { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
      ]);

    const statusMap = byStatus.reduce((acc, row) => {
      acc[row._id] = { count: row.count, amount: fee.roundMoney(row.amount) };
      return acc;
    }, {});

    const config = await this.getPayoutConfig();

    return {
      totalAvailable: fee.roundMoney(availableAgg[0]?.amount || 0),
      totalPending: fee.roundMoney(pendingAgg[0]?.amount || 0),
      totalReserved: fee.roundMoney(reservedAgg[0]?.amount || 0),
      availableEntries: availableAgg[0]?.count || 0,
      pendingEntries: pendingAgg[0]?.count || 0,
      payoutsByStatus: statusMap,
      pendingPayouts: statusMap.pending || { count: 0, amount: 0 },
      processingPayouts: statusMap.processing || { count: 0, amount: 0 },
      failedPayouts: statusMap.failed || { count: 0, amount: 0 },
      cancelledPayouts: statusMap.cancelled || { count: 0, amount: 0 },
      paidPayouts: statusMap.paid || { count: 0, amount: 0 },
      paidThisMonth: {
        count: paidThisMonth[0]?.count || 0,
        amount: fee.roundMoney(paidThisMonth[0]?.amount || 0),
      },
      needsManualTransfer: needsManual,
      razorpayPayoutEnabled: config.razorpayPayoutEnabled,
      minPayoutAmount: config.minPayoutAmount,
      holdDays: config.holdDays,
    };
  }

  /**
   * Receipt payload for a payout: the payout plus the ledger entries it settled,
   * so the document can show gross, every deduction and the net.
   */
  async getPayoutReceipt(payoutId) {
    const payout = await this.getPayout(payoutId);
    const entries = await VendorLedger.find({ payout: payout._id }).sort({ createdAt: 1 }).lean();

    return {
      payout,
      entries,
      receiptNumber: payout.receiptNumber || `RCPT-${String(payout._id).slice(-8).toUpperCase()}`,
      generatedAt: new Date(),
      isPaid: payout.status === 'paid',
    };
  }

  /**
   * Ledger entries reserved by one payout — used by the payout detail view so an
   * admin can see exactly which earnings a payout was built from.
   */
  async listVendorLedgerEntriesForPayout(payoutId) {
    const payoutObjectId = this.toObjectId(payoutId, 'payout id');
    return VendorLedger.find({ payout: payoutObjectId }).sort({ createdAt: 1 }).lean();
  }

  /**
   * Vendors that are owed money, with their balances.
   *
   * Feeds the vendor picker in the create-payout flow. Only vendors that have at
   * least one earning entry appear, because a vendor with no ledger history has
   * nothing payable.
   *
   * Note: the bank account number is deliberately NOT exposed here even though
   * an aggregation bypasses the schema's `select: false` — only a boolean saying
   * whether a payout destination exists on file.
   */
  async getVendorsWithBalances(options = {}) {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const config = options.config || (await this.getPayoutConfig());

    console.log('config-->', config)

    const pipeline = [
      { $match: { type: 'earning', status: { $in: ['available', 'pending'] } } },
      {
        $group: {
          _id: '$vendor',
          available: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$status', 'available'] }, { $eq: [RESERVATION, null] }] },
                '$amount',
                0,
              ],
            },
          },
          reserved: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$status', 'available'] }, { $ne: [RESERVATION, null] }] },
                '$amount',
                0,
              ],
            },
          },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] } },
          entryCount: { $sum: 1 },
          lastEarningAt: { $max: '$createdAt' },
        },
      },
      { $lookup: { from: 'vendors', localField: '_id', foreignField: '_id', as: 'vendorDoc' } },
      { $unwind: { path: '$vendorDoc', preserveNullAndEmptyArrays: true } },
    ];

    if (options.search) {
      const term = String(options.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (term) {
        pipeline.push({
          $match: {
            $or: [
              { 'vendorDoc.business.name': new RegExp(term, 'i') },
              { 'vendorDoc.vendorId': new RegExp(term, 'i') },
            ],
          },
        });
      }
    }

    const [rows, countRows] = await Promise.all([
      VendorLedger.aggregate([
        ...pipeline,
        { $sort: { available: -1, _id: 1 } },
        { $skip: skip },
        { $limit: limit },
      ]),
      VendorLedger.aggregate([...pipeline, { $count: 'total' }]),
    ]);

    const total = countRows[0]?.total || 0;

    const vendors = rows.map((row) => {
      const vendorDoc = row.vendorDoc || {};
      const available = fee.roundMoney(row.available);
      const bank = vendorDoc.bankDetails || {};

      return {
        vendorId: row._id,
        vendorCode: vendorDoc.vendorId,
        businessName: vendorDoc.business?.name || 'Unnamed vendor',
        availableBalance: available,
        pendingBalance: fee.roundMoney(row.pending),
        reservedBalance: fee.roundMoney(row.reserved),
        entryCount: row.entryCount,
        lastEarningAt: row.lastEarningAt,
        holdDays: config.holdDays,
        minPayoutAmount: config.minPayoutAmount,
        // Whether the vendor can be paid at all, without revealing the account.
        hasPayoutDestination: Boolean(bank.accountNumber || bank.upiId),
        payoutMethod: bank.upiId ? 'upi' : bank.accountNumber ? 'bank_transfer' : null,
        // The destination an admin will actually pay to. Without this the create
        // dialog had only `accountNumberMasked` to show, so a UPI vendor displayed
        // a bank account number right next to the word "Upi".
        upiId: bank.upiId || null,
        bankName: bank.bankName || null,
        accountNumberMasked: maskAccountNumber(bank.accountNumber),
        // Lets the UI disable the row and explain why instead of failing later.
        isPayable: available >= config.minPayoutAmount && Boolean(bank.accountNumber || bank.upiId),
        belowMinimum: available < config.minPayoutAmount,
      };
    });

    return {
      vendors,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /**
   * An aggregation does not cast, so a string id silently matches nothing.
   * Fail loudly instead of returning an empty result that looks like "no money".
   */
  toObjectId(value, label) {
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
      return new mongoose.Types.ObjectId(value);
    }
    throw new AppError(`Invalid ${label || 'id'}`, 400);
  }
}

const settlementService = new SettlementService();

module.exports = settlementService;
module.exports.SettlementService = SettlementService;
module.exports.BALANCE_TYPES = BALANCE_TYPES;
module.exports.PAYMENT_SCOPED_TYPES = PAYMENT_SCOPED_TYPES;
module.exports.DEFAULTS = DEFAULTS;
module.exports.maskAccountNumber = maskAccountNumber;
module.exports.generatePayoutNumber = generatePayoutNumber;
