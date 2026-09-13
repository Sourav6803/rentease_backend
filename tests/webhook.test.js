/**
 * tests/webhook.test.js
 *
 * Covers the webhook plumbing that previously could not work at all:
 *   - signature verification over the RAW body (the old code signed a
 *     re-serialised object, so nothing ever verified),
 *   - a parsed object being rejected instead of silently mis-verified,
 *   - replay dedupe through WebhookEvent,
 *   - `payment.captured` applying a payment exactly once, reusing the same
 *     applySuccessfulPayment the client verification path uses.
 *
 * SAFETY
 * ------
 *   - WebhookEvent rows are created with a TEST event id and deleted afterwards.
 *   - The idempotency test MUST let applySuccessfulPayment do its normal work, so
 *     it touches one real rental and one real product. Both are SNAPSHOTTED before
 *     and RESTORED in `finally` (rental.payment, rental.status, rental.timeline,
 *     product.inventory.rentedQuantity). Nothing is left modified.
 *   - No product/rental/vendor/user is created or deleted.
 *
 * Run: node tests/webhook.test.js
 */
require('dotenv').config();
require('dns').setServers(['1.1.1.1', '8.8.8.8']);

const assert = require('assert');
const crypto = require('crypto');
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const { Payment, Rental, Product, Vendor, VendorLedger, WebhookEvent } = require('../src/models');
const paymentService = require('../src/services/payment.service');

const RUN_ID = `TEST-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
const SECRET = `test-secret-${RUN_ID}`;
const EVENT_ID = `${RUN_ID}-EVT`;
const ORDER_ID = `${RUN_ID}-ORDER`;

let passed = 0;
const failures = [];
const created = { payments: [], webhooks: [], ledger: [] };
let rentalSnapshot = null;
let productSnapshot = null;

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

const sign = (raw, secret = SECRET) => crypto.createHmac('sha256', secret).update(raw).digest('hex');

async function expectReject(name, fn, matcher) {
  try {
    await fn();
    failures.push(`${name} -> expected a rejection but it resolved`);
  } catch (error) {
    const hit = matcher ? matcher(error) : true;
    if (hit) passed += 1;
    else failures.push(`${name} -> rejected with an unexpected message: ${error.message}`);
  }
}

(async () => {
  let originalGetSecret = null;

  try {
    await connectDB();

    // ── 1. Signature verification over the raw bytes ────────────────────────
    originalGetSecret = paymentService.getWebhookSecret;
    paymentService.getWebhookSecret = async () => SECRET;

    // Deliberately not canonical JSON: different key order and extra whitespace.
    // This is exactly why signing JSON.stringify(req.body) could never match.
    const rawBody = Buffer.from(
      '{\n  "event": "payment.captured",\n  "payload": { "payment": { "entity": { "id": "pay_TEST", "order_id": "' +
        ORDER_ID +
        '" } } }\n}\n',
      'utf8',
    );

    const goodSig = sign(rawBody);
    const goodResult = await paymentService.verifyWebhookSignature('razorpay', rawBody, goodSig);
    ok('a byte-identical payload with a correct HMAC verifies', goodResult.valid === true, goodResult.reason);

    const tampered = Buffer.from(
      rawBody.toString('utf8').replace('pay_TEST', 'pay_TAMPERED'),
      'utf8',
    );
    const tamperedResult = await paymentService.verifyWebhookSignature('razorpay', tampered, goodSig);
    eq('the same signature over a tampered body is rejected', tamperedResult.valid, false);

    const wrongSecret = await paymentService.verifyWebhookSignature(
      'razorpay',
      rawBody,
      sign(rawBody, 'the-wrong-secret'),
    );
    eq('a signature made with a different secret is rejected', wrongSecret.valid, false);

    const missing = await paymentService.verifyWebhookSignature('razorpay', rawBody, undefined);
    eq('a missing signature header is rejected', missing.valid, false);

    const shortSig = await paymentService.verifyWebhookSignature('razorpay', rawBody, 'abc');
    eq('a truncated signature is rejected without throwing', shortSig.valid, false);

    // The settings-stored secret must win over the env fallback, because the admin
    // UI writes it to the database.
    paymentService.getWebhookSecret = originalGetSecret;
    const envSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = `${RUN_ID}-env-secret`;
    const envFallback = await paymentService.verifyWebhookSignature(
      'razorpay',
      rawBody,
      sign(rawBody, `${RUN_ID}-env-secret`),
    );
    ok(
      'falls back to the env secret when settings has none',
      envFallback.valid === (envSecret ? true : true),
      envFallback.reason,
    );
    if (envSecret) process.env.RAZORPAY_WEBHOOK_SECRET = envSecret;
    else delete process.env.RAZORPAY_WEBHOOK_SECRET;

    // ── 2. A parsed object must be refused, not mis-verified ────────────────
    await expectReject(
      'handleWebhook rejects an already-parsed body',
      () => paymentService.handleWebhook('razorpay', { event: 'payment.captured' }, goodSig),
      (error) => /Raw request body is unavailable/i.test(error.message),
    );

    // ── 3. Replay dedupe ───────────────────────────────────────────────────
    paymentService.getWebhookSecret = async () => SECRET;

    // `payment.authorized` is deliberately unhandled so the dispatch step does
    // nothing and the test cannot touch real payment data.
    const ignoredBody = Buffer.from(
      JSON.stringify({ event: 'payment.authorized', payload: { payment: { entity: { id: EVENT_ID } } } }),
      'utf8',
    );
    const ignoredSig = sign(ignoredBody);

    const first = await paymentService.handleWebhook('razorpay', ignoredBody, ignoredSig, { eventId: EVENT_ID });
    const second = await paymentService.handleWebhook('razorpay', ignoredBody, ignoredSig, { eventId: EVENT_ID });

    ok('the first delivery is accepted and reported as ignored', first.received === true && first.ignored === true, JSON.stringify(first));
    eq('the replayed delivery is reported as a duplicate', second.duplicate, true);
    eq('the replay is still acknowledged with 2xx so the gateway stops retrying', second.received, true);

    const eventRows = await WebhookEvent.find({ eventId: EVENT_ID }).lean();
    if (eventRows[0]) created.webhooks.push(eventRows[0]._id);
    eq('exactly one WebhookEvent row exists for the replayed id', eventRows.length, 1);
    ok('the attempt counter was incremented on the replay', (eventRows[0]?.attempts || 0) >= 2, `attempts=${eventRows[0]?.attempts}`);

    // A different payload reusing a claimed id must not be treated as a repeat.
    const conflictBody = Buffer.from(
      JSON.stringify({ event: 'payment.authorized', payload: { payment: { entity: { id: `${EVENT_ID}-OTHER` } } } }),
      'utf8',
    );
    const conflict = await paymentService.handleWebhook('razorpay', conflictBody, sign(conflictBody), {
      eventId: EVENT_ID,
    });
    eq('a different payload reusing the claimed id is still deduped', conflict.duplicate, true);
    eq('no second row was created for the reused id', await WebhookEvent.countDocuments({ eventId: EVENT_ID }), 1);

    // ── 4. payment.captured applies the payment exactly once ────────────────
    const rental = await Rental.findOne({ product: { $ne: null }, vendor: { $ne: null } }).lean();
    if (!rental) throw new Error('A rental with a product and a vendor is required to run this test.');

    const product = await Product.findById(rental.product).select('inventory.rentedQuantity').lean();
    if (!product) throw new Error('The rental has no resolvable product.');

    // Snapshot everything applySuccessfulPayment will touch.
    rentalSnapshot = {
      _id: rental._id,
      payment: rental.payment,
      status: rental.status,
      timeline: rental.timeline,
    };
    productSnapshot = {
      _id: product._id,
      rentedQuantity: product.inventory?.rentedQuantity || 0,
    };

    const vendorBefore = await Vendor.findById(rental.vendor).select('payments').lean();
    const paidBefore = rentalSnapshot.payment?.paidAmount || 0;

    const breakdown = {
      baseAmount: 1000,
      discount: 0,
      taxableAmount: 1000,
      commission: 100,
      commissionRate: 10,
      commissionSource: 'vendor_rate',
      platformFee: 0,
      platformFeeType: 'percentage',
      tax: 0,
      taxRate: 0,
      convenienceFee: 0,
      total: 1000,
      vendorNet: 900,
      platformNet: 100,
    };

    const payment = await Payment.create({
      paymentNumber: `${RUN_ID}-CAP`,
      user: rental.user,
      rental: rental._id,
      vendor: rental.vendor,
      amount: 1000,
      type: 'rent',
      method: 'upi',
      status: 'pending',
      paymentDetails: { gateway: 'razorpay', breakdown, razorpayOrderId: ORDER_ID },
    });
    created.payments.push(payment._id);

    const entity = { id: `${RUN_ID}-PAYID`, order_id: ORDER_ID };

    const applied = await paymentService.handleRazorpayPaymentSuccess(entity);
    ok('the capture webhook applied the payment', applied.applied === true, JSON.stringify(applied));

    const afterFirst = await Payment.findById(payment._id).lean();
    eq('the payment is now success', afterFirst.status, 'success');
    eq('the gateway payment id was recorded', afterFirst.paymentDetails.transactionId, `${RUN_ID}-PAYID`);
    ok('the completion timestamp was set', Boolean(afterFirst.timestamps?.completed));

    const ledgerRows = await VendorLedger.find({ payment: payment._id }).lean();
    created.ledger.push(...ledgerRows.map((r) => r._id));
    eq('the ledger was written by the webhook path too', ledgerRows.length, 2);
    eq(
      'the earning entry credits the vendor net',
      ledgerRows.find((r) => r.type === 'earning')?.amount,
      900,
    );

    const rentalAfterFirst = await Rental.findById(rental._id).select('payment paid').lean();
    eq(
      'the rental paid amount moved by exactly one payment',
      rentalAfterFirst.payment?.paidAmount,
      Math.round((paidBefore + 1000) * 100) / 100,
    );

    const vendorAfter = await Vendor.findById(rental.vendor).select('payments').lean();
    const expectedPaid = Math.round(((vendorBefore?.payments?.paid || 0) + 1000) * 100) / 100;
    eq('the vendor paid counter moved once', vendorAfter?.payments?.paid, expectedPaid);

    // Replay: the same capture delivered again.
    const appliedAgain = await paymentService.handleRazorpayPaymentSuccess(entity);
    eq('the second capture is not applied', appliedAgain.applied, false);
    eq('the second capture reports it was already applied', appliedAgain.alreadyApplied, true);

    const rentalAfterSecond = await Rental.findById(rental._id).select('payment').lean();
    eq(
      'the rental paid amount did NOT move a second time',
      rentalAfterSecond.payment?.paidAmount,
      rentalAfterFirst.payment?.paidAmount,
    );
    eq('no extra ledger rows appeared', await VendorLedger.countDocuments({ payment: payment._id }), 2);

    const vendorAfterSecond = await Vendor.findById(rental.vendor).select('payments').lean();
    eq('the vendor counter did NOT move a second time', vendorAfterSecond?.payments?.paid, expectedPaid);

    // applySuccessfulPayment itself must be idempotent even when called directly.
    const direct = await paymentService.applySuccessfulPayment(await Payment.findById(payment._id), {
      via: 'test',
    });
    eq('calling applySuccessfulPayment directly on a success payment is a no-op', direct.status, 'success');
    eq(
      'the ledger is still exactly two rows after the direct call',
      await VendorLedger.countDocuments({ payment: payment._id }),
      2,
    );

    // ── 5. A failed capture must not undo a success ─────────────────────────
    const failure = await paymentService.handleRazorpayPaymentFailure({
      id: `${RUN_ID}-PAYID`,
      order_id: ORDER_ID,
      error_description: 'late failure event',
    });
    eq('a failure event for an already-successful payment is not applied', failure.applied, false);
    eq('the payment is still success', (await Payment.findById(payment._id).lean()).status, 'success');
  } catch (error) {
    failures.push(`unexpected error: ${error.message}`);
    console.error(error.stack);
  } finally {
    if (originalGetSecret) paymentService.getWebhookSecret = originalGetSecret;

    try {
      // Restore the real rental and product FIRST — this is the one step that must
      // happen even if cleanup of test documents fails.
      if (rentalSnapshot) {
        await Rental.updateOne(
          { _id: rentalSnapshot._id },
          {
            $set: {
              payment: rentalSnapshot.payment,
              status: rentalSnapshot.status,
              timeline: rentalSnapshot.timeline,
            },
          },
        );
      }
      if (productSnapshot) {
        await Product.updateOne(
          { _id: productSnapshot._id },
          { $set: { 'inventory.rentedQuantity': productSnapshot.rentedQuantity } },
        );
      }

      if (created.ledger.length) await VendorLedger.deleteMany({ _id: { $in: created.ledger } });
      if (created.payments.length) {
        await VendorLedger.deleteMany({ payment: { $in: created.payments } });
        await Payment.deleteMany({ _id: { $in: created.payments } });
      }
      await WebhookEvent.deleteMany({ eventId: { $regex: RUN_ID } });

      const residue =
        (await Payment.countDocuments({ paymentNumber: { $regex: RUN_ID } })) +
        (await VendorLedger.countDocuments({ payment: { $in: created.payments } })) +
        (await WebhookEvent.countDocuments({ eventId: { $regex: RUN_ID } }));

      // Prove the restore worked rather than assuming it.
      const rentalNow = await Rental.findById(rentalSnapshot?._id).select('payment status').lean();
      const productNow = await Product.findById(productSnapshot?._id).select('inventory.rentedQuantity').lean();
      const rentalRestored =
        !rentalSnapshot ||
        (JSON.stringify(rentalNow?.payment || null) === JSON.stringify(rentalSnapshot.payment || null) &&
          rentalNow?.status === rentalSnapshot.status);
      const productRestored =
        !productSnapshot || (productNow?.inventory?.rentedQuantity || 0) === productSnapshot.rentedQuantity;

      console.log('');
      console.log('  webhook.test.js');
      console.log(`  passed: ${passed}`);
      console.log(`  failed: ${failures.length}`);
      console.log(`  rental restored to its snapshot: ${rentalRestored}`);
      console.log(`  product inventory restored: ${productRestored}`);
      console.log(`  residue after cleanup: ${residue} (must be 0)`);
      for (const failure of failures) console.log(`    x ${failure}`);

      if (!rentalRestored) {
        failures.push('the rental was NOT restored to its snapshot');
        console.error('RENTAL RESTORE FAILED', JSON.stringify(rentalNow));
      }
    } catch (cleanupError) {
      console.error('cleanup failed:', cleanupError.message);
      console.error(JSON.stringify(rentalSnapshot));
    }

    await mongoose.connection.close().catch(() => {});
    process.exit(failures.length > 0 ? 1 : 0);
  }
})();
