const express = require('express');
const router = express.Router();
// const PaymentService = require('../../services/payment.service');
const PaymentService = require('./../../../services/payment.service');
const logger = require('../../../config/logger');

// Stripe webhook
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const result = await PaymentService.handleWebhook('stripe', req.body, sig);
    res.json(result);
  } catch (error) {
    logger.error('Stripe webhook error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Razorpay webhook
router.post('/razorpay', express.json(), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const result = await PaymentService.handleWebhook('razorpay', JSON.stringify(req.body), signature);
    res.json(result);
  } catch (error) {
    logger.error('Razorpay webhook error:', error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;