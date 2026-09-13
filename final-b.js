const mods = [
  "./src/api/routes/v1/index",
  "./src/api/routes/v1/vendor-security.routes",
  "./src/api/middlewares/vendorApiKey.middleware",
  "./src/services/auth.service",
  "./src/services/settings.service",
  "./src/services/vendor-security.service",
  "./src/models/index",
  "./src/api/controllers/auth.controller"
];
let bad = 0;
mods.forEach(m => { try { require(m); console.log("LOAD OK   " + m); } catch (e) { bad++; console.log("LOAD FAIL " + m + " :: " + e.message); } });
const mw = require("./src/api/middlewares/vendorApiKey.middleware");
console.log("apiKey mw exported:", typeof mw.authenticateVendorApiKey === "function");
console.log("methods map:", JSON.stringify(mw.REQUIRED_PERMISSION_BY_METHOD));
console.log("load failures: " + bad);
process.exit(bad ? 1 : 0);
