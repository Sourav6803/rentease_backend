const express = require('express');
const router = express.Router();
const paymentSettingsController = require('../../controllers/payment-settings.controller');
const { protectAdmin, restrictTo } = require('../../middlewares/admin-auth.middleware');

router.use(protectAdmin);
router.use(restrictTo('super_admin', 'admin', 'finance_manager'));

router.get('/', paymentSettingsController.getPaymentSettings);
router.put('/razorpay', paymentSettingsController.saveRazorpaySettings);
router.put('/stripe', paymentSettingsController.saveStripeSettings);
router.put('/commission', paymentSettingsController.saveCommissionSettings);
router.put('/payout', paymentSettingsController.savePayoutSettings);
router.put('/refund', paymentSettingsController.saveRefundSettings);

module.exports = router;
