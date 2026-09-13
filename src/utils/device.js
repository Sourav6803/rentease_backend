/**
 * utils/device.js
 *
 * Lightweight user-agent parsing and client-IP resolution used by the security
 * centre (login history, active sessions, security logs).
 *
 * Deliberately dependency-free: the browser / OS matrix the vendor security UI
 * renders is small, so pattern matching covers it without pulling in
 * `ua-parser-js` or a GeoIP database. Location is intentionally left to the
 * caller — we do not fabricate a city we cannot actually resolve.
 */

const UNKNOWN = 'Unknown';

/**
 * Parse a User-Agent string into a human readable device/browser/OS triple.
 *
 * @param {string} userAgent
 * @returns {{ device: string, browser: string, os: string, deviceType: 'desktop'|'mobile'|'tablet' }}
 */
function parseUserAgent(userAgent) {
  const ua = String(userAgent || '').trim();

  if (!ua) {
    return { device: UNKNOWN, browser: UNKNOWN, os: UNKNOWN, deviceType: 'desktop' };
  }

  const os = detectOs(ua);
  const browser = detectBrowser(ua);
  const deviceType = detectDeviceType(ua);

  const device =
    browser === UNKNOWN && os === UNKNOWN
      ? ua.slice(0, 60)
      : `${browser} on ${os}`;

  return { device, browser, os, deviceType };
}

function detectOs(ua) {
  if (/Windows NT 10\.0/i.test(ua)) return 'Windows 10/11';
  if (/Windows NT/i.test(ua)) return 'Windows';
  if (/Android/i.test(ua)) {
    const match = ua.match(/Android\s([\d.]+)/i);
    return match ? `Android ${match[1]}` : 'Android';
  }
  if (/(iPhone|iPod)/i.test(ua)) return 'iOS';
  if (/iPad/i.test(ua)) return 'iPadOS';
  if (/Mac OS X/i.test(ua)) return 'macOS';
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return UNKNOWN;
}

function detectBrowser(ua) {
  // Order matters: most engines embed the signatures of the ones below them.
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\/|Opera/i.test(ua)) return 'Opera';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
  if (/Firefox\//i.test(ua) || /FxiOS/i.test(ua)) return 'Firefox';
  if (/CriOS/i.test(ua)) return 'Chrome';
  if (/Chrome\//i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua) && /Version\//i.test(ua)) return 'Safari';
  if (/PostmanRuntime/i.test(ua)) return 'Postman';
  if (/curl\//i.test(ua)) return 'curl';
  if (/node-fetch|axios|okhttp|python-requests/i.test(ua)) return 'API Client';
  return UNKNOWN;
}

function detectDeviceType(ua) {
  if (/(iPad|Tablet|Nexus 7|Nexus 10|SM-T)/i.test(ua)) return 'tablet';
  if (/(Mobile|iPhone|iPod|Android.*Mobile|Windows Phone)/i.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * Resolve the caller's IP, honouring the proxy headers the app is deployed
 * behind. Express already exposes `req.ip`; we prefer that and fall back to the
 * raw socket so the value is never undefined.
 */
function getClientIp(req) {
  if (!req) return UNKNOWN;

  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }

  return (
    req.ip ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    UNKNOWN
  );
}

/**
 * Short helper for log rows that only need a device label.
 */
function describeDevice(userAgent) {
  return parseUserAgent(userAgent).device;
}

module.exports = {
  UNKNOWN,
  parseUserAgent,
  getClientIp,
  describeDevice,
};
