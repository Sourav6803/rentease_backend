const mongoose = require('mongoose');

const marketingWorkflowSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  description: String,
  trigger: {
    type: {
      type: String,
      enum: [
        'user_inactive_7d', 'user_inactive_30d', 'product_viewed_multiple',
        'cart_abandoned', 'rental_expiring', 'product_back_in_stock',
        'festival_campaign', 'flash_sale', 'referral_reminder', 'birthday',
        'anniversary', 'welcome', 'thank_you', 'review_reminder',
        'coupon_expiry', 'offer_launch', 'newsletter', 'interest_detected',
        'price_drop', 'wishlist_reminder',
      ],
      required: true,
    },
    config: mongoose.Schema.Types.Mixed,
  },
  actions: [{
    type: { type: String, enum: ['email', 'sms', 'push', 'in_app', 'whatsapp', 'create_offer'] },
    delayMinutes: { type: Number, default: 0 },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailTemplate' },
    discountCode: String,
    config: mongoose.Schema.Types.Mixed,
  }],
  isEnabled: { type: Boolean, default: false, index: true },
  stats: {
    triggered: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
  },
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
}, { timestamps: true });

module.exports = mongoose.model('MarketingWorkflow', marketingWorkflowSchema);
