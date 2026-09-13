const mongoose = require('mongoose');
const SystemSettings = require('../../models/SystemSettings.model');
const { Payment } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const encryption = require('../../utils/encryption');

/**
 * Persist a gateway secret.
 *
 * Secrets used to be written to `systemsettings` as cleartext, which put them in
 * every Mongo backup and in plain sight in the Atlas console. `encryptToString`
 * mirrors what the vendor bank account already does. With no ENCRYPTION_KEY
 * configured it returns the input unchanged, so local development still works.
 */
const encryptSecret = (plaintext) => encryption.encryptToString(String(plaintext));

const maskSensitive = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  const masked = { ...obj };
  const sensitiveKeys = ['keySecret', 'secretKey', 'webhookSecret', 'webhook_secret'];
  for (const key of Object.keys(masked)) {
    if (sensitiveKeys.some(sk => key.toLowerCase() === sk.toLowerCase())) {
      masked[key] = masked[key] && masked[key].length > 0 ? '***' : '';
    }
  }
  return masked;
};

const getDefaultPaymentSettings = () => ({
  razorpay: {
    keyId: '',
    keySecret: '***',
    webhookSecret: '***',
    enabled: false
  },
  stripe: {
    publishableKey: '',
    secretKey: '***',
    webhookSecret: '***',
    enabled: false
  },
  commission: {
    defaultRate: 10,
    minRate: 5,
    maxRate: 25,
    type: 'percentage',
    vendorTiers: [],
    categoryRates: [],
    platformFee: 0,
    platformFeeType: 'percentage',
    taxEnabled: false,
    taxRate: 0,
    convenienceFeeEnabled: false,
    convenienceFeeRate: 0,
    convenienceFeeCap: 0
  },
  payout: {
    schedule: 'weekly',
    minimumAmount: 500,
    processingFee: 0,
    taxRate: 0,
    payoutDay: 1,
    holdPeriod: 7,
    autoPayout: false,
    payoutCycle: 'weekly',
    minPayoutAmount: 0,
    holdDays: 7,
    razorpayPayoutEnabled: false,
    razorpayAccount: '',
    // RazorpayX payout credentials. `keySecret` reads back as '***' once set.
    keyId: '',
    keySecret: '',
    // Payouts default to test mode so nothing can move real money until it is
    // deliberately switched over.
    testMode: true
  },
  refund: {
    autoRefundPeriod: 7,
    maxRefundAmount: 50000,
    refundReasonRequired: true,
    approvalRequired: false,
    refundFee: 0,
    autoRefund: false,
    refundWindow: 7,
    partialRefundAllowed: true,
    maxRefundDays: 30
  }
});

class PaymentSettingsController {
  getPaymentSettings = catchAsync(async (req, res) => {
    const settings = await SystemSettings.getInstance();
    const payment = settings.payment || {};
    const merged = getDefaultPaymentSettings();
    if (payment.razorpay) merged.razorpay = { ...merged.razorpay, ...maskSensitive(payment.razorpay) };
    if (payment.stripe) merged.stripe = { ...merged.stripe, ...maskSensitive(payment.stripe) };
    if (payment.commission) merged.commission = { ...merged.commission, ...payment.commission };
    // Masked: `payout` now carries a RazorpayX keySecret, so spreading it raw would
    // hand the stored secret to the browser.
    if (payment.payout) merged.payout = { ...merged.payout, ...maskSensitive(payment.payout) };
    if (payment.refund) merged.refund = { ...merged.refund, ...payment.refund };
    return ApiResponse.success(res, 200, 'Payment settings retrieved successfully', merged);
  });

  saveRazorpaySettings = catchAsync(async (req, res) => {
    const data = req.body;
    const settings = await SystemSettings.getInstance();
    const currentRazorpay = settings.payment?.razorpay || {};
    const updatedRazorpay = {
      keyId: data.keyId || currentRazorpay.keyId,
      // A new secret is encrypted before it is stored. `***` and empty mean "leave
      // the existing value alone", and the existing value is already an envelope so
      // it must NOT be re-encrypted.
      keySecret: data.keySecret !== undefined && data.keySecret !== '' && data.keySecret !== '***'
        ? encryptSecret(data.keySecret)
        : currentRazorpay.keySecret,
      webhookSecret: data.webhookSecret !== undefined && data.webhookSecret !== '' && data.webhookSecret !== '***'
        ? encryptSecret(data.webhookSecret)
        : currentRazorpay.webhookSecret,
      enabled: data.enabled !== undefined ? data.enabled : currentRazorpay.enabled,
      // The Test/Live toggle used to be cosmetic: the schema had no `testMode` field
      // for this gateway, so Mongoose dropped it on save and the badge kept showing
      // the frontend default. It is only a LABEL though — the key prefix decides the
      // environment at Razorpay.
      testMode:
        data.testMode !== undefined ? Boolean(data.testMode) : Boolean(currentRazorpay.testMode),
    };
    settings.payment = { ...(settings.payment || {}), razorpay: updatedRazorpay };
    await settings.save();
    return ApiResponse.success(res, 200, 'Razorpay settings updated successfully', maskSensitive(updatedRazorpay));
  });

  saveStripeSettings = catchAsync(async (req, res) => {
    const data = req.body;
    const settings = await SystemSettings.getInstance();
    const currentStripe = settings.payment?.stripe || {};
    const updatedStripe = {
      publishableKey: data.publishableKey || currentStripe.publishableKey,
      // Encrypted at rest for the same reason as the Razorpay secrets above.
      secretKey: data.secretKey !== undefined && data.secretKey !== '' && data.secretKey !== '***'
        ? encryptSecret(data.secretKey)
        : currentStripe.secretKey,
      webhookSecret: data.webhookSecret !== undefined && data.webhookSecret !== '' && data.webhookSecret !== '***'
        ? encryptSecret(data.webhookSecret)
        : currentStripe.webhookSecret,
      enabled: data.enabled !== undefined ? data.enabled : currentStripe.enabled,
      // Same as razorpay: making the Test/Live toggle persist instead of pretending.
      testMode:
        data.testMode !== undefined ? Boolean(data.testMode) : Boolean(currentStripe.testMode),
    };
    settings.payment = { ...(settings.payment || {}), stripe: updatedStripe };
    await settings.save();
    return ApiResponse.success(res, 200, 'Stripe settings updated successfully', maskSensitive(updatedStripe));
  });

  saveCommissionSettings = catchAsync(async (req, res) => {
    const data = req.body;
    const settings = await SystemSettings.getInstance();
    const currentCommission = settings.payment?.commission || {};
    const updatedCommission = { ...currentCommission, ...data };
    settings.payment = { ...(settings.payment || {}), commission: updatedCommission };
    await settings.save();
    return ApiResponse.success(res, 200, 'Commission settings updated successfully', updatedCommission);
  });

  savePayoutSettings = catchAsync(async (req, res) => {
    const data = req.body;
    const settings = await SystemSettings.getInstance();
    const currentPayout = settings.payment?.payout || {};

    // Deliberately NOT a blind spread any more. Three reasons:
    //   - `keySecret` is now a real credential, so it has to be encrypted before it
    //     is stored rather than written through in clear,
    //   - `***` and empty have to mean "keep the existing value", otherwise saving
    //     the form from the UI would wipe the secret with the mask,
    //   - the response must never echo the secret back to the browser.
    const updatedPayout = {
      ...currentPayout,
      ...data,
      keySecret:
        data.keySecret !== undefined && data.keySecret !== '' && data.keySecret !== '***'
          ? encryptSecret(data.keySecret)
          : currentPayout.keySecret,
    };

    settings.payment = { ...(settings.payment || {}), payout: updatedPayout };
    await settings.save();
    return ApiResponse.success(
      res,
      200,
      'Payout settings updated successfully',
      maskSensitive(updatedPayout),
    );
  });

  saveRefundSettings = catchAsync(async (req, res) => {
    const data = req.body;
    const settings = await SystemSettings.getInstance();
    const currentRefund = settings.payment?.refund || {};
    const updatedRefund = { ...currentRefund, ...data };
    settings.payment = { ...(settings.payment || {}), refund: updatedRefund };
    await settings.save();
    return ApiResponse.success(res, 200, 'Refund settings updated successfully', updatedRefund);
  });

  getPaymentStats = catchAsync(async (req, res) => {
    const [totalTransactionsResult, totalAmountResult, successRateResult, averageTransactionResult, dailyStatsResult, methodBreakdownResult] = await Promise.all([
      Payment.countDocuments(),
      Payment.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
      Payment.aggregate([
        { $match: { status: 'success' } },
        { $group: { _id: null, succeeded: { $sum: 1 } } }
      ]),
      Payment.aggregate([
        { $match: { status: 'success' } },
        { $group: { _id: null, average: { $avg: '$amount' } } }
      ]),
      Payment.aggregate([
        {
          $match: {
            createdAt: {
              $gte: new Date(new Date().setDate(new Date().getDate() - 6))
            }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            count: { $sum: 1 },
            amount: { $sum: '$amount' }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ]),
      Payment.aggregate([
        {
          $group: {
            _id: '$method',
            amount: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const totalTransactions = totalTransactionsResult || 0;
    const totalAmount = totalAmountResult?.[0]?.total || 0;
    const succeededCount = successRateResult?.[0]?.succeeded || 0;
    const successRate = totalTransactions > 0 ? (succeededCount / totalTransactions) * 100 : 0;
    const averageTransaction = averageTransactionResult?.[0]?.average || 0;

    const dailyStats = dailyStatsResult.map(item => ({
      date: new Date(item._id.year, item._id.month - 1, item._id.day).toISOString().split('T')[0],
      count: item.count,
      amount: item.amount
    }));

    const methodBreakdown = methodBreakdownResult.map(item => ({
      method: item._id,
      amount: item.amount,
      count: item.count
    }));

    return ApiResponse.success(res, 200, 'Payment statistics retrieved successfully', {
      totalTransactions,
      totalAmount,
      successRate: parseFloat(successRate.toFixed(2)),
      averageTransaction,
      dailyStats,
      methodBreakdown
    });
  });
}

module.exports = new PaymentSettingsController();
