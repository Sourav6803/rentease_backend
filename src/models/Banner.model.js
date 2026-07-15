// models/Banner.model.js
const mongoose = require('mongoose');

/**
 * Banner / Promotion model
 *
 * Powers the dynamic, admin-managed content on the storefront homepage:
 *  - `hero`  → full-width hero carousel slides
 *  - `promo` → promotional offer cards (the "grid of offers" row)
 *  - `strip` → thin announcement / marketing strip
 *  - `deal`  → "Deals of the day" style cards (can link to a discount code)
 */
const bannerSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    subtitle: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    // Where this banner renders on the storefront.
    type: {
      type: String,
      enum: ['hero', 'promo', 'strip', 'deal'],
      default: 'hero',
      index: true,
    },

    image: {
      url: { type: String, default: '' },        // desktop image
      mobileUrl: { type: String, default: '' },   // optional mobile-optimised image
      alt: { type: String, default: '' },
    },

    // Call-to-action
    cta: {
      label: { type: String, default: 'Shop Now' },
      link: { type: String, default: '/products' },
    },

    // Visual styling (consumed as inline styles / classes on the frontend so
    // banners can be themed without a code deploy).
    theme: {
      gradient: { type: String, default: 'from-blue-600 to-indigo-600' },
      textColor: { type: String, default: '#ffffff' },
      bgColor: { type: String, default: '#2874F0' },
      accent: { type: String, default: '#FFD400' },
    },

    // Small badge/label chip, e.g. "HOT DEAL", "UP TO 40% OFF"
    badge: { type: String, trim: true, default: '' },

    // Optional deep links / associations
    targetCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },
    discountCode: { type: String, trim: true, default: '' },

    displayOrder: {
      type: Number,
      default: 0,
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Scheduling window. Null = always on (subject to isActive).
    schedule: {
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },
    },

    // Lightweight analytics
    stats: {
      impressions: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
    },

    // AI generation tracking
    aiGenerated: { type: Boolean, default: false },
    aiGenerationMetadata: {
      promptUsed: { type: String, default: '' },
      fallback: { type: Boolean, default: false },
      generatedAt: { type: Date, default: null },
    },
    aiGenerationError: { type: String, default: '' },

    metadata: {
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    },
  },
  { timestamps: true }
);

// Common query path: active banners of a type, ordered for display.
bannerSchema.index({ type: 1, isActive: 1, displayOrder: 1 });

/**
 * True when the banner is active AND within its (optional) schedule window.
 */
bannerSchema.virtual('isLive').get(function () {
  if (!this.isActive) return false;
  const now = new Date();
  if (this.schedule?.startDate && now < this.schedule.startDate) return false;
  if (this.schedule?.endDate && now > this.schedule.endDate) return false;
  return true;
});

module.exports = mongoose.model('Banner', bannerSchema);
