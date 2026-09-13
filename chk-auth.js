// Load routers to confirm the limiter swap and no import errors
const authRoutes = require("./src/api/routes/v1/auth.routes");
const refreshRoute = authRoutes.stack.find(l => l.route && l.route.path === "/refresh-token");
const loginRoute = authRoutes.stack.find(l => l.route && l.route.path === "/login");
const nameOf = (layer) => layer.route.stack[0].name;
console.log("refresh-token first middleware:", nameOf(refreshRoute));
console.log("login first middleware        :", nameOf(loginRoute));
const rl = require("./src/api/middlewares/rateLimiter.middleware");
console.log("refreshLimiter exported       :", typeof rl.refreshLimiter === "function");
console.log("authLimiter still exported    :", typeof rl.authLimiter === "function");
const svc = require("./src/services/auth.service");
console.log("resolveRotatedToken present   :", typeof svc.resolveRotatedToken === "function");
const { User } = require("./src/models");
const sec = User.schema.path("security");
console.log("lastFailedLoginAt in schema   :", Boolean(sec.schema.path("lastFailedLoginAt")));
