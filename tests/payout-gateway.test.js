/**
 * tests/payout-gateway.test.js
 *
 * Covers the RazorpayX payout path that transferToVendor used to stub out.
 *
 * SAFETY
 * ------
 *   - No gateway is ever called: getPayoutClient() is stubbed with a recorder, so
 *     the test asserts the PAYLOADS that would have been sent.
 *   - The vendor passed in has a random _id, so the contact/fund-account caching
 *     writes match nothing and no real vendor is touched.
 *   - Only TEST-prefixed Payment and VendorLedger documents are created, and they
 *     are deleted in `finally`.
 *   - The live-settings document is snapshotted and restored, then re-verified.
 *
 * Run: node tests/payout-gateway.test.js
 */
require('dotenv').config();
require('dns').setServers(['1.1.1.1', '8.8.8.8']);
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const SystemSettings = require('../src/models/SystemSettings.model');
const { Payment, VendorLedger, Payout } = require('../src/models');
const settlement = require('../src/services/settlement.service');
const paymentService = require('../src/services/payment.service');

const RUN_ID = `TEST-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

let passed = 0;
const failures = [];

function ok(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? '' : `  (got ${JSON.stringify(detail)})`}`);
  }
}

/** Records every gateway call and returns canned RazorpayX objects. */
function makeRecorder() {
  const calls = [];
  const client = {
    contacts: {
      create: async (payload) => {
        calls.push({ method: 'contacts.create', payload });
        return { id: 'cont_TEST' };
      },
    },
    fundAccounts: {
      create: async (payload) => {
        calls.push({ method: 'fundAccounts.create', payload });
        return { id: 'fa_TEST' };
      },
    },
    payouts: {
      create: async (payload) => {
        calls.push({ method: 'payouts.create', payload });
        return { id: 'pout_TEST', utr: 'UTR_TEST_123', status: 'queued' };
      },
    },
    _calls: calls,
  };
  return client;
}

const PAYOUT_NUMBER = `${RUN_ID}-P1`;
const ENCRYPTED_ACCOUNT = '{"encrypted":"422c793c6590e3c1809722","iv":"69e620c914d14200c7c8d75f5152637a","authTag":"3cbb084d51a013be94eedadc2a97b334"}';

(async () => {
  await connectDB();

  const settings = await SystemSettings.getInstance();
  const snapshot = JSON.parse(JSON.stringify(settings.payment?.payout || {}));

  const originalGetClient = paymentService.getPayoutClient;
  const originalGetCreds = paymentService.getPayoutCredentials;

  const createdPayments = [];
  const createdEntries = [];
  const createdPayouts = [];
  let recorder = makeRecorder();

  try {
    paymentService.getPayoutClient = async () => recorder;

    const basePayout = {
      _id: new mongoose.Types.ObjectId(),
      payoutNumber: PAYOUT_NUMBER,
      amount: 8800,
      entryIds: [],
    };

    // ── 1. flag off => byte-identical to the old behaviour, no network ────────
    console.log('');
    console.log('1. gateway disabled');
    settings.payment.payout = { ...snapshot, razorpayPayoutEnabled: false, testMode: true };
    settings.markModified('payment');
    await settings.save();

    recorder = makeRecorder();
    let result = await settlement.transferToVendor(basePayout, { _id: new mongoose.Types.ObjectId() });
    ok('returns requiresManualTransfer', result.requiresManualTransfer === true, result);
    ok('does not transfer', result.transferred === false);
    ok('makes no gateway call', recorder._calls.length === 0, recorder._calls.length);

    // ── 2. UPI happy path in test mode ───────────────────────────────────────
    console.log('');
    console.log('2. UPI payout in test mode');
    settings.payment.payout = {
      ...snapshot,
      razorpayPayoutEnabled: true,
      testMode: true,
      razorpayAccount: '2323230012345678',
    };
    settings.markModified('payment');
    await settings.save();

    paymentService.getPayoutCredentials = async () => ({
      keyId: 'rzp_test_SENTINELKEYID',
      keySecret: 'sentinel',
      source: { keyId: 'settings', keySecret: 'settings' },
    });

    const upiVendor = {
      _id: new mongoose.Types.ObjectId(), // matches no document, so no caching write
      vendorId: 'VEN-TEST',
      business: { name: 'Test Vendor' },
      contact: { primaryEmail: 'vendor@example.test', primaryPhone: '9000000000' },
      bankDetails: { upiId: 'vendor@ybl', accountHolderName: 'TEST', ifscCode: 'SBIN0001552' },
    };

    recorder = makeRecorder();
    result = await settlement.transferToVendor(basePayout, upiVendor);

    ok('transfers', result.transferred === true, result);
    ok('reports requiresManualTransfer false', result.requiresManualTransfer === false);
    ok('reports the test environment', result.environment === 'test', result.environment);
    ok('surfaces the gateway payout id', result.payoutId === 'pout_TEST', result.payoutId);
    ok('surfaces the UTR', result.utr === 'UTR_TEST_123', result.utr);

    const methods = recorder._calls.map((c) => c.method);
    ok(
      'calls contact, then fund account, then payout (in that order)',
      JSON.stringify(methods) === JSON.stringify(['contacts.create', 'fundAccounts.create', 'payouts.create']),
      methods,
    );

    const fa = recorder._calls.find((c) => c.method === 'fundAccounts.create')?.payload;
    ok('the fund account is a VPA built from the vendor upiId', fa?.account_type === 'vpa', fa?.account_type);
    ok('the VPA address is the vendor upi handle', fa?.vpa?.address === 'vendor@ybl', fa?.vpa?.address);
    ok('the fund account is linked to the contact', fa?.contact_id === 'cont_TEST', fa?.contact_id);

    const po = recorder._calls.find((c) => c.method === 'payouts.create')?.payload;
    ok('the payout amount is in paise', po?.amount === 880000, po?.amount);
    ok('the currency is INR', po?.currency === 'INR');
    ok('a UPI destination pays over UPI', po?.mode === 'UPI', po?.mode);
    ok('the purpose is payout', po?.purpose === 'payout');
    ok('low balance is queued rather than rejected', po?.queue_if_low_balance === true);
    ok('reference_id is the payout number', po?.reference_id === PAYOUT_NUMBER, po?.reference_id);
    ok('the source account is the configured one', po?.account_number === '2323230012345678');
    ok('the environment is recorded in the notes', po?.notes?.environment === 'test');

    // ── 3. bank destination: the account number is decrypted for the gateway ──
    console.log('');
    console.log('3. bank account destination');
    const bankVendor = {
      _id: new mongoose.Types.ObjectId(),
      vendorId: 'VEN-TEST',
      business: { name: 'Test Vendor' },
      bankDetails: {
        accountHolderName: 'SOURAV BHUKTA',
        accountNumber: ENCRYPTED_ACCOUNT,
        ifscCode: 'SBIN0001552',
      },
    };

    recorder = makeRecorder();
    result = await settlement.transferToVendor(basePayout, bankVendor);
    const bankFa = recorder._calls.find((c) => c.method === 'fundAccounts.create')?.payload;
    const bankPo = recorder._calls.find((c) => c.method === 'payouts.create')?.payload;

    ok('transfers from a bank destination', result.transferred === true, result);
    ok('the fund account is a bank_account', bankFa?.account_type === 'bank_account', bankFa?.account_type);
    ok('the account number is DECRYPTED before it is sent', bankFa?.bank_account?.account_number === '38198770006', bankFa?.bank_account?.account_number);
    ok('the ifsc is passed through', bankFa?.bank_account?.ifsc === 'SBIN0001552');
    ok('a bank destination pays over IMPS', bankPo?.mode === 'IMPS', bankPo?.mode);

    // ── 4. THE SAFETY GUARD: live keys must refuse test earnings ──────────────
    console.log('');
    console.log('4. live mode refuses earnings that were not live');
    const testPayment = await Payment.create({
      paymentNumber: `${RUN_ID}-PAY`,
      rental: new mongoose.Types.ObjectId(),
      user: new mongoose.Types.ObjectId(),
      vendor: new mongoose.Types.ObjectId(),
      amount: 8800,
      currency: 'INR',
      method: 'upi',
      type: 'rent',
      status: 'success',
      paymentDetails: { gateway: 'razorpay', gatewayMode: 'test' },
    });
    createdPayments.push(testPayment._id);

    const testEntry = await VendorLedger.create({
      vendor: testPayment.vendor,
      type: 'earning',
      direction: 'credit',
      amount: 8800,
      currency: 'INR',
      status: 'available',
      payment: testPayment._id,
      description: `${RUN_ID} earning`,
    });
    createdEntries.push(testEntry._id);

    const guardedPayout = { ...basePayout, entryIds: [testEntry._id] };

    paymentService.getPayoutCredentials = async () => ({
      keyId: 'rzp_live_SENTINELKEYID', // <- the key says LIVE
      keySecret: 'sentinel',
      source: { keyId: 'settings', keySecret: 'settings' },
    });

    recorder = makeRecorder();
    result = await settlement.transferToVendor(guardedPayout, upiVendor);

    ok('REFUSES the live payout', result.transferred === false, result);
    ok('says why', /Refusing a LIVE payout/.test(String(result.failureReason)), result.failureReason);
    ok('names the offending payment', String(result.failureReason).includes(testPayment.paymentNumber));
    ok('makes NO gateway call', recorder._calls.length === 0, recorder._calls.length);

    // Flip the payment to live -> now it is allowed.
    await Payment.updateOne({ _id: testPayment._id }, { $set: { 'paymentDetails.gatewayMode': 'live' } });
    recorder = makeRecorder();
    result = await settlement.transferToVendor(guardedPayout, upiVendor);
    ok('allows it once the earning really came from a live payment', result.transferred === true, result);
    ok('reports the live environment', result.environment === 'live', result.environment);

    // ── 5. a failed gateway payout returns its entries to the pool ────────────
    console.log('');
    console.log('5. failed payout releases the reserved entries');
    const reservedPayout = await Payout.create({
      payoutNumber: `${RUN_ID}-P2`,
      vendor: testPayment.vendor,
      amount: 4400,
      currency: 'INR',
      method: 'razorpay_payout',
      status: 'processing',
      entryIds: [],
      'gateway.payoutId': 'pout_FAILED_TEST',
      'gateway.mode': 'test',
    });
    createdPayouts.push(reservedPayout._id);

    // A SECOND payment, because the ledger's unique index is {payment, type} — one
    // earning row per payment, which this test also (incidentally) proves.
    const secondPayment = await Payment.create({
      paymentNumber: `${RUN_ID}-PAY2`,
      rental: new mongoose.Types.ObjectId(),
      user: new mongoose.Types.ObjectId(),
      vendor: testPayment.vendor,
      amount: 4400,
      currency: 'INR',
      method: 'upi',
      type: 'rent',
      status: 'success',
      paymentDetails: { gateway: 'razorpay', gatewayMode: 'test' },
    });
    createdPayments.push(secondPayment._id);

    const reservedEntry = await VendorLedger.create({
      vendor: testPayment.vendor,
      type: 'earning',
      direction: 'credit',
      amount: 4400,
      currency: 'INR',
      status: 'available',
      payout: reservedPayout._id, // reserved by the in-flight payout
      payment: secondPayment._id,
      description: `${RUN_ID} reserved earning`,
    });
    createdEntries.push(reservedEntry._id);

    // `createPayout` records both sides of the reservation; mirror that here so the
    // fixture is shaped like production data.
    await Payout.updateOne(
      { _id: reservedPayout._id },
      { $set: { entryIds: [reservedEntry._id] } },
    );

    const failResult = await paymentService.handleRazorpayPayoutFailed({
      id: 'pout_FAILED_TEST',
      reference_id: `${RUN_ID}-P2`,
      failure_reason: 'beneficiary bank unavailable',
      notes: { environment: 'test' },
    });

    ok('the failure was applied', failResult.applied === true, failResult);
    ok('one entry was released', failResult.releasedEntries === 1, failResult.releasedEntries);

    const released = await VendorLedger.findById(reservedEntry._id).lean();
    ok('the entry is no longer reserved by the payout', released.payout === null, released.payout);

    const failedPayout = await Payout.findById(reservedPayout._id).lean();
    ok('the payout is marked failed', failedPayout.status === 'failed', failedPayout.status);
    ok('the failure reason is stored', /beneficiary bank unavailable/.test(String(failedPayout.gateway?.failureReason)), failedPayout.gateway?.failureReason);

    // Idempotency: a retried failure must not double-release anything.
    const again = await paymentService.handleRazorpayPayoutFailed({ id: 'pout_FAILED_TEST' });
    ok('a retried failure event is a no-op on the entries', again.releasedEntries === 0, again.releasedEntries);
  } finally {
    paymentService.getPayoutClient = originalGetClient;
    paymentService.getPayoutCredentials = originalGetCreds;

    if (createdPayments.length) await Payment.deleteMany({ _id: { $in: createdPayments } });
    if (createdEntries.length) await VendorLedger.deleteMany({ _id: { $in: createdEntries } });
    if (createdPayouts.length) await Payout.deleteMany({ _id: { $in: createdPayouts } });
    await VendorLedger.deleteMany({ 'metadata.payoutNumber': { $regex: RUN_ID } });

    const restore = await SystemSettings.getInstance();
    restore.payment.payout = snapshot;
    restore.markModified('payment');
    await restore.save();
  }

  console.log('');
  const residue = {
    payments: await Payment.countDocuments({ paymentNumber: { $regex: RUN_ID } }),
    entries: await VendorLedger.countDocuments({ description: { $regex: RUN_ID } }),
    payouts: await Payout.countDocuments({ payoutNumber: { $regex: RUN_ID } }),
  };
  ok('residue after cleanup: 0', residue.payments + residue.entries + residue.payouts === 0, residue);

  const after = await SystemSettings.getInstance();
  ok(
    'payout settings restored to the snapshot',
    JSON.stringify(JSON.parse(JSON.stringify(after.payment?.payout || {}))) === JSON.stringify(snapshot),
    after.payment?.payout,
  );

  console.log('');
  console.log(`  passed: ${passed}`);
  console.log(`  failed: ${failures.length}${failures.length ? `  -> ${failures.join(' | ')}` : ''}`);

  await mongoose.connection.close();
  process.exitCode = failures.length ? 1 : 0;
})();
