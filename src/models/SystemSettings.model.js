const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  street: { type: String, default: '' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  pincode: { type: String, default: '' },
  country: { type: String, default: 'India' }
}, { _id: false });

const socialLinksSchema = new mongoose.Schema({
  facebook: { type: String, default: '' },
  twitter: { type: String, default: '' },
  instagram: { type: String, default: '' },
  linkedin: { type: String, default: '' },
  youtube: { type: String, default: '' }
}, { _id: false });

const seoSchema = new mongoose.Schema({
  metaTitle: { type: String, default: '' },
  metaDescription: { type: String, default: '' },
  metaKeywords: { type: String, default: '' },
  googleAnalyticsId: { type: String, default: '' }
}, { _id: false });

const featuresSchema = new mongoose.Schema({
  pushNotifications: { type: Boolean, default: true },
  emailNotifications: { type: Boolean, default: true },
  smsNotifications: { type: Boolean, default: true },
  autoPayments: { type: Boolean, default: true },
  vendorPayouts: { type: Boolean, default: true },
  maintenanceRequests: { type: Boolean, default: true }
}, { _id: false });

const razorpaySchema = new mongoose.Schema({
  keyId: { type: String, default: '' },
  keySecret: { type: String, default: '' },
  webhookSecret: { type: String, default: '' },
  enabled: { type: Boolean, default: false },
  /**
   * The settings screen has always had a Test/Live toggle for this gateway, but
   * the field did not exist here and saveRazorpaySettings never wrote it, so the
   * toggle was cosmetic and the badge always showed the frontend default.
   *
   * It is a LABEL, not the authority: which environment the gateway actually runs
   * in is decided by the key prefix (`rzp_test_` / `rzp_live_`). The API reports
   * that derived value alongside this one so the UI can show the truth.
   */
  testMode: { type: Boolean, default: true }
}, { _id: false });

const stripeSchema = new mongoose.Schema({
  publishableKey: { type: String, default: '' },
  secretKey: { type: String, default: '' },
  webhookSecret: { type: String, default: '' },
  enabled: { type: Boolean, default: false },
  // Same reasoning as razorpaySchema.testMode.
  testMode: { type: Boolean, default: true }
}, { _id: false });

const commissionSchema = new mongoose.Schema({
  defaultRate: { type: Number, default: 10 },
  minRate: { type: Number, default: 5 },
  maxRate: { type: Number, default: 25 },
  type: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
  vendorTiers: [{
    minRentals: { type: Number, default: 0 },
    maxRentals: { type: Number, default: 50 },
    rate: { type: Number, default: 10 }
  }],
  categoryRates: [{
    category: { type: String },
    rate: { type: Number, default: 0 }
  }],
  platformFee: { type: Number, default: 0 },
  platformFeeType: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
  taxEnabled: { type: Boolean, default: false },
  taxRate: { type: Number, default: 0 },
  convenienceFeeEnabled: { type: Boolean, default: false },
  convenienceFeeRate: { type: Number, default: 0 },
  convenienceFeeCap: { type: Number, default: 0 }
}, { _id: false });

const payoutSchema = new mongoose.Schema({
  schedule: { type: String, enum: ['daily', 'weekly', 'biweekly', 'monthly'], default: 'weekly' },
  minimumAmount: { type: Number, default: 500 },
  processingFee: { type: Number, default: 0 },
  taxRate: { type: Number, default: 0 },
  payoutDay: { type: Number, default: 1, min: 0, max: 31 },
  holdPeriod: { type: Number, default: 7 },
  // `autoPayout` used to be declared TWICE in this schema (once default true, once
  // default false). Mongoose let the second declaration win, so the first was dead
  // code and `default: true` never applied. One declaration now.
  autoPayout: { type: Boolean, default: false },
  payoutCycle: { type: String, enum: ['weekly', 'biweekly', 'monthly'], default: 'weekly' },
  minPayoutAmount: { type: Number, default: 0 },
  holdDays: { type: Number, default: 7 },
  razorpayPayoutEnabled: { type: Boolean, default: false },
  razorpayAccount: { type: String, default: '' },

  // ── RazorpayX payout credentials ──────────────────────────────────────────
  // Drives /v1/contacts, /v1/fund_accounts and /v1/payouts. Encrypted at rest by
  // payment-settings.controller.js, exactly like the gateway secrets.
  keyId: { type: String, default: '' },
  keySecret: { type: String, default: '' },
  /**
   * Payouts ALWAYS start in test mode.
   *
   * RazorpayX test mode runs on a dummy balance and per their docs "no real money
   * is used": payouts, contacts and fund accounts created there never reach the
   * live environment. Defaulting to true means an install that switches gateway
   * payouts on before anyone has thought it through still cannot move real money.
   * Going live is a separate, deliberate flip.
   */
  testMode: { type: Boolean, default: true }
}, { _id: false });

const refundSchema = new mongoose.Schema({
  autoRefundPeriod: { type: Number, default: 7 },
  maxRefundAmount: { type: Number, default: 50000 },
  refundReasonRequired: { type: Boolean, default: true },
  approvalRequired: { type: Boolean, default: false },
  refundFee: { type: Number, default: 0 },
  autoRefund: { type: Boolean, default: false },
  refundWindow: { type: Number, default: 7 },
  partialRefundAllowed: { type: Boolean, default: true },
  maxRefundDays: { type: Number, default: 30 }
}, { _id: false });

const paymentSchema = new mongoose.Schema({
  razorpay: { type: razorpaySchema, default: () => ({}) },
  stripe: { type: stripeSchema, default: () => ({}) },
  commission: { type: commissionSchema, default: () => ({}) },
  payout: { type: payoutSchema, default: () => ({}) },
  refund: { type: refundSchema, default: () => ({}) }
}, { _id: false });

const smsSchema = new mongoose.Schema({
  twilio: {
    accountSid: { type: String },
    authToken: { type: String },
    messagingServiceSid: { type: String },
    fromNumber: { type: String },
    statusCallbackUrl: { type: String },
    testMode: { type: Boolean, default: false }
  },
  templates: [{
    id: { type: String, required: true },
    name: { type: String },
    body: { type: String, required: true },
    variables: [{ type: String }],
    isActive: { type: Boolean, default: true }
  }],
  usage: {
    totalSent: { type: Number, default: 0 },
    totalSegments: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    dailyStats: [{
      date: { type: Date },
      count: { type: Number, default: 0 },
      cost: { type: Number, default: 0 }
    }]
  }
}, { _id: false });

const systemSettingsSchema = new mongoose.Schema({
  siteName: { type: String, default: 'RentEase' },
  siteDescription: { type: String, default: '' },
  contactEmail: { type: String, default: '' },
  supportEmail: { type: String, default: '' },
  supportPhone: { type: String, default: '' },
  address: { type: addressSchema, default: () => ({}) },
  socialLinks: { type: socialLinksSchema, default: () => ({}) },
  seo: { type: seoSchema, default: () => ({}) },
  logo: { type: String, default: '' },
  favicon: { type: String, default: '' },
  currency: { type: String, default: 'INR' },
  timezone: { type: String, default: 'Asia/Kolkata' },
  features: { type: featuresSchema, default: () => ({}) },
  maintenanceMode: { type: Boolean, default: false },
  registrationEnabled: { type: Boolean, default: true },
  vendorRegistrationEnabled: { type: Boolean, default: true },
  defaultCommission: { type: Number, default: 10 },
  payment: { type: paymentSchema, default: () => ({}) },
  sms: { type: smsSchema, default: () => ({}) }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

systemSettingsSchema.statics.getInstance = async function() {
  let settings = await this.findOne({}).sort({ createdAt: 1 });
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

systemSettingsSchema.statics.upsertSettings = async function(updateData) {
  const result = await this.findOneAndUpdate(
    {},
    { $set: { ...updateData, updatedAt: new Date() } },
    { new: true, upsert: true }
  );
  return result;
};

const SystemSettings = mongoose.model('SystemSettings', systemSettingsSchema);

module.exports = SystemSettings;
