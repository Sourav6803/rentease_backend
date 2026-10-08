// src/jobs/cleanup.jobs.js
//
// ⚠️ NOT IMPLEMENTED — this module did not exist before, so every cleanup job
// threw MODULE_NOT_FOUND, retried, and ended up in the failed set.
//
// Completing the job (with a warning) stops that retry churn. Nothing is
// actually cleaned up — implement the handlers when needed.
const logger = require('../config/logger');
const { summarise } = require('./default.jobs');

const process = async (type, data) => {
  logger.warn(
    `⚠️ Cleanup job "${type}" was SKIPPED (payload keys: ${summarise(data)}) — ` +
      `no processor implemented in src/jobs/cleanup.jobs.js. Nothing was cleaned up.`
  );

  return { skipped: true, type };
};

module.exports = { process };
