const mongoose = require('mongoose');

const emailTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  subject: { type: String, required: true },
  htmlBody: { type: String, required: true },
  textBody: String,
  category: {
    type: String,
    enum: ['transactional', 'marketing', 'offer', 'reminder', 'newsletter', 'automation'],
    default: 'marketing',
  },
  variables: [String],
  isActive: { type: Boolean, default: true },
  stats: {
    sent: { type: Number, default: 0 },
    opened: { type: Number, default: 0 },
    clicked: { type: Number, default: 0 },
    bounced: { type: Number, default: 0 },
  },
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
}, { timestamps: true });

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);
