const mongoose = require('mongoose');

const productInterestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  sessionId: { type: String, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  viewCount: { type: Number, default: 1 },
  totalTimeSpentSeconds: { type: Number, default: 0 },
  maxScrollDepth: { type: Number, default: 0 },
  interactionScore: { type: Number, default: 0, index: true },
  signals: [{
    type: { type: String },
    score: Number,
    at: { type: Date, default: Date.now },
  }],
  isInterested: { type: Boolean, default: false, index: true },
  lastViewedAt: { type: Date, default: Date.now },
  triggersSent: [{
    channel: { type: String, enum: ['email', 'sms', 'push', 'in_app', 'whatsapp'] },
    type: String,
    sentAt: Date,
  }],
}, { timestamps: true });

productInterestSchema.index({ user: 1, product: 1 }, { unique: true, sparse: true });
productInterestSchema.index({ sessionId: 1, product: 1 });

module.exports = mongoose.model('ProductInterest', productInterestSchema);
