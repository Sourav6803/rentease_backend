const mongoose = require('mongoose');

const customerSegmentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: String,
  type: { type: String, enum: ['static', 'dynamic'], default: 'dynamic' },
  rules: [{
    field: String,
    operator: { type: String, enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'] },
    value: mongoose.Schema.Types.Mixed,
  }],
  userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  estimatedCount: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    tags: [String],
  },
}, { timestamps: true });

module.exports = mongoose.model('CustomerSegment', customerSegmentSchema);
