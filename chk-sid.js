const jwt = require("jsonwebtoken");
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh";

const AuthService = require("./src/services/auth.service");

(async () => {
  const user = { _id: "507f1f77bcf86cd799439011", email: "v@rentease.com", role: "vendor" };

  const a = await AuthService.generateAuthTokens(user);
  const b = await AuthService.generateAuthTokens(user);

  const aAccess = jwt.decode(a.accessToken);
  const aRefresh = jwt.decode(a.refreshToken);
  const bAccess = jwt.decode(b.accessToken);

  console.log("access has sid       :", Boolean(aAccess.sid));
  console.log("refresh has sid      :", Boolean(aRefresh.sid));
  console.log("sid matches across   :", aAccess.sid === aRefresh.sid);
  console.log("sid unique per login :", aAccess.sid !== bAccess.sid);
  console.log("legacy claims intact :", aAccess.id === user._id && aAccess.role === "vendor" && aRefresh.id === user._id);
  console.log("sid format           :", /^[0-9a-f-]{16,}$/i.test(aAccess.sid));

  // The old (broken) id derivation for comparison
  console.log("\nOLD id derivation (access 1):", a.accessToken.slice(0, 10));
  console.log("OLD id derivation (access 2):", b.accessToken.slice(0, 10));
  console.log("-> identical? ", a.accessToken.slice(0, 10) === b.accessToken.slice(0, 10));
  console.log("NEW id (access 1):", aAccess.sid.slice(0, 12));
  console.log("NEW id (access 2):", bAccess.sid.slice(0, 12));
  process.exit(0);
})();
