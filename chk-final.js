(async () => {
  const svc = require('D:/RentEase/backend/src/services/auth.service');
  console.log('redisClient present      :', Boolean(svc.redisClient));

  // Grace path must degrade safely when Redis is unavailable (no throw).
  const noRedis = await svc.resolveRotatedToken('some.token', { id: '507f1f77bcf86cd799439011' });
  console.log('grace returns null safely:', noRedis === null);

  // Grace path must not throw on a malformed decoded payload either.
  const bad = await svc.resolveRotatedToken('x', undefined);
  console.log('grace handles no decoded  :', bad === null);

  // Confirm no secret material is reachable through login()'s select list.
  const src = require('fs').readFileSync('D:/RentEase/backend/src/services/auth.service.js', 'utf8');
  console.log('selects twoFactorSecret  :', src.includes('+security.twoFactorSecret'));
  console.log('selects recovery codes   :', src.includes('+security.twoFactorRecoveryCodes'));
  console.log('old destructive spread   :', src.includes('user.security = {'));
  console.log('targeted set used        :', src.includes('user.set(\"security.loginAttempts\"'));
  console.log('successor grace write    :', src.includes('refresh-successor:'));
  console.log('successor grace read     :', src.includes('refresh-successor:\'));
})();
