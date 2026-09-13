/**
 * tests/backfill-ledger.js
 *
 * ONE-TIME BACKFILL — give the settlement ledger a record for every successful
 * payment that predates the fee engine.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * `payment.service.verifyPayment` only started calling
 * `settlement.recordPaymentEntries` once the fee engine was wired in. Every
 * payment taken before that has no ledger rows at all, so:
 *
 *   - the vendor has no payable balance,
 *   - `/api/v1/admin/payouts/vendors` lists nobody,
 *   - `getPayoutOverview().totalAvailable` is 0,
 *   - no payout can ever be created for that money.
 *
 * The money was real; only the bookkeeping is missing. This script writes the
 * missing bookkeeping.
 *
 * HOW THE SPLIT IS DERIVED
 * ------------------------
 * A historical payment stores no `commission`/`vendorNet`, so they are computed
 * with the same pure engine the live path uses (`utils/feeCalculator`), from:
 *   - the payment's own stored breakdown when it has one (base amount, discount),
 *   - otherwise the rental value, otherwise the amount actually charged,
 *   - the vendor's configured commission, then the global settings rate.
 *
 * The commission rate applied is TODAY's configured rate, not the rate that was
 * in force on the day (that number was never recorded anywhere). The script
 * prints every figure it is about to write so the result can be checked.
 *
 * SAFETY
 * ------
 *   - DRY RUN BY DEFAULT. Nothing is written without `--apply`.
 *   - Idempotent: payments that already have any ledger row are skipped, and the
 *     unique index on { payment, type } is the hard backstop.
 *   - The hold window is credited from the moment the payment actually completed,
 *     so an old earning becomes payable immediately instead of waiting another
 *     full hold cycle. Entries still inside their window stay `pending`.
 *
 * USAGE
 * -----
 *   node tests/backfill-ledger.js                 # preview only
 *   node tests/backfill-ledger.js --apply         # write
 *   node tests/backfill-ledger.js --apply --limit 5
 */

require('dotenv').config();
// This machine's stub resolver cannot resolve the Atlas SRV record; point node at
// public resolvers (same workaround as the other suites).
require('dns').setServers(['1.1.1.1', '8.8.8.8']);

const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const { Payment, Rental, Vendor, VendorLedger, SystemSettings } = require('../src/models');
const settlement = require('../src/services/settlement.service');
const { calculatePaymentFees, roundMoney } = require('../src/utils/feeCalculator');

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Math.max(0, parseInt(process.argv[limitArg + 1], 10) || 0) : 0;

const money = (v) =>
  `Rs ${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'unknown');

/**
 * The base the commission is charged on.
 * Prefers what the payment itself recorded, then the rental value, then the
 * amount the customer was actually charged (which includes tax, so it is the
 * least accurate of the three and only used as a last resort).
 */
function pickBaseAmount(payment, rental) {
  const stored = payment?.paymentDetails?.breakdown;
  const candidates = [
    stored?.baseAmount,
    rental?.rentalDetails?.totalAmount,
    payment?.amount,
  ];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n > 0) return roundMoney(n);
  }
  return 0;
}

const pos = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * The split for one payment.
 *
 * Three cases, in order of trustworthiness:
 *
 *  1. `stored.vendorNet` exists — the payment was taken after the fee engine was
 *     wired in, so the recorded split is exactly what the customer was charged
 *     and what the gateway settled. Copied verbatim.
 *
 *  2. A LEGACY breakdown (baseAmount/discount/tax/convenienceFee/total, but no
 *     commission). The commission is rebuilt on `baseAmount - discount` — the
 *     taxable value that the live code charges commission on — using the STORED
 *     discount rather than re-deriving it from the rental. Re-deriving is wrong
 *     here: the long-tenure discount depends on `rental.rentalDetails`, and the
 *     rental document may since have been deleted, in which case the discount
 *     would silently vanish and commission would be overcharged on the
 *     pre-discount amount. Tax and convenience fee come from the stored figures
 *     too, because today's rates must not be applied retroactively.
 *
 *  3. Nothing usable stored — fall back to the rental value, then the amount the
 *     customer was actually charged.
 */
function resolveBreakdown({ payment, rental, vendorDoc, rentalCount, paymentSettings }) {
  const stored = payment?.paymentDetails?.breakdown;

  if (stored && Number.isFinite(Number(stored.vendorNet))) {
    return {
      breakdown: {
        baseAmount: Number(stored.baseAmount) || 0,
        discount: Number(stored.discount) || 0,
        taxableAmount: Number(stored.taxableAmount) || 0,
        commission: Number(stored.commission) || 0,
        commissionRate: stored.commissionRate,
        commissionType: stored.commissionType,
        commissionSource: stored.commissionSource || 'stored',
        platformFee: Number(stored.platformFee) || 0,
        platformFeeType: stored.platformFeeType,
        tax: Number(stored.tax) || 0,
        convenienceFee: Number(stored.convenienceFee) || 0,
        total: Number(stored.total) || 0,
        vendorNet: Number(stored.vendorNet) || 0,
        platformNet: Number(stored.platformNet) || 0,
      },
      derivedFrom: 'stored-split',
    };
  }

  const storedBase = pos(stored?.baseAmount);
  if (storedBase > 0) {
    const storedDiscount = pos(stored?.discount);
    const taxableAmount = roundMoney(Math.max(0, storedBase - storedDiscount));
    const tax = pos(stored?.tax);
    const convenienceFee = pos(stored?.convenienceFee);
    const storedTotal = pos(stored?.total);

    const computed = calculatePaymentFees({
      // The taxable value is already net of the recorded discount.
      baseAmount: taxableAmount,
      paymentType: payment?.type,
      rentalCount,
      vendorCommission: vendorDoc?.commission,
      settingsCommission: paymentSettings?.commission,
      // Discount and the customer-side additions are supplied from the stored
      // record, so the engine must not re-derive them.
      discount: { disabled: true },
      tax: { enabled: false },
      convenienceFee: { enabled: false },
    });

    return {
      breakdown: {
        ...computed,
        discount: roundMoney(storedDiscount),
        tax,
        convenienceFee,
        // What the customer was actually charged, when the record has it.
        total: storedTotal > 0 ? roundMoney(storedTotal) : computed.total,
        // `vendorNet` is untouched by tax and convenience fee (it is
        // taxable - commission - platformFee), so `computed` already has it right.
      },
      derivedFrom: 'stored-base',
    };
  }

  const baseAmount = pickBaseAmount(payment, rental);
  const computed = calculatePaymentFees({
    baseAmount,
    paymentType: payment?.type,
    tenureMonths: rental?.rentalDetails?.tenureMonths,
    categoryId: null,
    rentalCount,
    vendorCommission: vendorDoc?.commission,
    settingsCommission: paymentSettings?.commission,
    tax: {
      enabled: paymentSettings ? paymentSettings.taxEnabled === true : process.env.ENABLE_TAX === 'true',
      rate: paymentSettings?.taxRate ?? 18,
    },
    convenienceFee: {
      enabled: paymentSettings
        ? paymentSettings.convenienceFeeEnabled === true
        : process.env.ENABLE_CONVENIENCE_FEE === 'true',
      rate: paymentSettings?.convenienceFeeRate ?? 2,
      cap: paymentSettings?.convenienceFeeCap ?? 100,
    },
    discount: { longTenureMonths: 6, longTenureRate: 5 },
  });

  return { breakdown: computed, derivedFrom: 'recomputed-from-rental' };
}

(async () => {
  let exitCode = 0;
  try {
    await connectDB();

    const settingsDoc = await SystemSettings.getInstance();
    const paymentSettings = settingsDoc?.payment || null;
    const config = await settlement.getPayoutConfig();

    console.log('');
    console.log('=== RentEase ledger backfill ===');
    console.log(`mode            : ${APPLY ? 'APPLY (writing to the database)' : 'DRY RUN (nothing will be written)'}`);
    console.log(`hold window     : ${config.holdDays} day(s) from the payment completion date`);
    console.log(`min payout      : ${money(config.minPayoutAmount)}`);
    console.log('');

    // ── which payments are missing bookkeeping ───────────────────────────────
    const alreadyRecorded = new Set(
      (await VendorLedger.distinct('payment')).map((id) => String(id)),
    );

    const successPayments = await Payment.find({ status: 'success' })
      .sort({ createdAt: 1 })
      .select('paymentNumber rental vendor amount currency type paymentDetails timestamps createdAt')
      .lean();

    let candidates = successPayments.filter((p) => !alreadyRecorded.has(String(p._id)));
    if (LIMIT > 0) candidates = candidates.slice(0, LIMIT);

    console.log(`successful payments total       : ${successPayments.length}`);
    console.log(`already in the ledger           : ${successPayments.length - successPayments.filter((p) => !alreadyRecorded.has(String(p._id))).length}`);
    console.log(`missing ledger rows            : ${successPayments.filter((p) => !alreadyRecorded.has(String(p._id))).length}`);
    console.log(`to process in this run         : ${candidates.length}`);
    console.log('');

    if (candidates.length === 0) {
      console.log('Nothing to backfill — every successful payment already has ledger rows.');
      return;
    }

    // ── per-vendor caches (rentalCount is a COUNT query per vendor) ──────────
    const vendorCache = new Map();
    const rentalCountCache = new Map();

    async function getVendor(vendorId) {
      const key = String(vendorId);
      if (vendorCache.has(key)) return vendorCache.get(key);
      const doc = await Vendor.findById(vendorId).select('commission user').lean();
      const count = await Rental.countDocuments({ vendor: vendorId });
      vendorCache.set(key, doc);
      rentalCountCache.set(key, count);
      return doc;
    }

    const plan = [];
    const skipped = [];

    for (const payment of candidates) {
      if (!payment.vendor) {
        skipped.push({ payment, reason: 'no vendor on the payment' });
        continue;
      }
      const vendorDoc = await getVendor(payment.vendor);
      if (!vendorDoc) {
        skipped.push({ payment, reason: 'vendor document no longer exists' });
        continue;
      }

      const rental =
        (await Rental.findById(payment.rental)
          .select('_id vendor rentalDetails.totalAmount rentalDetails.tenureMonths rentalNumber')
          .lean()) || null;

      const { breakdown, derivedFrom } = resolveBreakdown({
        payment,
        rental,
        vendorDoc,
        rentalCount: rentalCountCache.get(String(payment.vendor)),
        paymentSettings,
      });

      if (!(breakdown.vendorNet > 0)) {
        skipped.push({ payment, reason: 'computed vendor net is zero' });
        continue;
      }

      // The hold window should have started when the money was actually taken.
      const holdFrom = payment.timestamps?.completed || payment.createdAt;
      const availableAt = new Date(
        new Date(holdFrom).getTime() + config.holdDays * 24 * 60 * 60 * 1000,
      );

      plan.push({ payment, rental, breakdown, derivedFrom, availableAt });
    }

    console.log('--- preview ---');
    for (const row of plan) {
      const { payment, breakdown, derivedFrom, availableAt } = row;
      console.log(
        `${payment.paymentNumber}  ${payment.type || 'rent'}  ${dateOnly(
          payment.timestamps?.completed || payment.createdAt,
        )}  ${String(payment.vendor).slice(-6)}  ` +
          `gross ${money(breakdown.taxableAmount)}  ` +
          `-commission ${money(breakdown.commission)}  ` +
          `-platform ${money(breakdown.platformFee)}  ` +
          `= net ${money(breakdown.vendorNet)}  ` +
          `[${derivedFrom}]  payable ${dateOnly(availableAt)}` +
          (row.rental ? '' : '  (rental document no longer exists)'),
      );
    }

    for (const row of skipped) {
      console.log(`SKIPPED ${row.payment.paymentNumber}: ${row.reason}`);
    }

    const totalNet = roundMoney(plan.reduce((sum, row) => sum + row.breakdown.vendorNet, 0));
    const totalCommission = roundMoney(plan.reduce((sum, row) => sum + row.breakdown.commission, 0));
    console.log('');
    console.log(`entries to create : ${plan.length}`);
    console.log(`vendor net total  : ${money(totalNet)}`);
    console.log(`commission total  : ${money(totalCommission)}`);
    console.log(`skipped           : ${skipped.length}`);
    console.log('');

    if (!APPLY) {
      console.log('DRY RUN complete. Re-run with --apply to write these entries.');
      return;
    }

    // ── write ───────────────────────────────────────────────────────────────
    const paymentIds = [];
    let inserted = 0;
    const failures = [];

    for (const row of plan) {
      try {
        const result = await settlement.recordPaymentEntries({
          payment: row.payment,
          rental: row.rental || { _id: row.payment.rental },
          breakdown: row.breakdown,
          // Credit the hold window from when the money was actually taken.
          availableAt: row.payment.timestamps?.completed || row.payment.createdAt,
        });
        inserted += result.inserted || 0;
        paymentIds.push(row.payment._id);
      } catch (error) {
        failures.push({ payment: row.payment.paymentNumber, error: error.message });
      }
    }

    console.log(`ledger rows inserted : ${inserted}`);
    console.log(`payments recorded    : ${paymentIds.length}`);
    if (failures.length) {
      console.log(`failures             : ${failures.length}`);
      for (const f of failures) console.log(`  ${f.payment}: ${f.error}`);
    }

    // Promote the backfilled earnings whose hold window has already elapsed.
    // Scoped to the payments this run touched, so nothing else is affected.
    const now = new Date();
    const released = await VendorLedger.updateMany(
      {
        payment: { $in: paymentIds },
        type: 'earning',
        status: 'pending',
        availableAt: { $lte: now },
      },
      { $set: { status: 'available' } },
    );
    const stillHeld = await VendorLedger.countDocuments({
      payment: { $in: paymentIds },
      type: 'earning',
      status: 'pending',
    });

    console.log(`earnings now payable : ${released.modifiedCount ?? released.nModified ?? 0}`);
    console.log(`earnings still held  : ${stillHeld} (inside the ${config.holdDays}-day window)`);

    // ── verification ────────────────────────────────────────────────────────
    const overview = await settlement.getPayoutOverview();
    const vendors = await settlement.getVendorsWithBalances({ page: 1, limit: 5 });

    console.log('');
    console.log('--- after backfill ---');
    console.log(`payout overview : totalAvailable ${money(overview.totalAvailable)}  totalPending ${money(overview.totalPending)}`);
    console.log(`vendors with balances : ${vendors.pagination?.total ?? vendors.vendors?.length ?? 0}`);
    for (const v of (vendors.vendors || []).slice(0, 5)) {
      console.log(
        `  ${v.businessName || v.vendorCode || String(v.vendorId).slice(-6)}  ` +
          `available ${money(v.availableBalance)}  pending ${money(v.pendingBalance)}`,
      );
    }
    console.log('');
    console.log('Backfill complete.');
  } catch (error) {
    exitCode = 1;
    console.error('BACKFILL FAILED:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.connection.close().catch(() => {});
    process.exit(exitCode);
  }
})();
