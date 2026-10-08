#!/usr/bin/env node
/**
 * Verification suite for the BullMQ consolidation + worker split.
 *
 *   npm run test:jobs        (or: node scripts/test-jobs.js)
 *
 * These are STATIC / STRUCTURAL checks plus config assertions — they need
 * neither MongoDB nor Redis, so they can run in CI. The one live check at the
 * end is skipped automatically when Redis is unreachable.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');

const SRC = path.join(__dirname, '..', 'src');

const results = [];
let failed = 0;

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const check = (name, fn) => {
  try {
    const detail = fn();
    results.push({ ok: true, name, detail: detail || '' });
  } catch (error) {
    failed += 1;
    results.push({ ok: false, name, detail: error.message });
  }
};

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(full, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
};

const allFiles = walk(SRC);
const read = (file) => fs.readFileSync(file, 'utf8');
const rel = (file) => path.relative(path.join(__dirname, '..'), file);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Every job module must load (catches missing/renamed modules)
// ─────────────────────────────────────────────────────────────────────────────
check('all src/jobs/*.js modules require() cleanly', () => {
  const jobsDir = path.join(SRC, 'jobs');
  const mods = fs
    .readdirSync(jobsDir)
    .filter((f) => f.endsWith('.js') && f !== 'index.js');

  const loaded = [];
  for (const m of mods) {
    const mod = require(path.join(jobsDir, m));
    assert(mod && typeof mod === 'object', `${m} did not export an object`);
    assert(typeof mod.process === 'function', `${m} does not export process()`);
    loaded.push(m.replace('.jobs.js', ''));
  }
  return `${loaded.length} processors: ${loaded.join(', ')}`;
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Every processor referenced by processJobByType must exist
// ─────────────────────────────────────────────────────────────────────────────
check('every required() processor module exists', () => {
  const src = read(path.join(SRC, 'jobs', 'index.js'));
  const refs = [...src.matchAll(/require\(['"]\.\/([\w.-]+)['"]\)/g)].map((m) => m[1]);
  const unique = [...new Set(refs)];
  assert(unique.length > 0, 'no processor requires found');

  const missing = unique.filter(
    (r) => !fs.existsSync(path.join(SRC, 'jobs', `${r}.js`))
  );
  assert(missing.length === 0, `missing modules: ${missing.join(', ')}`);
  return unique.join(', ');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Every logical queue used by a call site must be mapped
// ─────────────────────────────────────────────────────────────────────────────
const jobsIndex = require(path.join(SRC, 'jobs', 'index.js'));
const { QUEUE_GROUPS, physicalQueueConfig } = jobsIndex;

check('every addJob()/processJob() logical queue is mapped', () => {
  const used = new Set();

  for (const file of allFiles) {
    const src = read(file);

    for (const m of src.matchAll(/addJob\(\s*['"]([A-Za-z_-]+)['"]/g)) used.add(m[1]);
    // processJob('email:send', ...) — the queue is the part before the colon
    for (const m of src.matchAll(/processJob\(\s*['"]([A-Za-z_-]+):/g)) used.add(m[1]);
  }

  assert(used.size > 0, 'found no addJob/processJob call sites to check');

  const unmapped = [...used].filter((q) => !QUEUE_GROUPS[q]);
  assert(
    unmapped.length === 0,
    `these queues are used by call sites but not mapped: ${unmapped.join(', ')}`
  );

  return `${used.size} logical queues used, all mapped`;
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 + 5. The map must point at real, unique physical queues
// ─────────────────────────────────────────────────────────────────────────────
check('every QUEUE_GROUPS value is a real physical queue', () => {
  const bad = Object.entries(QUEUE_GROUPS).filter(
    ([, physical]) => !physicalQueueConfig[physical]
  );
  assert(bad.length === 0, `dangling mappings: ${JSON.stringify(bad)}`);
  return `${Object.keys(QUEUE_GROUPS).length} logical -> ` +
    `${Object.keys(physicalQueueConfig).length} physical`;
});

check('exactly 4 physical queues with unique names', () => {
  const names = Object.values(physicalQueueConfig).map((c) => c.name);
  assert(names.length === 4, `expected 4 physical queues, found ${names.length}`);
  assert(new Set(names).size === names.length, `duplicate queue names: ${names.join(', ')}`);
  return names.join(', ');
});

check('no logical queue name collides with a physical one', () => {
  const collisions = Object.keys(QUEUE_GROUPS).filter((k) => physicalQueueConfig[k]);
  assert(collisions.length === 0, `ambiguous keys: ${collisions.join(', ')}`);
  return 'no collisions';
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. The polling fix must actually be in place
// ─────────────────────────────────────────────────────────────────────────────
check('worker drainDelay is raised well above the 5s default', () => {
  const src = read(path.join(SRC, 'jobs', 'index.js'));
  const m = src.match(/drainDelay:\s*(\d+)/);
  assert(m, 'drainDelay is not set on the worker options');
  const seconds = Number(m[1]);
  assert(seconds >= 60, `drainDelay is ${seconds}s — too low, polling will blow the limit`);
  return `${seconds}s (BullMQ default is 5s)`;
});

check('per-add getJobCounts() round-trip was removed', () => {
  const src = read(path.join(SRC, 'jobs', 'index.js'));

  // Scope the check to the addJob() body — getQueueStats() legitimately calls
  // getJobCounts(), so a whole-file regex gives a false positive.
  const start = src.indexOf('const addJob = async');
  assert(start !== -1, 'addJob() not found');
  const end = src.indexOf('\n// Add recurring job', start);
  const body = src.slice(start, end === -1 ? undefined : end);

  assert(
    !/getJobCounts\(\)/.test(body),
    'addJob still issues a getJobCounts() Redis command on every enqueue'
  );
  return 'no extra Redis command per enqueue';
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. The worker on/off switch is wired to the env var
// ─────────────────────────────────────────────────────────────────────────────
check('ENABLE_QUEUE_WORKERS controls worker creation', () => {
  const jobsPath = require.resolve(path.join(SRC, 'jobs', 'index.js'));

  const load = (value) => {
    if (value === undefined) delete process.env.ENABLE_QUEUE_WORKERS;
    else process.env.ENABLE_QUEUE_WORKERS = value;
    delete require.cache[jobsPath];
    return require(jobsPath).workersEnabled;
  };

  assert(load('false') === false, 'ENABLE_QUEUE_WORKERS=false should disable workers');
  assert(load('true') === true, 'ENABLE_QUEUE_WORKERS=true should enable workers');
  assert(load(undefined) === true, 'default should keep workers enabled (back-compat)');

  delete process.env.ENABLE_QUEUE_WORKERS;
  return 'false -> off, true -> on, unset -> on';
});

check('the standalone worker process forces workers on', () => {
  const src = read(path.join(SRC, 'worker.js'));
  assert(
    /process\.env\.ENABLE_QUEUE_WORKERS\s*=\s*'true'/.test(src),
    'src/worker.js does not force ENABLE_QUEUE_WORKERS=true'
  );
  return "src/worker.js sets ENABLE_QUEUE_WORKERS='true'";
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Redis: app client fails fast, BullMQ client blocks safely
// ─────────────────────────────────────────────────────────────────────────────
check('the two Redis clients have the right retry behaviour', () => {
  const { buildRedisConfig } = require(path.join(SRC, 'config', 'redis.js'));

  const app = buildRedisConfig();
  const bull = buildRedisConfig({ forBullmq: true });

  assert(
    app.maxRetriesPerRequest !== null,
    'app client still has maxRetriesPerRequest:null — commands would hang'
  );
  assert(
    app.enableOfflineQueue === false,
    'app client queues commands while offline — that is what made APIs hang'
  );
  assert(
    bull.maxRetriesPerRequest === null,
    'BullMQ client must keep maxRetriesPerRequest:null'
  );
  assert(bull.enableOfflineQueue === true, 'BullMQ client needs the offline queue');

  return `app(retries=${app.maxRetriesPerRequest}, offlineQueue=${app.enableOfflineQueue}) · ` +
    `bullmq(retries=${bull.maxRetriesPerRequest}, offlineQueue=${bull.enableOfflineQueue})`;
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Startup ordering: listen first, create queues after
// ─────────────────────────────────────────────────────────────────────────────
check('app.js starts listening BEFORE creating queues', () => {
  const src = read(path.join(SRC, 'app.js'));
  const listenAt = src.indexOf('server.listen(');
  // the live call site (not the commented note)
  const initAt = src.indexOf('initializeQueues();', src.indexOf('server.listen('));

  assert(listenAt !== -1, 'server.listen( not found in app.js');
  assert(initAt !== -1, 'initializeQueues() is not called after server.listen()');
  assert(listenAt < initAt, 'initializeQueues() still runs before the server listens');
  return 'listen() then initializeQueues()';
});

check('compression middleware is enabled', () => {
  const src = read(path.join(SRC, 'app.js'));
  assert(
    /^\s*app\.use\(compression\(\)\);/m.test(src),
    'app.use(compression()) is not active'
  );
  return 'app.use(compression()) active';
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. No stale queue access left behind
// ─────────────────────────────────────────────────────────────────────────────
check('no direct queues[logical] lookups remain', () => {
  const offenders = [];
  for (const file of allFiles) {
    if (file.endsWith(path.join('jobs', 'index.js'))) continue;
    const src = read(file);
    if (/queues\.(email|sms|notification|payment|rental|delivery|report|cleanup|audit|vendor|maintenance|product|analytics|whatsapp|admin|backup)\b/.test(src)) {
      offenders.push(rel(file));
    }
  }
  assert(offenders.length === 0, `stale access in: ${offenders.join(', ')}`);
  return 'none';
});

check('queue helpers all resolve through resolveQueue()', () => {
  const src = read(path.join(SRC, 'jobs', 'index.js'));
  const raw = src.match(/queues\[queueType\]/g);
  assert(!raw, `${raw ? raw.length : 0} helper(s) still index queues[queueType] directly`);
  return 'all helpers mapped';
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Packaging
// ─────────────────────────────────────────────────────────────────────────────
check('package.json declares the worker script and ioredis', () => {
  const pkg = JSON.parse(
    read(path.join(__dirname, '..', 'package.json'))
  );
  assert(pkg.scripts.worker, '"worker" npm script is missing');
  assert(pkg.dependencies.ioredis, 'ioredis is required by config/redis.js but not declared');
  return `worker="${pkg.scripts.worker}", ioredis=${pkg.dependencies.ioredis}`;
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. LIVE check — only runs when Redis is actually reachable
// ─────────────────────────────────────────────────────────────────────────────
const canReachRedis = () =>
  new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: 6379 });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(400);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });

// ─────────────────────────────────────────────────────────────────────────────
// 13. Behavioural checks against a stubbed queue (no Redis needed)
// ─────────────────────────────────────────────────────────────────────────────
const behaviouralChecks = async () => {
  const jobs = require(path.join(SRC, 'jobs', 'index.js'));
  const calls = [];

  // Stub the physical queues so addJob() runs for real without touching Redis.
  const stub = (name) => ({
    name,
    add: async (jobName, payload, options) => {
      calls.push({ queue: name, jobName, payload, options });
      return { id: `stub-${calls.length}` };
    },
  });

  jobs.queues.messaging = stub('messaging-queue');
  jobs.queues.ops = stub('ops-queue');

  // a) logical name routes to the right physical queue, with the payload tagged
  await jobs.addJob('email', 'send', { to: 'a@b.c' }, {});
  const emailCall = calls.at(-1);
  assert(emailCall.queue === 'messaging-queue', `email routed to ${emailCall.queue}`);
  assert(emailCall.payload.queueType === 'email', 'payload.queueType was not tagged');
  assert(emailCall.payload.type === 'send', 'payload.type missing');
  assert(emailCall.payload.data.to === 'a@b.c', 'payload.data was not passed through');

  // b) per-queue job options come from queueConfigs
  assert(emailCall.options.attempts === 3, `email attempts = ${emailCall.options.attempts}`);

  // c) the two newly-added queues route to ops
  await jobs.addJob('kyc', 'review-reminder', {});
  assert(calls.at(-1).queue === 'ops-queue', 'kyc did not route to ops-queue');
  await jobs.addJob('support', 'create-ticket', {});
  assert(calls.at(-1).queue === 'ops-queue', 'support did not route to ops-queue');

  // d) a physical name still works directly
  await jobs.addJob('messaging', 'send', {});
  assert(calls.at(-1).queue === 'messaging-queue', 'physical name did not resolve');

  // e) an unknown queue is best-effort (returns null, does not throw)
  const dropped = await jobs.addJob('definitely-not-a-queue', 'x', {});
  assert(dropped === null, 'unknown queue should return null when not required');

  // f) ...but still throws when the caller marks it required
  let threw = false;
  try {
    await jobs.addJob('definitely-not-a-queue', 'x', {}, { required: true });
  } catch {
    threw = true;
  }
  assert(threw, 'required:true should throw for an unknown queue');

  // g) the `required` control flag must not leak into BullMQ job options
  await jobs.addJob('email', 'send', {}, { required: true });
  assert(
    !('required' in calls.at(-1).options),
    'the internal `required` flag leaked into the job options'
  );

  return `7 behavioural assertions (${calls.length} stubbed enqueues)`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const detail = await behaviouralChecks();
    results.push({ ok: true, name: 'addJob() behaves correctly (stubbed queue)', detail });
  } catch (error) {
    failed += 1;
    results.push({
      ok: false,
      name: 'addJob() behaves correctly (stubbed queue)',
      detail: error.message,
    });
  }

  const live = await canReachRedis();
  results.push({
    ok: true,
    skipped: !live,
    name: 'LIVE round-trip (enqueue -> process)',
    detail: live
      ? 'redis reachable'
      : 'SKIPPED — no Redis on 127.0.0.1:6379 (refusing to hit a remote/paid instance)',
  });

  const pad = Math.max(...results.map((r) => r.name.length));
  console.log('\nBullMQ consolidation — verification\n' + '─'.repeat(pad + 40));

  for (const r of results) {
    const mark = r.skipped ? '○ SKIP' : r.ok ? '✓ PASS' : '✗ FAIL';
    console.log(`${mark}  ${r.name.padEnd(pad)}  ${r.detail}`);
  }

  console.log('─'.repeat(pad + 40));
  console.log(
    failed === 0
      ? `\nAll ${results.length - 1} structural checks passed.\n`
      : `\n${failed} CHECK(S) FAILED\n`
  );

  process.exit(failed === 0 ? 0 : 1);
})();
