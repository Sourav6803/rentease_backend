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
  enabled: { type: Boolean, default: false }
}, { _id: false });

const stripeSchema = new mongoose.Schema({
  publishableKey: { type: String, default: '' },
  secretKey: { type: String, default: '' },
  webhookSecret: { type: String, default: '' },
  enabled: { type: Boolean, default: false }
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
  autoPayout: { type: Boolean, default: true },
  payoutDay: { type: Number, default: 1, min: 0, max: 31 },
  holdPeriod: { type: Number, default: 7 },
  autoPayout: { type: Boolean, default: false },
  payoutCycle: { type: String, enum: ['weekly', 'biweekly', 'monthly'], default: 'weekly' },
  minPayoutAmount: { type: Number, default: 0 },
  holdDays: { type: Number, default: 7 },
  razorpayPayoutEnabled: { type: Boolean, default: false },
  razorpayAccount: { type: String, default: '' }
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
