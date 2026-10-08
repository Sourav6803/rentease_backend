// src/jobs/payment.jobs.js
//
// ⚠️ NOT IMPLEMENTED — this module did not exist before, so every payment job
// enqueued by the app (payment/reminder, payment/refund, payment/refund-deposit,
// payment/create…) threw MODULE_NOT_FOUND, retried three times and then sat in
// the failed set.
//
// Completing the job (with a loud warning) stops that retry churn. It does NOT
// make the payment work — implement the handlers below when the money flows
// exist on the provider side.
const logger = require('../config/logger');
const { summarise } = require('./default.jobs');

const process = async (type, data) => {
  logger.warn(
    `⚠️ Payment job "${type}" was SKIPPED (payload keys: ${summarise(data)}) — ` +
      `no processor implemented in src/jobs/payment.jobs.js. Payment work did NOT run.`
  );

  return { skipped: true, type };
};

module.exports = { process };
