const svc = require("./src/services/vendor-security.service");
const { VendorApiKey } = require("./src/models");

// pure helper tests (no DB required)
console.log("computeKeyExpiry(never)     :", svc.computeKeyExpiry("never"));
console.log("computeKeyExpiry(30) days   :", svc.computeKeyExpiry("30") instanceof Date);
try { svc.computeKeyExpiry("abc"); console.log("computeKeyExpiry(abc)       : NO THROW (bad)"); }
catch (e) { console.log("computeKeyExpiry(abc)       : throws ->", e.message); }

console.log("permissions default         :", JSON.stringify(svc.normalisePermissions([])));
console.log("permissions filtered        :", JSON.stringify(svc.normalisePermissions(["read","bogus","write"])));
try { svc.normalisePermissions(["nope"]); console.log("permissions invalid         : NO THROW (bad)"); }
catch (e) { console.log("permissions invalid         : throws ->", e.message); }

console.log("allowedIPs csv              :", JSON.stringify(svc.normaliseAllowedIPs("10.0.0.1, 192.168.1.0/24")));
try { svc.normaliseAllowedIPs(["not-an-ip"]); console.log("allowedIPs invalid          : NO THROW (bad)"); }
catch (e) { console.log("allowedIPs invalid          : throws ->", e.message); }

// query builders
const q1 = svc.buildSecurityLogQuery("507f1f77bcf86cd799439011", { type: "2fa_enabled,2fa_disabled" });
console.log("log query (type group)      :", JSON.stringify(q1.type));
const q2 = svc.buildSecurityLogQuery("507f1f77bcf86cd799439011", { type: "all", severity: "critical", search: "a+b", startDate: "2026-01-01", endDate: "2026-01-31" });
console.log("log query severity          :", q2.severity, "| date range:", !!q2.timestamp, "| search uses $or:", !!q2.$or);
console.log("regex escaped               :", q2.$or[0].action.source);

// service surface
const expected = ["getOverview","getActivity","getSessions","revokeSession","revokeAllSessions","getLoginActivity",
 "getSecurityLogs","exportSecurityLogs","beginTwoFactorSetup","verifyTwoFactorSetup","disableTwoFactor",
 "getRecoveryCodesStatus","regenerateRecoveryCodes","verifySecondFactor","requireSecondFactor",
 "recordLoginHistory","recordEvent","resolveVendorId","updatePreferences","listTrustedDevices",
 "revokeTrustedDevice","listApiKeys","getApiKeyStats","createApiKey","revokeApiKey","regenerateApiKey","findOwnedApiKey"];
const missing = expected.filter(m => typeof svc[m] !== "function");
console.log("service methods             :", (expected.length - missing.length) + "/" + expected.length, missing.length ? "MISSING: " + missing.join(",") : "all present");

// API key lifecycle crypto
const plain = VendorApiKey.generatePlaintext("test");
console.log("test key prefix env         :", plain.startsWith("rk_test_"));
console.log("mask hides middle           :", VendorApiKey.maskKey(plain).includes("********"));
process.exit(0);
