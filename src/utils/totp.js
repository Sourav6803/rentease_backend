/**
 * utils/totp.js
 *
 * Minimal, dependency-free implementation of:
 *   - RFC 4648 base32         (secret encoding used by authenticator apps)
 *   - RFC 4226 HOTP           (HMAC-based one-time password)
 *   - RFC 6238 TOTP           (time-based one-time password, 30s step / 6 digits)
 *
 * This is used by the vendor security module for real two-factor
 * authentication. It relies only on Node's built-in `crypto`, so no new
 * package had to be added to the backend.
 *
 * Compatibility note: Google Authenticator, Microsoft Authenticator and Authy
 * all accept the `otpauth://totp/...` URI produced by `buildOtpAuthUrl()`.
 */

const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD = 30; // seconds
const DEFAULT_WINDOW = 1; // accept +/- 1 time step (clock skew tolerance)

/**
 * Encode a Buffer as an unpadded RFC 4648 base32 string.
 */
function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decode a base32 string (case-insensitive, spaces and padding tolerated).
 */
function base32Decode(input) {
  const clean = String(input || '')
    .toUpperCase()
    .replace(/[\s=]/g, '');

  if (!clean) {
    throw new Error('Cannot decode an empty base32 secret');
  }

  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generate a new random base32 secret (160 bits by default, the RFC 4226
 * recommended minimum for HMAC-SHA1).
 */
function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

/**
 * RFC 4226 HOTP: HMAC-SHA1 of the 8-byte big-endian counter, dynamically
 * truncated to `digits` decimal characters.
 */
function hotp(secret, counter, digits = DEFAULT_DIGITS) {
  const key = Buffer.isBuffer(secret) ? secret : base32Decode(secret);

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();

  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const code = binary % 10 ** digits;
  return String(code).padStart(digits, '0');
}

/**
 * RFC 6238 TOTP for a given moment in time.
 */
function generateTOTP(
  secret,
  { digits = DEFAULT_DIGITS, period = DEFAULT_PERIOD, timestamp = Date.now() } = {},
) {
  const counter = Math.floor(timestamp / 1000 / period);
  return hotp(secret, counter, digits);
}

/**
 * Constant-time comparison of two same-length numeric strings.
 */
function safeCompare(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Verify a user-supplied TOTP token against the secret.
 * Accepts the current, previous and next time step to tolerate clock skew.
 */
function verifyTOTP(
  token,
  secret,
  { digits = DEFAULT_DIGITS, period = DEFAULT_PERIOD, window = DEFAULT_WINDOW } = {},
) {
  try {
    const normalised = String(token || '').replace(/\D/g, '');

    if (normalised.length !== digits) {
      return false;
    }

    const counter = Math.floor(Date.now() / 1000 / period);

    for (let offset = -window; offset <= window; offset += 1) {
      const candidate = hotp(secret, counter + offset, digits);
      if (safeCompare(candidate, normalised)) {
        return true;
      }
    }

    return false;
  } catch {
    // An unreadable secret must never authenticate anybody.
    return false;
  }
}

/**
 * Build the otpauth:// URI that authenticator apps consume.
 */
function buildOtpAuthUrl({ secret, accountName, issuer = 'RentEase' }) {
  const label = encodeURIComponent(`${issuer}:${accountName || 'account'}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DEFAULT_DIGITS),
    period: String(DEFAULT_PERIOD),
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Generate human-friendly recovery codes (e.g. "8F3A2-91BD4").
 * These are returned to the user exactly once; only bcrypt hashes are stored.
 */
function generateRecoveryCodes(count = 8) {
  const codes = [];

  for (let i = 0; i < count; i += 1) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }

  return codes;
}

module.exports = {
  BASE32_ALPHABET,
  base32Encode,
  base32Decode,
  generateSecret,
  hotp,
  generateTOTP,
  verifyTOTP,
  buildOtpAuthUrl,
  generateRecoveryCodes,
};
