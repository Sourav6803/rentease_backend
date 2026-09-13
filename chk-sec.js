const totp = require("./src/utils/totp");
const device = require("./src/utils/device");
const models = require("./src/models");

// --- TOTP round trip against the RFC 6238 test vector (SHA1, 8 digits) ---
// RFC 6238 Appendix B uses the ASCII secret "12345678901234567890".
const b32 = totp.base32Encode(Buffer.from("12345678901234567890", "ascii"));
const cases = [
  [59,          "94287082"],
  [1111111109,  "07081804"],
  [1111111111,  "14050471"],
  [1234567890,  "89005924"],
  [2000000000,  "69279037"],
  [20000000000, "65353130"],
];
let rfcPass = 0;
for (const [ts, expected] of cases) {
  const got = totp.hotp(b32, Math.floor(ts / 30), 8);
  const ok = got === expected;
  if (ok) rfcPass++;
  console.log(`RFC6238 t=${ts} expected=${expected} got=${got} ${ok ? "PASS" : "FAIL"}`);
}
console.log(`RFC6238 vectors: ${rfcPass}/${cases.length}`);

// --- verify + base32 round trip ---
const secret = totp.generateSecret();
const code = totp.generateTOTP(secret);
console.log("generated secret len:", secret.length, "code:", code, "verify:", totp.verifyTOTP(code, secret));
console.log("wrong code verify:", totp.verifyTOTP("000000", secret) === false ? false : totp.verifyTOTP("000000", secret));
console.log("base32 roundtrip:", totp.base32Decode(totp.base32Encode(Buffer.from("hello world"))).toString());
console.log("recovery codes:", totp.generateRecoveryCodes(3).join(", "));
console.log("otpauth:", totp.buildOtpAuthUrl({ secret, accountName: "vendor@rentease.com" }));

// --- device parsing ---
const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
console.log("ua:", JSON.stringify(device.parseUserAgent(ua)));
console.log("ua empty:", JSON.stringify(device.parseUserAgent("")));

// --- model registration ---
console.log("VendorApiKey registered:", !!models.VendorApiKey, "SecurityEvent registered:", !!models.SecurityEvent);
const plain = models.VendorApiKey.generatePlaintext("live");
console.log("plaintext key:", plain, "prefix:", models.VendorApiKey.buildPrefix(plain), "masked:", models.VendorApiKey.maskKey(plain));
console.log("hash len:", models.VendorApiKey.hashKey(plain).length);
const codesPath = models.User.schema.path("security.twoFactorRecoveryCodes");
console.log("recovery codes select:", codesPath && codesPath.options ? codesPath.options.select : "n/a");
process.exit(0);
