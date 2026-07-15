const mongoose = require('mongoose');

const userBehaviorEventSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  sessionId: { type: String, index: true },
  eventType: {
    type: String,
    enum: [
      'product_view', 'product_scroll', 'product_compare', 'product_zoom',
      'search', 'category_browse', 'add_to_wishlist', 'remove_from_wishlist',
      'add_to_cart', 'remove_from_cart', 'checkout_started', 'checkout_completed',
      'rental_cancelled', 'rental_extended', 'review_submitted', 'brochure_download',
      'availability_check', 'page_view',
    ],
    required: true,
    index: true,
  },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', index: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  metadata: {
    query: String,
    scrollDepth: Number,
    timeSpentSeconds: Number,
    device: String,
    browser: String,
    location: { city: String, state: String, country: String },
    trafficSource: String,
    referrer: String,
    pageUrl: String,
    cartValue: Number,
    rentalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Rental' },
  },
}, { timestamps: true });

userBehaviorEventSchema.index({ createdAt: -1 });
userBehaviorEventSchema.index({ user: 1, product: 1, eventType: 1 });

module.exports = mongoose.model('UserBehaviorEvent', userBehaviorEventSchema);
