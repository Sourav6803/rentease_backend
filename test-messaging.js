/**
 * backend/test-messaging.js
 *
 * Standalone Twilio credential + messaging tester (NOT part of src/).
 * Verifies the API keys in backend/.env actually work, then lets you send
 * a test SMS and/or WhatsApp message to a number you type in.
 *
 * Run from the backend folder:
 *   node test-messaging.js
 *
 * Notes on the .env values:
 *  - Account SIDs start with "AC". If TWILIO_ACCOUNT_SID is not an AC value,
 *    this script falls back to SENDGRID_ACC_SID / SENDGRID_AUTH_TOKEN, which
 *    in this .env actually hold Twilio-style credentials.
 *  - "HX..." values are WhatsApp Content Template SIDs.
 *  - "MG..." values are Messaging Service SIDs.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const readline = require('readline');
const twilio = require('twilio');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

function resolveCredentials() {
  const candidates = [
    {
      source: 'TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN',
      sid: process.env.TWILIO_ACCOUNT_SID,
      token: process.env.TWILIO_AUTH_TOKEN,
    },
    {
      source: 'SENDGRID_ACC_SID + SENDGRID_AUTH_TOKEN (mislabeled Twilio creds)',
      sid: process.env.SENDGRID_ACC_SID,
      token: process.env.SENDGRID_AUTH_TOKEN,
    },
  ];

  for (const c of candidates) {
    if (c.sid && c.sid.startsWith('AC') && c.token && c.token.length >= 32) {
      return c;
    }
    console.log(`⚠ Skipping ${c.source}: SID "${(c.sid || '').slice(0, 6)}..." is not a valid Account SID (must start with "AC")`);
  }
  return null;
}

function normalizeNumber(raw) {
  const cleaned = raw.replace(/[\s-]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (/^\d{10}$/.test(cleaned)) return `+91${cleaned}`; // assume India for 10-digit input
  return `+${cleaned}`;
}

function logTwilioError(err) {
  console.log('  ✗ FAILED');
  console.log(`    Code:    ${err.code ?? 'n/a'}`);
  console.log(`    Message: ${err.message}`);
  if (err.moreInfo) console.log(`    Info:    ${err.moreInfo}`);
  const hints = {
    20003: 'Authentication failed — the SID/token pair is wrong or revoked.',
    21211: 'The "to" number is invalid. Include country code, e.g. +91XXXXXXXXXX.',
    21212: 'The "from" number is invalid or not owned by this account.',
    21606: 'The "from" number is not a valid, SMS-capable Twilio number on this account.',
    21608: 'Trial account: the "to" number must first be verified in the Twilio console.',
    21910: 'Invalid from/to channel pair (e.g. mixing whatsapp: and sms).',
    63007: 'The WhatsApp "from" number is not enabled for WhatsApp on this account.',
    63016: 'Outside the 24h session window — a plain WhatsApp message needs an approved template (use option 3).',
  };
  if (err.code && hints[err.code]) console.log(`    Hint:    ${hints[err.code]}`);
}

async function validateCredentials(client, sid) {
  console.log('\n── Step 1: Validating credentials against Twilio API ──');
  try {
    const account = await client.api.v2010.accounts(sid).fetch();
    console.log(`  ✓ Credentials are VALID`);
    console.log(`    Account name:   ${account.friendlyName}`);
    console.log(`    Account status: ${account.status}`);
    console.log(`    Account type:   ${account.type}`); // "Trial" or "Full"
    if (account.type === 'Trial') {
      console.log('    ⚠ TRIAL account: you can only send to numbers verified in the Twilio console.');
    }
    return true;
  } catch (err) {
    logTwilioError(err);
    return false;
  }
}

async function sendSms(client, to) {
  console.log('\n── Sending SMS ──');
  const from = process.env.TWILIO_PHONE_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MSG_SERVICE_SID;
  const body = `RentEase test SMS ✔ sent at ${new Date().toLocaleString()}`;

  // Prefer the Messaging Service if configured; fall back to the from-number.
  const attempts = [];
  if (messagingServiceSid && messagingServiceSid.startsWith('MG')) {
    attempts.push({ label: `Messaging Service ${messagingServiceSid.slice(0, 8)}...`, params: { to, body, messagingServiceSid } });
  }
  if (from) {
    attempts.push({ label: `From number ${from}`, params: { to, body, from } });
  }
  if (attempts.length === 0) {
    console.log('  ✗ No TWILIO_MSG_SERVICE_SID or TWILIO_PHONE_NUMBER configured.');
    return;
  }

  for (const attempt of attempts) {
    console.log(`  Trying via: ${attempt.label}`);
    try {
      const msg = await client.messages.create(attempt.params);
      console.log('  ✓ SMS accepted by Twilio');
      console.log(`    Message SID: ${msg.sid}`);
      console.log(`    Status:      ${msg.status} (check delivery in Twilio console → Monitor → Logs)`);
      return;
    } catch (err) {
      logTwilioError(err);
    }
  }
}

async function sendWhatsApp(client, to, useTemplate) {
  console.log(`\n── Sending WhatsApp ${useTemplate ? '(template)' : '(plain text)'} ──`);
  const from = process.env.TWILIO_WHATSAPP_NUMBER; // already "whatsapp:+91..."
  if (!from) {
    console.log('  ✗ TWILIO_WHATSAPP_NUMBER is not configured.');
    return;
  }

  const params = {
    from: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
    to: `whatsapp:${to}`,
  };

  if (useTemplate) {
    const contentSid = process.env.TWILIO_MSG_CONTENT_SID2 || process.env.TWILIO_MSG_CONTENT_SID;
    if (!contentSid || !contentSid.startsWith('HX')) {
      console.log('  ✗ No valid HX... content template SID configured.');
      return;
    }
    params.contentSid = contentSid;
    // If your template has variables ({{1}}, {{2}}...), fill them here:
    params.contentVariables = JSON.stringify({ 1: 'RentEase test' });
    console.log(`  Using template: ${contentSid.slice(0, 8)}...`);
  } else {
    params.body = `RentEase test WhatsApp message ✔ sent at ${new Date().toLocaleString()}`;
  }

  try {
    const msg = await client.messages.create(params);
    console.log('  ✓ WhatsApp message accepted by Twilio');
    console.log(`    Message SID: ${msg.sid}`);
    console.log(`    Status:      ${msg.status} (check delivery in Twilio console → Monitor → Logs)`);
  } catch (err) {
    logTwilioError(err);
    if (!useTemplate) {
      console.log('    Tip: plain WhatsApp texts only work inside a 24h user-initiated session.');
      console.log('         Re-run and choose the template option, or (for sandbox) send the join code first.');
    }
  }
}

async function main() {
  console.log('══════════════════════════════════════════');
  console.log('  RentEase — Twilio SMS/WhatsApp key tester');
  console.log('══════════════════════════════════════════');

  const creds = resolveCredentials();
  if (!creds) {
    console.log('\n✗ No usable Account SID found in .env (nothing starts with "AC"). Cannot continue.');
    rl.close();
    process.exitCode = 1;
    return;
  }
  console.log(`\nUsing credentials from: ${creds.source}`);
  console.log(`Account SID: ${creds.sid.slice(0, 8)}...${creds.sid.slice(-4)}`);

  const client = twilio(creds.sid, creds.token);

  const valid = await validateCredentials(client, creds.sid);
  if (!valid) {
    console.log('\n✗ Credentials rejected by Twilio — fix the SID/token before testing messages.');
    rl.close();
    process.exitCode = 1;
    return;
  }

  const rawNumber = await ask('\nEnter the phone number to test (with country code, e.g. +919876543210): ');
  const to = normalizeNumber(rawNumber);
  console.log(`Normalized to: ${to}`);

  console.log('\nWhat do you want to test?');
  console.log('  1) SMS only');
  console.log('  2) WhatsApp (plain text) only');
  console.log('  3) WhatsApp (approved template via Content SID) only');
  console.log('  4) SMS + WhatsApp plain text');
  const choice = await ask('Choice [1-4]: ');

  if (choice === '1' || choice === '4') await sendSms(client, to);
  if (choice === '2' || choice === '4') await sendWhatsApp(client, to, false);
  if (choice === '3') await sendWhatsApp(client, to, true);

  console.log('\nDone. Final delivery status is visible in Twilio Console → Monitor → Logs → Messaging.');
  rl.close();
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  rl.close();
  process.exitCode = 1;
});
