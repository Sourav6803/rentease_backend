const express = require('express');
const router = express.Router();
const PaymentService = require('./../../../services/payment.service');
const logger = require('../../../config/logger');

/**
 * Gateway webhook receivers.
 *
 * Both routes hand the service the RAW request bytes, captured centrally by the
 * `express.json({ verify })` hook in app.js, plus the gateway's signature header.
 *
 * The per-route body parsers that used to live here were removed because they
 * could never work:
 *   - `express.raw()` on /stripe was a no-op, since the global json parser in
 *     app.js had already consumed the stream and left `req.body` as a parsed
 *     object. Stripe's `constructEvent` needs the signed bytes, so verification
 *     always failed.
 *   - /razorpay passed `JSON.stringify(req.body)`, which does not reproduce the
 *     bytes Razorpay signed (key order, whitespace and unicode escaping all
 *     differ), so the HMAC never matched.
 *
 * A failure responds 400 so the gateway retries; a duplicate delivery responds
 * 200 so it stops.
 */
router.post('/stripe', async (req, res) => {
  try {
    const result = await PaymentService.handleWebhook(
      'stripe',
      req.rawBody,
      req.headers['stripe-signature'],
      { eventId: req.headers['stripe-event-id'] },
    );
    res.json(result);
  } catch (error) {
    logger.error(`Stripe webhook error: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

router.post('/razorpay', async (req, res) => {
  try {
    const result = await PaymentService.handleWebhook(
      'razorpay',
      req.rawBody,
      req.headers['x-razorpay-signature'],
      { eventId: req.headers['x-razorpay-event-id'] },
    );
    res.json(result);
  } catch (error) {
    logger.error(`Razorpay webhook error: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
