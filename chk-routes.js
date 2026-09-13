process.env.NODE_ENV = process.env.NODE_ENV || "test";
function dump(label, p) {
  try {
    const r = require(p);
    console.log("\n=== " + label + " ===");
    r.stack.forEach(l => {
      if (l.route) {
        const m = Object.keys(l.route.methods).join(",").toUpperCase();
        console.log("  " + m.padEnd(7) + " " + l.route.path + "   [" + l.route.stack.map(s => s.name).join(" > ") + "]");
      } else {
        console.log("  [mw] " + l.name);
      }
    });
  } catch (e) {
    console.error("\n!!! LOAD FAIL " + label + ": " + e.message);
    console.error(e.stack.split("\n").slice(0, 6).join("\n"));
  }
}
dump("vendor.routes", "./src/api/routes/v1/vendor.routes");
dump("admin-vendor.routes", "./src/api/routes/v1/admin-vendor.routes");
dump("product.routes", "./src/api/routes/v1/product.routes");
process.exit(0);
