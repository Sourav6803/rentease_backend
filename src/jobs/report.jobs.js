// src/jobs/report.jobs.js
//
// ⚠️ NOT IMPLEMENTED — this module did not exist before, so every report job
// threw MODULE_NOT_FOUND, retried, and ended up in the failed set.
//
// Completing the job (with a warning) stops that retry churn. No report is
// actually generated — implement the handlers when needed.
const logger = require('../config/logger');
const { summarise } = require('./default.jobs');

const process = async (type, data) => {
  logger.warn(
    `⚠️ Report job "${type}" was SKIPPED (payload keys: ${summarise(data)}) — ` +
      `no processor implemented in src/jobs/report.jobs.js. No report was generated.`
  );

  return { skipped: true, type };
};

module.exports = { process };
