/**
 * tests/gateway-credentials.test.js
 *
 * Proves the admin settings are now the first source of gateway credentials.
 *
 * Before this change every reader used `process.env` directly, so a Key Id or Key
 * Secret typed into the settings screen was saved, masked, and then ignored — the
 * gateway client and every payment signature kept using the env value.
 *
 * Covered:
 *   1. empty settings fall through to the env (no behaviour change for a `.env`-only
 *      install),
 *   2. stored secrets win, and are stored ENCRYPTED (the raw document must not
 *      contain the literal),
 *   3. a payment signature computed with the STORED secret verifies while one
 *      computed with the env secret does not — i.e. the stored key is genuinely in
 *      use, not just reported,
 *   4. the cached client is rebuilt when the credentials change.
 *
 * SAFETY: writes to the live settings document, so the original razorpay/stripe
 * config is snapshotted and restored in `finally`, then re-verified.
 */
require('dotenv').config();
require('dns').setServers(['1.1.1.1', '8.8.8.8']);
const crypto = require('crypto');
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const SystemSettings = require('../src/models/SystemSettings.model');
const paymentService = require('../src/services/payment.service');
const encryption = require('../src/utils/encryption');

const SENTINEL_ID = 'rzp_test_SENTINELKEYID';
const SENTINEL_SECRET = 'SENTINEL_KEY_SECRET_do_not_use';
const SENTINEL_WEBHOOK = 'SENTINEL_WEBHOOK_SECRET';

const SECRET_FIELDS = ['keyId', 'keySecret', 'webhookSecret', 'enabled'];

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

const pick = (obj) => {
  const out = {};
  for (const f of SECRET_FIELDS) out[f] = obj?.[f];
  return out;
};

(async () => {
  await connectDB();

  const settings = await SystemSettings.getInstance();
  const snapshot = {
    razorpay: pick(settings.payment?.razorpay),
    stripe: pick(settings.payment?.stripe),
  };
  console.log(`original razorpay config: ${JSON.stringify(snapshot.razorpay)}`);

  try {
    // ── 1. empty settings => env fallback ────────────────────────────────────
    console.log('');
    console.log('1. empty settings fall through to the environment');
    settings.payment.razorpay = { keyId: '', keySecret: '', webhookSecret: '', enabled: false };
    settings.markModified('payment');
    await settings.save();

    const envCreds = await paymentService.getGatewayCredentials('razorpay');
    ok('key id falls back to env', envCreds.keyId === process.env.RAZORPAY_KEY_ID);
    ok('key secret falls back to env', envCreds.keySecret === process.env.RAZORPAY_KEY_SECRET);
    ok('source is reported as env', envCreds.source.keySecret === 'env');
    ok(
      'getWebhookSecret delegates to the same resolver',
      (await paymentService.getWebhookSecret('razorpay')) === process.env.RAZORPAY_WEBHOOK_SECRET,
    );

    // ── 2. stored secrets win and are encrypted at rest ──────────────────────
    console.log('');
    console.log('2. stored secrets win, encrypted at rest');
    settings.payment.razorpay = {
      keyId: SENTINEL_ID,
      keySecret: encryption.encryptToString(SENTINEL_SECRET),
      webhookSecret: encryption.encryptToString(SENTINEL_WEBHOOK),
      enabled: false,
    };
    settings.markModified('payment');
    await settings.save();

    const raw = await SystemSettings.collection.findOne({});
    const storedSecret = raw.payment.razorpay.keySecret;
    ok(
      'the stored key secret is an encrypted envelope',
      /^\s*\{\s*"encrypted"\s*:/.test(String(storedSecret)),
      String(storedSecret).slice(0, 14),
    );
    ok('the raw document does not contain the literal key secret', !JSON.stringify(raw).includes(SENTINEL_SECRET));
    ok('the raw document does not contain the literal webhook secret', !JSON.stringify(raw).includes(SENTINEL_WEBHOOK));

    const dbCreds = await paymentService.getGatewayCredentials('razorpay');
    ok('the resolver decrypts the stored key secret', dbCreds.keySecret === SENTINEL_SECRET);
    ok('the resolver prefers the stored key id', dbCreds.keyId === SENTINEL_ID);
    ok('source is reported as settings', dbCreds.source.keySecret === 'settings');
    ok('the webhook secret is decrypted as well', (await paymentService.getWebhookSecret('razorpay')) === SENTINEL_WEBHOOK);

    // ── 3. the stored secret is genuinely what signs a payment ───────────────
    console.log('');
    console.log('3. the stored secret signs payments');
    const orderId = 'order_SENTINEL';
    const paymentId = 'pay_SENTINEL';
    const body = `${orderId}|${paymentId}`;
    const signWith = (secret) => crypto.createHmac('sha256', secret).update(body).digest('hex');

    ok(
      'a signature made with the STORED secret verifies',
      (await paymentService.verifyRazorpayPayment(orderId, paymentId, signWith(SENTINEL_SECRET))) === true,
    );
    ok(
      'a signature made with the ENV secret does NOT verify (settings win)',
      (await paymentService.verifyRazorpayPayment(orderId, paymentId, signWith(process.env.RAZORPAY_KEY_SECRET))) === false,
    );
    ok(
      'a garbage signature does not verify',
      (await paymentService.verifyRazorpayPayment(orderId, paymentId, 'deadbeef')) === false,
    );

    // ── 4. the cached client follows the credentials ─────────────────────────
    console.log('');
    console.log('4. the cached client follows the credentials');
    const first = await paymentService.getRazorpayClient();
    ok('a client is built from the stored credentials', Boolean(first));
    ok('it is cached for the same credentials', (await paymentService.getRazorpayClient()) === first);

    settings.payment.razorpay = { ...settings.payment.razorpay, keyId: 'rzp_test_ROTATED' };
    settings.markModified('payment');
    await settings.save();

    const rotated = await paymentService.getRazorpayClient();
    ok('the client is rebuilt when the credentials change', rotated !== first);
    ok(
      'the cache fingerprint follows the rotated key id',
      paymentService._gatewayClientKeys.razorpay === `rzp_test_ROTATED:${SENTINEL_SECRET}`,
      paymentService._gatewayClientKeys.razorpay,
    );
  } finally {
    const restore = await SystemSettings.getInstance();
    restore.payment.razorpay = { ...(restore.payment?.razorpay || {}), ...snapshot.razorpay };
    restore.payment.stripe = { ...(restore.payment?.stripe || {}), ...snapshot.stripe };
    restore.markModified('payment');
    await restore.save();
  }

  // ── restore verified ───────────────────────────────────────────────────────
  console.log('');
  const after = await SystemSettings.getInstance();
  ok('razorpay settings restored to the snapshot', JSON.stringify(pick(after.payment?.razorpay)) === JSON.stringify(snapshot.razorpay), pick(after.payment?.razorpay));
  ok('stripe settings restored to the snapshot', JSON.stringify(pick(after.payment?.stripe)) === JSON.stringify(snapshot.stripe), pick(after.payment?.stripe));
  ok(
    'the env fallback works again after restore',
    (await paymentService.getGatewayCredentials('razorpay')).source.keySecret === 'env',
  );

  console.log('');
  console.log(`  passed: ${passed}`);
  console.log(`  failed: ${failures.length}${failures.length ? `  -> ${failures.join(' | ')}` : ''}`);

  await mongoose.connection.close();
  process.exitCode = failures.length ? 1 : 0;
})();
