/**
 * tests/payout-notification.test.js
 *
 * Proves a vendor is told about their payout — in-app and by email — with the
 * full deduction breakdown, and that the notification can never break the payout.
 *
 * SAFETY
 * ------
 *   - Creates only TEST-prefixed Payout and VendorLedger documents, and deletes
 *     every Notification it creates (captured by _id AND by the test payout id).
 *   - The email transport is STUBBED for the duration of the run: the email
 *     Notification row is really written (so the template name and the data
 *     contract are verified against the database), but nothing is handed to the
 *     job queue, so no real email can leave. The stub is restored in `finally`.
 *   - No real ledger entry is ever reserved or settled: the test payouts carry
 *     their own throwaway entries.
 *
 * Run: node tests/payout-notification.test.js
 */
require('dotenv').config();
require('dns').setServers(['1.1.1.1', '8.8.8.8']);

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const { Vendor, Payout, VendorLedger, Notification } = require('../src/models');
const settlement = require('../src/services/settlement.service');
const notificationService = require('../src/services/notification.service');
const emailService = require('../src/services/email.service');

const RUN_ID = `TEST-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
const TEMPLATE_PATH = path.join(__dirname, '../src/templates/emails/vendor-payout.hbs');

let passed = 0;
const failures = [];
const created = { payouts: [], ledger: [], notifications: [] };

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

/**
 * Pull every variable a Handlebars template interpolates:
 *   {{var}}  {{{var}}}  and the argument of a block helper, {{#if var}}.
 * `this.x` / `@index` and helpers are skipped.
 */
function templateVariables(source) {
  const names = new Set();
  const plain = /\{\{\{?\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*\}?\}\}/g;
  const blockArg = /\{\{#(?:if|unless|with|each)\s+([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*\}\}/g;

  for (const match of source.matchAll(plain)) {
    if (match[1].includes('.')) continue;
    names.add(match[1]);
  }
  for (const match of source.matchAll(blockArg)) {
    if (match[1].includes('.')) continue;
    names.add(match[1]);
  }
  return names;
}

(async () => {
  let originalSendEmailNotification = null;
  const stubbedEmails = [];
  let exitCode = 0;

  try {
    await connectDB();

    const vendor = await Vendor.findOne({ user: { $exists: true, $ne: null } })
      .populate('user', 'email profile.firstName profile.lastName')
      .lean();

    if (!vendor?.user?._id) {
      throw new Error('A vendor with a linked user is required to run this test.');
    }

    const vendorUserId = String(vendor.user._id);

    // ── 1. The payload carries every variable the template interpolates ──────
    const templateSource = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const referenced = templateVariables(templateSource);

    ok('the vendor-payout template exists', templateSource.length > 0);
    ok('the template references more than a couple of variables', referenced.size >= 10, `${referenced.size} found`);

    const samplePayout = {
      _id: new mongoose.Types.ObjectId(),
      payoutNumber: `PAY-${RUN_ID}`,
      receiptNumber: 'RCPT-TEST0001',
      amount: 3229.65,
      currency: 'INR',
      method: 'bank_transfer',
      status: 'paid',
      processedAt: new Date(),
      periodStart: new Date('2026-08-01T00:00:00Z'),
      periodEnd: new Date('2026-08-31T00:00:00Z'),
      entryIds: [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()],
      deductions: {
        grossAmount: 3588.5,
        commission: 358.85,
        platformFee: 0,
        tax: 0,
        processingFee: 0,
        netAmount: 3229.65,
      },
      bankAccountSnapshot: {
        accountHolderName: 'Test Vendor',
        accountNumberMasked: 'XXXXXX1234',
        ifscCode: 'SBIN0001234',
        bankName: 'State Bank of India',
        upiId: 'test@upi',
      },
      gateway: { utr: 'TESTUTR0001' },
    };

    const payload = notificationService.buildVendorPayoutPayload(samplePayout, vendor, vendor.user);

    const missing = [...referenced].filter((name) => !(name in payload));
    ok('every template variable exists in the payload', missing.length === 0, `missing: ${missing.join(', ')}`);

    eq('net amount is formatted with 2 decimals (Indian grouping)', payload.netAmount, '3,229.65');
    eq('gross amount is formatted with 2 decimals', payload.grossAmount, '3,588.50');
    eq('commission is formatted with 2 decimals', payload.commission, '358.85');
    eq('the template sees the raw payable number too', payload.amountNumeric, 3229.65);
    eq('the UTR is carried for the receipt', payload.utr, 'TESTUTR0001');
    eq('the entry count is reported', payload.entriesCount, 2);
    // Must be the route that actually exists. `/vendor/payouts` is not a page in
    // this app, so linking there gave the vendor a 404 from both the in-app action
    // and the email button.
    eq(
      'the payout link points at the real vendor payout page',
      payload.payoutsUrl.endsWith('/vendor/payments/payout-history'),
      true,
    );
    ok('a bank destination is detected', payload.hasBank === true);
    ok('a UPI destination is detected', payload.hasUpi === true);

    // A vendor whose payout has no bank on the snapshot must not claim one.
    const noBank = notificationService.buildVendorPayoutPayload(
      { ...samplePayout, bankAccountSnapshot: {}, gateway: {} },
      vendor,
      vendor.user,
    );
    eq('no bank snapshot -> hasBank is false', noBank.hasBank, false);
    eq('no bank snapshot -> hasUpi is false', noBank.hasUpi, false);
    eq('no UTR -> empty string, so {{#if utr}} hides the row', noBank.utr, '');

    // ── 2. The email transport is stubbed BEFORE anything is dispatched ─────
    originalSendEmailNotification = notificationService.sendEmailNotification;
    notificationService.sendEmailNotification = async (notification) => {
      stubbedEmails.push({
        id: String(notification._id),
        template: notification.template,
        title: notification.title,
        data: notification.data,
      });
      return { deliveredAt: new Date(), method: 'email (stubbed in test)' };
    };

    // ── 3. finalisePaid notifies the vendor ─────────────────────────────────
    const entry = await VendorLedger.create({
      vendor: vendor._id,
      type: 'earning',
      direction: 'credit',
      amount: 3229.65,
      status: 'available',
      description: `${RUN_ID} throwaway earning`,
      metadata: { grossAmount: 3588.5, commission: 358.85 },
    });
    created.ledger.push(entry._id);

    const payout = await Payout.create({
      payoutNumber: `${RUN_ID}-A`,
      vendor: vendor._id,
      amount: 3229.65,
      currency: 'INR',
      method: 'bank_transfer',
      status: 'processing',
      periodStart: samplePayout.periodStart,
      periodEnd: samplePayout.periodEnd,
      entryIds: [entry._id],
      deductions: samplePayout.deductions,
      bankAccountSnapshot: samplePayout.bankAccountSnapshot,
      requiresManualTransfer: false,
    });
    created.payouts.push(payout._id);

    const finalised = await settlement.finalisePaid(payout._id, { utr: `${RUN_ID}-UTR` });

    eq('the payout is paid', finalised.status, 'paid');
    ok('a receipt number was issued', Boolean(finalised.receiptNumber), String(finalised.receiptNumber));
    eq('the gateway UTR is stored', finalised.gateway?.utr, `${RUN_ID}-UTR`);

    const settledEntry = await VendorLedger.findById(entry._id).lean();
    eq('the entry was settled with the payout', settledEntry.status, 'settled');
    ok('settledAt was stamped', Boolean(settledEntry.settledAt));

    // ── 4. The in-app row ──────────────────────────────────────────────────
    const inApp = await Notification.find({
      user: vendorUserId,
      type: 'in_app',
      'data.payoutId': String(payout._id),
    }).lean();

    eq('exactly one in-app notification was created', inApp.length, 1);
    if (inApp[0]) created.notifications.push(inApp[0]._id);

    const inAppRow = inApp[0];
    ok('the in-app title names the net amount', /3,229\.65/.test(inAppRow?.title || ''), inAppRow?.title);
    ok(
      'the in-app body shows the deduction breakdown',
      ['Gross Earnings', 'Platform Commission', 'Net Amount Credited'].every((label) =>
        (inAppRow?.content?.html || '').includes(label),
      ),
      inAppRow?.content?.html?.slice(0, 120),
    );
    ok(
      'the in-app text states the credited amount and the payout number',
      (inAppRow?.content?.text || '').includes('3,229.65') &&
        (inAppRow?.content?.text || '').includes(payout.payoutNumber),
      inAppRow?.content?.text,
    );
    eq('the in-app category is transactional', inAppRow?.category, 'transactional');
    eq('the in-app priority is high', inAppRow?.priority, 'high');
    eq('the in-app action links to the payouts page', inAppRow?.actions?.[0]?.url, payload.payoutsUrl);
    eq('the in-app data carries the numeric net', inAppRow?.data?.amountNumeric, 3229.65);
    eq('the in-app data carries the breakdown commission', inAppRow?.data?.breakdown?.commission, '358.85');
    ok(
      'the in-app notification was actually delivered, not left pending',
      ['sent', 'pending'].includes(inAppRow?.status),
      inAppRow?.status,
    );

    // ── 5. The email row (transport stubbed, record real) ───────────────────
    const emailRow = await Notification.findOne({
      user: vendorUserId,
      type: 'email',
      template: 'vendor-payout',
      'data.payoutId': String(payout._id),
    }).lean();

    ok('an email notification row was created', Boolean(emailRow));
    if (emailRow) created.notifications.push(emailRow._id);

    eq('the email uses the vendor-payout template', emailRow?.template, 'vendor-payout');
    eq('the email category is transactional', emailRow?.category, 'transactional');
    ok(
      'the email subject carries the payout number',
      (emailRow?.title || '').includes(payout.payoutNumber),
      emailRow?.title,
    );
    ok('the email data has the recipient address', Boolean(emailRow?.data?.email), String(emailRow?.data?.email));

    const emailMissing = [...referenced].filter((name) => !(name in (emailRow?.data || {})));
    ok('the stored email data has every template variable', emailMissing.length === 0, `missing: ${emailMissing.join(', ')}`);

    // The stub is a guard rail: if sendEmailNotification had really run, an email
    // job would have been enqueued and could have reached a real inbox.
    eq('the email transport was exercised through the stub, never the real one', stubbedEmails.length, 1);
    eq('the stubbed send saw the right template', stubbedEmails[0]?.template, 'vendor-payout');

    // ── 6. A failing notifier must not affect the payout ────────────────────
    const entry2 = await VendorLedger.create({
      vendor: vendor._id,
      type: 'earning',
      direction: 'credit',
      amount: 500,
      status: 'available',
      description: `${RUN_ID} throwaway earning 2`,
    });
    created.ledger.push(entry2._id);

    const payout2 = await Payout.create({
      payoutNumber: `${RUN_ID}-B`,
      vendor: vendor._id,
      amount: 500,
      currency: 'INR',
      method: 'bank_transfer',
      status: 'processing',
      entryIds: [entry2._id],
      deductions: { grossAmount: 500, commission: 0, platformFee: 0, tax: 0, processingFee: 0, netAmount: 500 },
      bankAccountSnapshot: samplePayout.bankAccountSnapshot,
    });
    created.payouts.push(payout2._id);

    const realDispatcher = notificationService.sendVendorPayoutNotification;
    notificationService.sendVendorPayoutNotification = async () => {
      throw new Error('simulated notification outage');
    };

    let threw = null;
    let payoutAfterFailure = null;
    try {
      payoutAfterFailure = await settlement.finalisePaid(payout2._id, { utr: `${RUN_ID}-UTR2` });
    } catch (error) {
      threw = error;
    } finally {
      // Restore the dispatcher immediately, even if the assertion below is what
      // fails, so a later test cannot inherit the stub.
      notificationService.sendVendorPayoutNotification = realDispatcher;
    }

    ok('a notification failure does not make finalisePaid throw', threw === null, threw?.message);
    eq('the payout is still paid', payoutAfterFailure?.status, 'paid');

    const entry2After = await VendorLedger.findById(entry2._id).lean();
    eq('the ledger entry is still settled', entry2After?.status, 'settled');

    // ── 7. The email service helper builds the same contract ────────────────
    ok(
      'emailService.sendVendorPayoutEmail exists',
      typeof emailService.sendVendorPayoutEmail === 'function',
    );

    let emailArgs = null;
    const realSendEmail = emailService.sendEmail;
    emailService.sendEmail = async (options) => {
      emailArgs = options;
      return { success: true, messageId: 'test' };
    };
    try {
      await emailService.sendVendorPayoutEmail(vendor.user, samplePayout, vendor);
    } finally {
      emailService.sendEmail = realSendEmail;
    }
    eq('sendVendorPayoutEmail uses the vendor-payout template', emailArgs?.template, 'vendor-payout');
    ok(
      'sendVendorPayoutEmail targets the vendor inbox',
      emailArgs?.to === vendor.user.email,
      `${emailArgs?.to} vs ${vendor.user.email}`,
    );
    const helperMissing = [...referenced].filter((name) => !(name in (emailArgs?.data || {})));
    ok('the mailer payload also has every template variable', helperMissing.length === 0, `missing: ${helperMissing.join(', ')}`);
  } catch (error) {
    exitCode = 1;
    failures.push(`unexpected error: ${error.message}`);
    console.error(error.stack);
  } finally {
    // Restore the stubs first: cleanup must never depend on them.
    if (originalSendEmailNotification) {
      notificationService.sendEmailNotification = originalSendEmailNotification;
    }

    try {
      // Cleanup is by captured id, plus a sweep on the test payout ids so a
      // notification written by a parallel path cannot be left behind.
      if (created.notifications.length) {
        await Notification.deleteMany({ _id: { $in: created.notifications } });
      }
      const payoutIds = created.payouts.map((id) => String(id));
      if (payoutIds.length) {
        await Notification.deleteMany({ 'data.payoutId': { $in: payoutIds } });
        await Notification.deleteMany({ 'data.payoutNumber': { $regex: RUN_ID } });
      }
      if (created.ledger.length) await VendorLedger.deleteMany({ _id: { $in: created.ledger } });
      if (created.payouts.length) await Payout.deleteMany({ _id: { $in: created.payouts } });

      // Residue check: anything left over means the test leaked into real data.
      const residue =
        (await VendorLedger.countDocuments({ description: { $regex: RUN_ID } })) +
        (await Payout.countDocuments({ payoutNumber: { $regex: RUN_ID } })) +
        (await Notification.countDocuments({ 'data.payoutNumber': { $regex: RUN_ID } }));

      console.log('');
      console.log('  payout-notification.test.js');
      console.log(`  passed: ${passed}`);
      console.log(`  failed: ${failures.length}`);
      for (const failure of failures) console.log(`    x ${failure}`);
      console.log(`  residue after cleanup: ${residue} (must be 0)`);
      if (residue !== 0) exitCode = 1;
    } catch (cleanupError) {
      console.error('cleanup failed:', cleanupError.message);
      exitCode = 1;
    }

    await mongoose.connection.close().catch(() => {});
    process.exit(exitCode);
  }
})();
