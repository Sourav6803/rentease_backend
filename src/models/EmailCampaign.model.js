const mongoose = require('mongoose');

const emailCampaignSchema = new mongoose.Schema({
  name: { type: String, required: true },
  template: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailTemplate' },
  subject: String,
  htmlBody: String,
  audience: {
    type: { type: String, enum: ['all', 'segment', 'selected', 'individual'], default: 'segment' },
    segmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerSegment' },
    userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled', 'failed'],
    default: 'draft',
    index: true,
  },
  scheduledAt: Date,
  sentAt: Date,
  stats: {
    targeted: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    opened: { type: Number, default: 0 },
    clicked: { type: Number, default: 0 },
    bounced: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
  },
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketingWorkflow' },
  },
}, { timestamps: true });

module.exports = mongoose.model('EmailCampaign', emailCampaignSchema);
