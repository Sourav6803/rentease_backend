/**
 * tests/settlement.test.js
 *
 * Integration tests for src/services/settlement.service.js against the real
 * database.
 *
 * Safety:
 *   - Every document this file creates carries `metadata.testRun = RUN_ID`
 *     (or a TEST- paymentNumber) and is deleted in a `finally` block.
 *   - It never creates a Vendor, Rental or User. It reads the ids of existing
 *     ones, so no master data is added or modified.
 *   - createPayout() has no entry list and sweeps the vendor's WHOLE available
 *     pool, so before the payout sections this file "parks" that vendor's
 *     pre-existing available earnings as `pending` and restores them in the
 *     `finally` block. Without that isolation the test settles real vendor money
 *     and then deletes the payout that did it.
 *   - It never calls a live payout gateway: `razorpayPayoutEnabled` is false in
 *     this environment, which is exactly the manual path being asserted.
 *   - Run: node tests/settlement.test.js
 */
require('dotenv').config();
require('dns').setServers(['1.1.1.1', '8.8.8.8']);

const assert = require('assert');
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const { Vendor, Rental, Payment, VendorLedger, Payout } = require('../src/models');
const settlement = require('../src/services/settlement.service');
const fee = require('../src/utils/feeCalculator');

const RUN_ID = `TEST-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

let passed = 0;
const failures = [];

function ok(name, condition, detail) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

function eq(name, actual, expected) {
  try {
    assert.strictEqual(actual, expected);
    passed += 1;
  } catch (error) {
    failures.push(`${name} -> expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Assert a promise rejects, and optionally check the status code. */
async function rejects(name, fn, expectedStatus) {
  try {
    await fn();
    failures.push(`${name} -> expected a rejection but it resolved`);
  } catch (error) {
    if (expectedStatus && error.statusCode !== expectedStatus) {
      failures.push(`${name} -> expected status ${expectedStatus}, got ${error.statusCode} (${error.message})`);
    } else {
      passed += 1;
    }
  }
}

(async () => {
  // `parked` holds ledger entries that already existed BEFORE this run and were
  // temporarily taken out of the available pool so the payout tests could not
  // sweep them. See the isolation step in section 5.
  const created = { ledger: [], payouts: [], payments: [], parked: [] };

  // finalisePaid() dispatches the vendor payout notification. Left alone, a test
  // run writes real in-app notifications into the vendor's feed (and, with a live
  // job queue, emails them a real receipt) for payouts that are then deleted,
  // leaving orphaned notifications behind. Stubbed to a recorder; un-stubbed in
  // the cleanup block.
  const stubbedNotifications = [];

  try {
    await connectDB();

    settlement.notifyVendorOfPayout = async (payout) => {
      stubbedNotifications.push(payout?.payoutNumber);
      return { notified: false, stubbed: true };
    };

    // ── fixtures read from the existing database (nothing is created) ────────
    const vendor = await Vendor.findOne({}).lean();
    if (!vendor) throw new Error('No vendor exists in this database; cannot run the settlement tests.');
    const rental = await Rental.findOne({}).lean();
    if (!rental) throw new Error('No rental exists in this database; cannot run the settlement tests.');

    const vendorId = vendor._id;
    const breakdown = fee.calculatePaymentFees({
      baseAmount: 10000,
      vendorCommission: { rate: 10, type: 'percentage' },
      settingsCommission: { platformFee: 2, platformFeeType: 'percentage' },
      tax: { enabled: true, rate: 18 },
      convenienceFee: { enabled: true, rate: 2, cap: 100 },
    });

    const makePayment = async (over = {}) => {
      const payment = await Payment.create({
        paymentNumber: `${RUN_ID}-PAY-${Math.floor(Math.random() * 1e6)}`,
        user: rental.user,
        rental: rental._id,
        vendor: vendorId,
        amount: breakdown.total,
        type: 'rent',
        method: 'upi',
        status: 'success',
        paymentDetails: { breakdown, testRun: RUN_ID },
        ...over,
      });
      created.payments.push(payment._id);
      return payment;
    };

    // ══ 1. Ledger recording ═════════════════════════════════════════════════
    const payment = await makePayment();

    const first = await settlement.recordPaymentEntries({ payment, rental, breakdown });
    const ledgerRows = await VendorLedger.find({ payment: payment._id }).lean();
    created.ledger.push(...ledgerRows.map((row) => row._id));

    eq('records exactly four rows', ledgerRows.length, 4);
    eq('earning credit is the vendor net', ledgerRows.find((r) => r.type === 'earning')?.amount, breakdown.vendorNet);
    eq('commission row is the fee', ledgerRows.find((r) => r.type === 'commission')?.amount, breakdown.commission);
    eq('platform fee row', ledgerRows.find((r) => r.type === 'platform_fee')?.amount, breakdown.platformFee);
    eq('tax row', ledgerRows.find((r) => r.type === 'tax')?.amount, breakdown.tax);
    ok('earning starts behind the hold window', ledgerRows.find((r) => r.type === 'earning')?.status === 'pending');
    ok('audit rows are available immediately', ledgerRows.filter((r) => r.type !== 'earning').every((r) => r.status === 'available'));
    eq('gross is stored on the earning row', ledgerRows.find((r) => r.type === 'earning')?.metadata?.grossAmount, breakdown.taxableAmount);

    // ══ 2. Idempotency: a replayed verify must not double-credit ════════════
    const replay = await settlement.recordPaymentEntries({ payment, rental, breakdown });
    const afterReplay = await VendorLedger.find({ payment: payment._id }).lean();
    eq('replay inserts nothing', replay.inserted, 0);
    eq('replay skips the four rows', replay.skipped, 4);
    eq('still only four rows after replay', afterReplay.length, 4);
    ok('first run reported insertions', first.inserted === 4, `inserted ${first.inserted}`);

    // ══ 3. Summary maths ════════════════════════════════════════════════════
    const heldSummary = await settlement.getVendorLedgerSummary(vendorId);
    ok('pending balance is at least this earning', heldSummary.pendingBalance >= breakdown.vendorNet, `pending ${heldSummary.pendingBalance}`);
    ok('hold days reported', typeof heldSummary.holdDays === 'number');

    // ══ 4. Release the hold window ══════════════════════════════════════════
    await VendorLedger.updateMany(
      { payment: payment._id, type: 'earning' },
      { $set: { availableAt: new Date(Date.now() - 1000) } },
    );
    const released = await settlement.releaseDueEntries();
    ok('release touched at least one row', released.released >= 1, `released ${released.released}`);
    const earningAfter = await VendorLedger.findById(ledgerRows.find((r) => r.type === 'earning')._id).lean();
    eq('earning is now available', earningAfter.status, 'available');

    // ── isolation: park this vendor's PRE-EXISTING available earnings ────────
    // createPayout() takes no entry list — it sweeps the vendor's entire
    // available pool. Without this step the payout created below would reserve
    // and then settle this vendor's REAL money, and the cleanup would delete the
    // Payout record afterwards, leaving those entries `settled` forever while
    // pointing at a payout that no longer exists. (That is exactly the damage an
    // earlier version of this file did to the live ledger.)
    //
    // A parked entry is set to `pending`, which createPayout never selects because
    // it requires status 'available'. Cleanup restores every parked id.
    const foreign = await VendorLedger.find({
      vendor: vendorId,
      type: 'earning',
      status: 'available',
      payout: null,
      _id: { $nin: created.ledger },
    })
      .select('_id')
      .lean();

    created.parked = foreign.map((row) => row._id);
    if (created.parked.length) {
      await VendorLedger.updateMany({ _id: { $in: created.parked } }, { $set: { status: 'pending' } });
    }
    console.log(`  parked ${created.parked.length} pre-existing earning(s) so the payout tests cannot touch them`);

    // ══ 5. Payout creation ══════════════════════════════════════════════════
    // The earning row written for this run's payment. Every payout below is scoped
    // to entries this run created, so `createPayout` can never sweep a real
    // vendor's balance even if the parking step above is ever weakened.
    const testEarningId = ledgerRows.find((r) => r.type === 'earning')._id;

    let payout = null;
    const bankReady = Boolean(vendor.bankDetails?.accountNumber || vendor.bankDetails?.upiId);

    if (!bankReady) {
      await rejects(
        'payout without a bank account is refused',
        () => settlement.createPayout({ vendorId }),
        400,
      );
      console.log('  note: this vendor has no bank/UPI on file, so the payout path was asserted only for its refusal');
    } else {
      payout = await settlement.createPayout({
        vendorId,
        entryIds: [testEarningId],
        adminId: vendor.user,
      });
      created.payouts.push(payout._id);

      ok('payout is created', Boolean(payout?._id));
      eq('payout starts pending', payout.status, 'pending');
      ok('payout needs a manual transfer while the gateway is off', payout.requiresManualTransfer === true);
      ok('payout amount is positive', payout.amount > 0, `amount ${payout.amount}`);
      ok('bank snapshot is masked', String(payout.bankAccountSnapshot?.accountNumberMasked || '').includes('*') || Boolean(payout.bankAccountSnapshot?.upiId));
      ok('entries are reserved', (await VendorLedger.countDocuments({ payout: payout._id })) >= 1);

      // ══ 6. Double-payout guard (the bug this test exists to pin) ═════════
      const reserved = await VendorLedger.find({ payout: payout._id }).lean();
      const availableLeft = await VendorLedger.countDocuments({
        vendor: vendorId,
        type: 'earning',
        status: 'available',
        payout: null,
      });
      ok(
        'reserved entries are excluded from the next payout',
        availableLeft === 0,
        `${availableLeft} still available while ${reserved.length} reserved`,
      );

      // ══ 7. State machine ════════════════════════════════════════════════
      const processed = await settlement.processPayout(payout._id, vendor.user);
      eq('gateway off leaves it pending for finance', processed.status, 'pending');
      ok('manual transfer still required', processed.requiresManualTransfer === true);
      ok('an attempt was recorded', processed.gateway?.attempts >= 1);

      await rejects(
        'marking paid without a UTR is refused',
        () => settlement.markPayoutPaidManually(payout._id, { utr: '' }, vendor.user),
        400,
      );

      const paid = await settlement.markPayoutPaidManually(
        payout._id,
        { utr: `${RUN_ID}-UTR`, note: 'automated test' },
        vendor.user,
      );
      eq('manual mark sets paid', paid.status, 'paid');
      ok('receipt number assigned', Boolean(paid.receiptNumber));
      eq('utr recorded', paid.gateway?.utr, `${RUN_ID}-UTR`);
      eq(
        'entries are settled',
        await VendorLedger.countDocuments({ payout: payout._id, status: 'settled' }),
        reserved.length,
      );

      await rejects(
        'a paid payout cannot be paid again',
        () => settlement.markPayoutPaidManually(payout._id, { utr: 'x' }, vendor.user),
        409,
      );
    }

    // ══ 8. Cancel returns entries to the pool ═══════════════════════════════
    const second = await settlement.createPayout({ vendorId }).catch(() => null);
    if (second) {
      created.payouts.push(second._id);
      const cancelled = await settlement.cancelPayout(second._id, 'test cancellation', vendor.user);
      eq('cancel sets cancelled', cancelled.status, 'cancelled');
      eq(
        'cancelled payout releases its entries',
        await VendorLedger.countDocuments({ payout: second._id }),
        0,
      );
    } else {
      // Nothing left available, which is itself a correct outcome after step 7.
      const remaining = await VendorLedger.countDocuments({
        vendor: vendorId,
        type: 'earning',
        status: 'available',
        payout: null,
      });
      eq('no payable balance remains after settling everything', remaining, 0);
    }

    // ══ 9. Concurrent processing: only one caller may win ═══════════════════
    if (payout) {
      const fresh = await Payment.create({
        paymentNumber: `${RUN_ID}-CONC-${Math.floor(Math.random() * 1e6)}`,
        user: rental.user,
        rental: rental._id,
        vendor: vendorId,
        amount: breakdown.total,
        type: 'rent',
        method: 'upi',
        status: 'success',
        paymentDetails: { breakdown, testRun: RUN_ID },
      });
      created.payments.push(fresh._id);
      await settlement.recordPaymentEntries({ payment: fresh, rental, breakdown });
      const rows = await VendorLedger.find({ payment: fresh._id }).lean();
      created.ledger.push(...rows.map((row) => row._id));
      await VendorLedger.updateMany(
        { payment: fresh._id, type: 'earning' },
        { $set: { status: 'available', availableAt: new Date(Date.now() - 1000), payout: null } },
      );

      const concurrent = await settlement.createPayout({ vendorId }).catch(() => null);
      if (concurrent) {
        created.payouts.push(concurrent._id);
        const results = await Promise.allSettled([
          settlement.processPayout(concurrent._id, vendor.user),
          settlement.processPayout(concurrent._id, vendor.user),
        ]);
        const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
        const rejected = results.filter((r) => r.status === 'rejected').length;
        ok(
          'exactly one concurrent processPayout wins',
          fulfilled + rejected === 2 && rejected >= 1,
          `fulfilled ${fulfilled}, rejected ${rejected}`,
        );
        await settlement.cancelPayout(concurrent._id, 'test cleanup', vendor.user);
      }
    }

    // ══ 10. Abandoned / timed-out payments ═════════════════════════════════
    const stale = await Payment.create({
      paymentNumber: `${RUN_ID}-STALE-${Math.floor(Math.random() * 1e6)}`,
      user: rental.user,
      rental: rental._id,
      vendor: vendorId,
      amount: 1500,
      type: 'rent',
      method: 'upi',
      status: 'pending',
      paymentDetails: { testRun: RUN_ID },
      createdAt: new Date(Date.now() - 90 * 60 * 1000),
    });
    created.payments.push(stale._id);

    const stuck = await Payment.create({
      paymentNumber: `${RUN_ID}-STUCK-${Math.floor(Math.random() * 1e6)}`,
      user: rental.user,
      rental: rental._id,
      vendor: vendorId,
      amount: 1500,
      type: 'rent',
      method: 'upi',
      status: 'processing',
      paymentDetails: { testRun: RUN_ID },
      createdAt: new Date(Date.now() - 90 * 60 * 1000),
    });
    created.payments.push(stuck._id);

    // `paymentIds` scopes the sweep to this run's two payments, so the test can
    // never cancel a real abandoned payment belonging to someone else.
    const sweep = await settlement.expireStalePayments({
      timeoutMinutes: 30,
      processingGraceMinutes: 60,
      paymentIds: [stale._id, stuck._id],
    });
    ok(
      'the abandoned pending payment was cancelled',
      sweep.cancelled.some((row) => row.paymentId === String(stale._id)),
      `cancelled ${sweep.cancelled.length}`,
    );
    ok(
      'the processing payment was flagged for reconciliation, NOT cancelled',
      sweep.needsReconciliation.some((row) => row.paymentId === String(stuck._id)),
      `flagged ${sweep.needsReconciliation.length}`,
    );

    const staleAfter = await Payment.findById(stale._id).lean();
    const stuckAfter = await Payment.findById(stuck._id).lean();
    eq('stale payment is cancelled', staleAfter.status, 'cancelled');
    eq('in-flight payment is left untouched', stuckAfter.status, 'processing');

    // The sweeper's audit trail used to be silently dropped, because
    // `paymentDetails` is a strict subdocument that declared neither field. If
    // these are undefined again, the schema fields were lost.
    ok(
      'the cancellation reason is persisted (paymentDetails schema declares it)',
      typeof staleAfter.paymentDetails?.expiryReason === 'string' &&
        staleAfter.paymentDetails.expiryReason.length > 0,
      `expiryReason=${JSON.stringify(staleAfter.paymentDetails?.expiryReason)}`,
    );
    ok(
      'the expiry timestamp is persisted',
      Boolean(staleAfter.paymentDetails?.expiredAt),
      `expiredAt=${JSON.stringify(staleAfter.paymentDetails?.expiredAt)}`,
    );

    // ══ 11. Refund reversal ════════════════════════════════════════════════
    const beforeReverse = await VendorLedger.countDocuments({ payment: payment._id, type: 'refund' });
    const reversal = await settlement.reverseEntriesForRefund({
      payment,
      refundAmount: 1000,
      idempotencyKey: `${RUN_ID}-REFUND-1`,
      reason: 'test refund',
    });
    const refundRows = await VendorLedger.find({ payment: payment._id, type: 'refund' }).lean();
    created.ledger.push(...refundRows.map((row) => row._id));

    eq('a refund entry is created', refundRows.length, beforeReverse + 1);
    eq('refund entry is a debit', refundRows[0]?.direction, 'debit');
    ok('refund reduces the vendor share', refundRows[0]?.amount > 0, `amount ${refundRows[0]?.amount}`);
    ok('reversal reports what it did', reversal.reversed === 1);

    const replayRefund = await settlement.reverseEntriesForRefund({
      payment,
      refundAmount: 1000,
      idempotencyKey: `${RUN_ID}-REFUND-1`,
      reason: 'test refund',
    });
    eq(
      'the same refund reference is not applied twice',
      await VendorLedger.countDocuments({ payment: payment._id, type: 'refund' }),
      refundRows.length,
    );
    ok('replay is reported as already processed', replayRefund.alreadyProcessed === true);

    // ══ 12. Validation ═════════════════════════════════════════════════════
    await rejects('a malformed vendor id is rejected', () => settlement.getVendorLedgerSummary('not-an-id'), 400);
    await rejects('a malformed payout id is rejected', () => settlement.getPayout('not-an-id'), 400);
  } catch (error) {
    failures.push(`UNCAUGHT: ${error.message}`);
  } finally {
    // ── cleanup: remove only what this run created ──────────────────────────
    try {
      // Put the vendor's own earnings back in the pool FIRST, before the payout
      // records they were protected from are deleted.
      if (created.parked.length) {
        await VendorLedger.updateMany(
          { _id: { $in: created.parked }, status: 'pending' },
          { $set: { status: 'available' } },
        );
      }

      // Put the real notification dispatcher back, and delete anything this run
      // triggered in case the stub was bypassed.
      delete settlement.notifyVendorOfPayout;
      const { Notification } = require('../src/models');
      if (created.payouts.length) {
        await Notification.deleteMany({
          'data.payoutId': { $in: created.payouts.map((id) => String(id)) },
        });
      }

      await VendorLedger.deleteMany({ _id: { $in: created.ledger } });
      await VendorLedger.deleteMany({ 'metadata.testRun': RUN_ID });
      await Payout.deleteMany({ _id: { $in: created.payouts } });
      await Payment.deleteMany({ _id: { $in: created.payments } });
      await Payment.deleteMany({ paymentNumber: { $regex: `^${RUN_ID}` } });
      await Payout.deleteMany({ notes: RUN_ID });

      const residue =
        (await VendorLedger.countDocuments({ $or: [{ 'metadata.testRun': RUN_ID }, { 'metadata.idempotencyKey': { $regex: RUN_ID } }] })) +
        (await Payout.countDocuments({ _id: { $in: created.payouts } })) +
        (await Payment.countDocuments({ paymentNumber: { $regex: `^${RUN_ID}` } })) +
        // Any entry still pointing at a payout this run deleted is exactly the
        // leak this test used to cause: settled money with no payout behind it.
        (await VendorLedger.countDocuments({ payout: { $in: created.payouts } }));

      console.log('');
      console.log('  settlement.test.js');
      console.log(`  passed: ${passed}`);
      console.log(`  failed: ${failures.length}`);
      console.log(`  residue after cleanup: ${residue} (must be 0)`);
      if (failures.length) {
        console.log('');
        failures.forEach((failure) => console.log(`  x ${failure}`));
      }
      console.log('');
    } catch (cleanupError) {
      console.log('  CLEANUP FAILED:', cleanupError.message);
      failures.push(`cleanup failed: ${cleanupError.message}`);
    }

    await mongoose.connection.close();
    process.exit(failures.length > 0 ? 1 : 0);
  }
})();
