const mods = [
  "./src/api/routes/v1/vendor.routes",
  "./src/api/routes/v1/admin-vendor.routes",
  "./src/api/routes/v1/product.routes",
  "./src/api/routes/v1/payment.routes",
  "./src/models/index"
];
let bad = 0;
mods.forEach(m => {
  try { require(m); console.log("LOAD OK   " + m); }
  catch (e) { bad++; console.log("LOAD FAIL " + m + " :: " + e.message); }
});
console.log("load failures: " + bad);
process.exit(bad ? 1 : 0);
