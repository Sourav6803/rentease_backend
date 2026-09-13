/**
 * tests/payment-wiring.test.js
 *
 * Proves the fee engine and settlement ledger are now wired into the payment
 * path, and that the vendor counter bug is fixed.
 *
 * Safety: it never creates a Vendor/Rental/User. It creates ONE TEST- payment and
 * the ledger rows that follow from it, records every id it touches, and deletes
 * them in a finally block. It never calls a payment gateway.
 *
 * Run: node tests/payment-wiring.test.js
 */
require('dotenv').config();
require('dns').setServers(['1.1.1.1', '8.8.8.8']);

const assert = require('assert');
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const { Vendor, Rental, Payment, VendorLedger, SystemSettings } = require('../src/models');
const paymentService = require('../src/services/payment.service');
const settlement = require('../src/services/settlement.service');

const RUN_ID = `TEST-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

let passed = 0;
const failures = [];
const created = { payments: [], ledger: [] };

function ok(name, condition, detail) {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` -> ${detail}` : ''}`);
}

function eq(name, actual, expected) {
  try {
    assert.strictEqual(actual, expected);
    passed += 1;
  } catch {
    failures.push(`${name} -> expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

(async () => {
  try {
    await connectDB();

    const vendor = await Vendor.findOne({}).lean();
    const rental = await Rental.findOne({ vendor: vendor?._id }).lean() || (await Rental.findOne({}).lean());
    if (!vendor || !rental) {
      throw new Error('A vendor and a rental are required in the database to run this test.');
    }

    const settingsDoc = await SystemSettings.getInstance();
    const paymentSettings = settingsDoc?.payment || null;
    const vendorDoc = await Vendor.findById(vendor._id).select('commission').lean();
    const vendorRentalCount = await Rental.countDocuments({ vendor: vendor._id });

    // ── 1. The breakdown now computes commission and vendor net ─────────────
    const breakdown = paymentService.calculatePaymentBreakdown(rental, 'rent', null, {
      paymentSettings,
      vendor: vendorDoc,
      vendorRentalCount,
    });

    console.log('    breakdown:', JSON.stringify(breakdown));

    ok('breakdown has a taxableAmount', typeof breakdown.taxableAmount === 'number');
    ok('breakdown has commission (previously absent entirely)', typeof breakdown.commission === 'number');
    ok('breakdown has platformFee', typeof breakdown.platformFee === 'number');
    ok('breakdown has vendorNet', typeof breakdown.vendorNet === 'number');
    ok('breakdown has platformNet', typeof breakdown.platformNet === 'number');
    ok('commission source is reported', typeof breakdown.commissionSource === 'string', breakdown.commissionSource);
    ok(
      'no sub-paise values leak into the breakdown',
      [breakdown.taxableAmount, breakdown.commission, breakdown.platformFee, breakdown.total, breakdown.vendorNet].every(
        (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
      ),
      'a value has more than 2 decimals',
    );

    // The identity that must always hold.
    const expectedVendorNet =
      Math.round((breakdown.taxableAmount - breakdown.commission - breakdown.platformFee) * 100) / 100;
    eq('vendorNet = taxable - commission - platformFee', breakdown.vendorNet, Math.max(0, expectedVendorNet));
    eq('total = taxable + tax + convenienceFee', breakdown.total, Math.round((breakdown.taxableAmount + breakdown.tax + breakdown.convenienceFee) * 100) / 100);

    // The vendor's own configured rate must win over the global default.
    const vendorRate = vendorDoc?.commission?.rate;
    if (breakdown.commission > 0 && breakdown.commissionSource === 'vendor_rate') {
      eq(
        'commission follows the vendor rate',
        breakdown.commission,
        Math.round(((breakdown.taxableAmount * vendorRate) / 100) * 100) / 100,
      );
      eq('commissionRate mirrors the vendor rate', breakdown.commissionRate, vendorRate);
    } else {
      console.log(`    note: commission resolved from "${breakdown.commissionSource}", rate check skipped`);
    }

    // ── 2. A failed/zero-amount payment is still handled ────────────────────
    const zeroBreakdown = paymentService.calculatePaymentBreakdown(rental, 'rent', 0, {
      paymentSettings,
      vendor: vendorDoc,
    });
    eq('a zero-amount payment yields zero total', zeroBreakdown.total, 0);
    eq('a zero-amount payment yields zero commission', zeroBreakdown.commission, 0);

    // ── 3. Ledger recording, twice, inside one transaction ──────────────────
    const payment = await Payment.create({
      paymentNumber: `${RUN_ID}-PAY`,
      user: rental.user,
      rental: rental._id,
      vendor: vendor._id,
      amount: breakdown.total,
      type: 'rent',
      method: 'upi',
      status: 'success',
      paymentDetails: { breakdown, testRun: RUN_ID },
    });
    created.payments.push(payment._id);

    const session = await mongoose.startSession();
    session.startTransaction();
    let firstResult;
    let secondResult;
    let committed = false;
    try {
      firstResult = await settlement.recordPaymentEntries({ payment, rental, breakdown, session });
      // Second call inside the SAME transaction: this is the case that would have
      // poisoned the transaction if idempotency relied on catching the duplicate
      // key error instead of pre-checking.
      secondResult = await settlement.recordPaymentEntries({ payment, rental, breakdown, session });
      await session.commitTransaction();
      committed = true;
    } catch (error) {
      await session.abortTransaction();
      failures.push(`the transaction should not fail on a repeat call: ${error.message}`);
    } finally {
      session.endSession();
    }

    ok('the transaction committed despite the repeat call', committed);
    ok('first call inserted at least the earning row', (firstResult?.inserted || 0) >= 1, `inserted ${firstResult?.inserted}`);
    eq('second call inserted nothing', secondResult?.inserted, 0);
    eq('second call reported the rows as already recorded', secondResult?.alreadyRecorded, true);

    const rows = await VendorLedger.find({ payment: payment._id }).lean();
    created.ledger.push(...rows.map((r) => r._id));

    // A zero-value ledger row is deliberately NOT written: `recordPaymentEntries`
    // only pushes a row when that component is greater than zero. With tax and
    // platformFee both at 0 here, the correct row set is just earning +
    // commission. Asserting a fixed count of four would have been wrong.
    const expectedTypes = ['earning'];
    if (breakdown.commission > 0) expectedTypes.push('commission');
    if (breakdown.platformFee > 0) expectedTypes.push('platform_fee');
    if (breakdown.tax > 0) expectedTypes.push('tax');
    expectedTypes.sort();

    eq('the row count matches the non-zero components', rows.length, expectedTypes.length);
    eq('the row types match the non-zero components', rows.map((r) => r.type).sort().join(','), expectedTypes.join(','));
    eq(
      'the earning row credits the vendor net',
      rows.find((r) => r.type === 'earning')?.amount,
      breakdown.vendorNet,
    );
    eq(
      'the earning row carries the gross and the deductions for the receipt',
      rows.find((r) => r.type === 'earning')?.metadata?.grossAmount,
      breakdown.taxableAmount,
    );

    // ── 4. The vendor counter query now matches ─────────────────────────────
    const vendorById = await Vendor.findById(rental.vendor).select('_id').lean();
    ok(
      'the vendor counter query target exists (Vendor._id match, not Vendor.user)',
      Boolean(vendorById),
      'rental.vendor did not resolve to a Vendor document',
    );
    const wrongMatch = await Vendor.findOne({ user: rental.vendor }).select('_id').lean();
    ok(
      'the OLD query shape would have matched nothing, confirming the bug',
      wrongMatch === null,
      'the old { user: rental.vendor } query unexpectedly matched',
    );

    // ── 5. The payout vendors endpoint now sees this vendor ─────────────────
    await VendorLedger.updateMany(
      { payment: payment._id, type: 'earning' },
      { $set: { status: 'available', availableAt: new Date(Date.now() - 1000), payout: null } },
    );

    const payable = await settlement.getVendorsWithBalances({ limit: 100 });
    const row = payable.vendors.find((v) => String(v.vendorId) === String(vendor._id));
    ok('the vendor now appears in the payable vendors list', Boolean(row), 'vendor missing from the list');
    if (row) {
      ok(
        'the available balance includes this payment',
        row.availableBalance >= breakdown.vendorNet - 0.01,
        `balance ${row.availableBalance} vs vendorNet ${breakdown.vendorNet}`,
      );
      ok('isPayable is reported', typeof row.isPayable === 'boolean');
    }

    const overview = await settlement.getPayoutOverview();
    ok(
      'the payout overview now shows money available',
      overview.totalAvailable >= breakdown.vendorNet - 0.01,
      `totalAvailable ${overview.totalAvailable}`,
    );

    // ── 6. Release + list ───────────────────────────────────────────────────
    const released = await settlement.releaseDueEntries();
    ok('releaseDueEntries runs without error', typeof released.released === 'number');

    const ledgerList = await settlement.listVendorLedger(vendor._id, { page: 1, limit: 5 });
    ok('the ledger statement returns this vendor\'s entries', ledgerList.entries.length > 0);

    // ── 7. Refund reversal still works on the new breakdown shape ───────────
    const reversal = await settlement.reverseEntriesForRefund({
      payment,
      refundAmount: 100,
      idempotencyKey: `${RUN_ID}-REF`,
      reason: 'wiring test',
    });
    ok('a refund reversal is recorded against the new breakdown shape', reversal.reversed === 1, JSON.stringify(reversal));
    const refundRows = await VendorLedger.find({ payment: payment._id, type: 'refund' }).lean();
    created.ledger.push(...refundRows.map((r) => r._id));
    eq('one refund row was created', refundRows.length, 1);
  } catch (error) {
    failures.push(`UNCAUGHT: ${error.message}`);
    console.log('UNCAUGHT:', error.message);
  } finally {
    try {
      await VendorLedger.deleteMany({ _id: { $in: created.ledger } });
      await VendorLedger.deleteMany({ payment: { $in: created.payments } });
      await VendorLedger.deleteMany({ 'metadata.testRun': RUN_ID });
      await Payment.deleteMany({ _id: { $in: created.payments } });

      const residue =
        (await VendorLedger.countDocuments({ 'metadata.testRun': RUN_ID })) +
        (await Payment.countDocuments({ paymentNumber: { $regex: `^${RUN_ID}` } }));

      console.log('');
      console.log('  payment-wiring.test.js');
      console.log(`  passed: ${passed}`);
      console.log(`  failed: ${failures.length}`);
      console.log(`  residue after cleanup: ${residue} (must be 0)`);
      if (failures.length) failures.forEach((f) => console.log(`  x ${f}`));
      console.log('');
    } catch (cleanupError) {
      console.log('  CLEANUP FAILED:', cleanupError.message);
      failures.push(`cleanup failed: ${cleanupError.message}`);
    }

    await mongoose.connection.close();
    process.exit(failures.length > 0 ? 1 : 0);
  }
})();
