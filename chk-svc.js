const svc = require("./src/services/admin-vendor.service");
const codes = ["VEN123456780001", "507f1f77bcf86cd799439011"];
codes.forEach(c => console.log(c.padEnd(26), "=>", JSON.stringify(svc._vendorQuery(c))));
const methods = ["getAllVendors","getPendingVendors","getVendorForReview","approveVendor","rejectVendor","suspendVendor","reinstateVendor","updateVendorCommission","getVendorDocuments","verifyVendorDocument","getVendorStats","_findVendor","_vendorQuery"];
console.log("\nmethods present:", methods.filter(m => typeof svc[m] === "function").length + "/" + methods.length, "->", methods.filter(m => typeof svc[m] !== "function").join(", ") || "all ok");

const vs = require("./src/services/vendor.service");
const vm = ["completeProfile","getVendorProfile","getVendorById","updateVendorProfile","getVendorDashboard","getVendorStats","getVendorProducts","getVendorRentals","getVendorAnalytics","getSubscriptionDetails","getPayoutHistory","getVendorReviews","replyToReview","checkVendorAvailability","approveVendor","rejectVendor","suspendVendor","reinstateVendor","_vendorOwner"];
console.log("vendor.service missing:", vm.filter(m => typeof vs[m] !== "function").join(", ") || "none");

const pc = require("./src/api/controllers/product.controller");
console.log("product.controller methods:", ["deleteProduct","updateStock","getProductAnalytics","getVendorProducts","bulkUpdateProducts"].filter(m => typeof pc[m] === "function").length + "/5");
process.exit(0);
