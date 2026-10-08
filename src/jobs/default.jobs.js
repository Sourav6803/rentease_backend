// src/jobs/default.jobs.js
//
// Fallback processor for logical queues that have no dedicated handler.
//
// This module did not exist before, so every job routed to it — audit, vendor,
// maintenance, product, analytics, whatsapp, admin, backup and default, i.e.
// ~30 call sites — threw MODULE_NOT_FOUND at processing time. Each one burned
// all of its attempts, landed in the failed set, and left a delayed retry that
// BullMQ's scheduler then had to keep polling (extra Redis commands on a
// per-command billed plan).
//
// COMPLETING the job instead of throwing stops that churn. The warning makes it
// obvious the work was skipped rather than performed — if one of these jobs
// matters, add `src/jobs/<queue>.jobs.js` exporting `process(type, data)`.
const logger = require('../config/logger');

const summarise = (data) => {
  if (data === undefined || data === null) return 'none';
  if (typeof data !== 'object') return typeof data;
  const keys = Object.keys(data);
  return keys.length ? keys.join(', ') : 'empty object';
};

const process = async (type, data) => {
  logger.warn(
    `⚠️ No dedicated processor for job "${type}" (payload keys: ${summarise(data)}) — ` +
      `skipped. Implement src/jobs/<queue>.jobs.js to actually handle it.`
  );

  return { skipped: true, type };
};

module.exports = { process, summarise };
