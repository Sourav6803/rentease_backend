#!/usr/bin/env node
/**
 * Google Sign-In configuration check.
 *
 *   npm run check:google
 *
 * WHY: Google rejects the token exchange unless the redirect_uri is
 * byte-for-byte identical in THREE places. A single character out of place
 * fails with `redirect_uri_mismatch`, which is a famously opaque error. This
 * script derives the real callback route from the source code and compares all
 * three values, so a mismatch is caught here instead of in production.
 *
 * Reads files only — needs no MongoDB, no Redis, no network.
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..');
const FRONTEND = path.join(BACKEND, '..', 'frontend');

const PLACEHOLDERS = /^(x{6,}|your[-_]|changeme|todo|<.*>|\.\.\.)/i;

const results = [];
let failed = 0;

const check = (name, fn) => {
  try {
    results.push({ ok: true, name, detail: fn() || '' });
  } catch (error) {
    failed += 1;
    results.push({ ok: false, name, detail: error.message });
  }
};

const note = (name, detail) => results.push({ ok: true, info: true, name, detail });

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** Minimal .env reader — avoids loading config/env.js (which validates everything). */
const parseEnv = (file) => {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) out[key] = value;
  }
  return out;
};

const backendEnv = parseEnv(path.join(BACKEND, '.env'));
const frontendEnv = {
  ...parseEnv(path.join(FRONTEND, '.env')),
  ...parseEnv(path.join(FRONTEND, '.env.local')),
};

// ── Derive the real callback path from the source of truth ──────────────────
const deriveRoute = () => {
  const appJs = fs.readFileSync(path.join(BACKEND, 'src', 'app.js'), 'utf8');
  const mount = appJs.match(/app\.use\(\s*['"](\/api\/v1)['"]/);
  assert(mount, "app.js does not mount routes at '/api/v1'");
  const base = mount[1];

  const v1 = fs.readFileSync(path.join(BACKEND, 'src', 'api', 'routes', 'v1', 'index.js'), 'utf8');
  const prefix = v1.match(/router\.use\(\s*['"](\/auth)['"]/);
  assert(prefix, "routes/v1/index.js does not mount authRoutes at '/auth'");

  const authRoutes = fs.readFileSync(
    path.join(BACKEND, 'src', 'api', 'routes', 'v1', 'auth.routes.js'),
    'utf8'
  );
  assert(
    /router\.get\(\s*['"]\/google['"]/.test(authRoutes),
    "auth.routes.js has no GET '/google' route"
  );
  assert(
    /router\.(get|post)\(\s*['"]\/google\/callback['"]/.test(authRoutes) === false,
    "auth.routes.js now HAS a '/google/callback' route — update this script"
  );

  return `${base}${prefix[1]}/google`;
};

let routePath = '/api/v1/auth/google';
check('the /auth/google callback route exists in source', () => {
  routePath = deriveRoute();
  return `derived: ${routePath}`;
});

// ── Backend credentials ────────────────────────────────────────────────────
check('backend GOOGLE_CLIENT_ID is set to a real client id', () => {
  const id = backendEnv.GOOGLE_CLIENT_ID;
  assert(id, 'GOOGLE_CLIENT_ID is missing from backend/.env');
  assert(
    !PLACEHOLDERS.test(id),
    `GOOGLE_CLIENT_ID is still a placeholder ("${id}") — create a real one in Google Cloud Console`
  );
  assert(
    id.endsWith('.apps.googleusercontent.com'),
    `GOOGLE_CLIENT_ID should end with .apps.googleusercontent.com (got "${id}")`
  );
  return `${id.slice(0, 12)}…${id.slice(-24)}`;
});

check('backend GOOGLE_CLIENT_SECRET is set to a real secret', () => {
  const secret = backendEnv.GOOGLE_CLIENT_SECRET;
  assert(secret, 'GOOGLE_CLIENT_SECRET is missing from backend/.env');
  assert(
    !PLACEHOLDERS.test(secret),
    'GOOGLE_CLIENT_SECRET is still a placeholder — create a real one in Google Cloud Console'
  );
  assert(secret.length >= 20, `GOOGLE_CLIENT_SECRET looks too short (${secret.length} chars)`);
  return `${secret.slice(0, 4)}… (${secret.length} chars)`;
});

// ── Backend callback URL ───────────────────────────────────────────────────
let callbackUrl = null;
check('backend GOOGLE_CALLBACK_URL points at the real route', () => {
  callbackUrl = backendEnv.GOOGLE_CALLBACK_URL;
  assert(callbackUrl, 'GOOGLE_CALLBACK_URL is missing from backend/.env');

  let parsed;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    throw new Error(`GOOGLE_CALLBACK_URL is not a valid URL: "${callbackUrl}"`);
  }

  assert(
    parsed.pathname === routePath,
    `path is "${parsed.pathname}" but the route is "${routePath}"` +
      (parsed.pathname.endsWith('/callback')
        ? ' (a "/callback" suffix does not exist — Google will return redirect_uri_mismatch)'
        : '')
  );
  assert(
    !parsed.search && !parsed.hash,
    'GOOGLE_CALLBACK_URL must have no query string or fragment'
  );
  return callbackUrl;
});

// ── Frontend mirror ────────────────────────────────────────────────────────
check('NEXT_PUBLIC_GOOGLE_CLIENT_ID is set and matches the backend', () => {
  const id = frontendEnv.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  assert(
    id,
    'NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set in frontend/.env.local — the ' +
      'Google button stays hidden until it is'
  );
  assert(!PLACEHOLDERS.test(id), `NEXT_PUBLIC_GOOGLE_CLIENT_ID is a placeholder ("${id}")`);
  if (backendEnv.GOOGLE_CLIENT_ID && !PLACEHOLDERS.test(backendEnv.GOOGLE_CLIENT_ID)) {
    assert(
      id === backendEnv.GOOGLE_CLIENT_ID,
      'NEXT_PUBLIC_GOOGLE_CLIENT_ID must be the SAME client id as the backend'
    );
  }
  return id;
});

check('NEXT_PUBLIC_GOOGLE_REDIRECT_URI matches the backend callback', () => {
  const uri = frontendEnv.NEXT_PUBLIC_GOOGLE_REDIRECT_URI;
  assert(
    uri,
    'NEXT_PUBLIC_GOOGLE_REDIRECT_URI is not set in frontend/.env.local — the ' +
      'Google button stays hidden until it is'
  );

  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`NEXT_PUBLIC_GOOGLE_REDIRECT_URI is not a valid URL: "${uri}"`);
  }
  assert(
    parsed.pathname === routePath,
    `path is "${parsed.pathname}" but the route is "${routePath}"`
  );

  if (backendEnv.GOOGLE_CALLBACK_URL) {
    assert(
      uri === backendEnv.GOOGLE_CALLBACK_URL,
      `the auth request sends "${uri}" but the token exchange sends ` +
        `"${backendEnv.GOOGLE_CALLBACK_URL}" — these MUST be identical or Google ` +
        `returns redirect_uri_mismatch`
    );
  }
  return uri;
});

// ── Local host sanity ──────────────────────────────────────────────────────
check('CLIENT_URL is set (the post-login redirect target)', () => {
  const clientUrl = backendEnv.CLIENT_URL;
  assert(clientUrl, 'CLIENT_URL is missing — the callback redirect would go nowhere');
  return clientUrl;
});

// ── Always-useful output ───────────────────────────────────────────────────
note('', '');
note(
  'REGISTER THIS EXACT URI IN GOOGLE CLOUD CONSOLE',
  callbackUrl || `http://localhost:5000${routePath}`
);
note(
  '  where:',
  'APIs & Services → Credentials → your OAuth 2.0 Client ID → Authorized redirect URIs'
);

// ── Report ─────────────────────────────────────────────────────────────────
const pad = Math.max(...results.map((r) => r.name.length));
console.log('\nGoogle Sign-In configuration\n' + '─'.repeat(pad + 46));

for (const r of results) {
  const mark = r.info ? '  ' : r.ok ? '✓ ' : '✗ ';
  console.log(`${mark}${r.name.padEnd(pad)}  ${r.detail}`);
}

console.log('─'.repeat(pad + 46));

if (failed === 0) {
  console.log('\n✅ Configuration is consistent — Google sign-in is ready.\n');
} else {
  console.log(
    `\n❌ ${failed} problem(s). Google sign-in will fail with ` +
      `\`redirect_uri_mismatch\` until these are fixed.\n`
  );
}

process.exit(failed === 0 ? 0 : 1);
