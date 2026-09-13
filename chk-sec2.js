const dump = (label, p) => {
  try {
    const r = require(p);
    console.log("\n=== " + label + " ===");
    r.stack.forEach(l => {
      if (l.route) {
        const m = Object.keys(l.route.methods).join(",").toUpperCase();
        console.log("  " + m.padEnd(7) + " " + l.route.path);
      } else {
        console.log("  [mw] " + l.name);
      }
    });
  } catch (e) {
    console.log("\n!!! LOAD FAIL " + label + " :: " + e.message);
  }
};
dump("vendor-security.routes", "./src/api/routes/v1/vendor-security.routes");
try {
  const idx = require("./src/api/routes/v1/index");
  const mounts = idx.stack.filter(l => !l.route).map(l => l.regexp ? String(l.regexp) : l.name);
  console.log("\n=== /api/v1 mount order (first 40) ===");
  mounts.slice(0, 40).forEach((m, i) => console.log("  " + i + ": " + m));
} catch (e) {
  console.log("INDEX LOAD FAIL :: " + e.message);
}
try { require("./src/services/auth.service"); console.log("\nauth.service LOAD OK (no circular import)"); }
catch (e) { console.log("\nauth.service LOAD FAIL :: " + e.message); }
process.exit(0);
