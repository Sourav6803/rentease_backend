const mongoose = require('mongoose');

const systemLogSchema = new mongoose.Schema({
  type: { type: String, enum: ['activity', 'error', 'audit', 'performance'], required: true, index: true },
  user: {
    _id: { type: mongoose.Schema.Types.ObjectId },
    name: String,
    email: String,
    role: String
  },
  action: { type: String, index: true },
  resource: String,
  resourceId: String,
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  ipAddress: String,
  userAgent: String,
  timestamp: { type: Date, default: Date.now, index: true },
  errorId: String,
  message: String,
  stack: String,
  code: String,
  statusCode: Number,
  route: String,
  method: String,
  resolved: { type: Boolean, default: false },
  changes: [{ field: String, oldValue: mongoose.Schema.Types.Mixed, newValue: mongoose.Schema.Types.Mixed }],
  performedBy: {
    _id: { type: mongoose.Schema.Types.ObjectId },
    name: String,
    email: String,
    role: String
  },
  endpoint: String,
  responseTime: Number
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

systemLogSchema.index({ type: 1, timestamp: -1 });
systemLogSchema.index({ route: 1, method: 1, timestamp: -1 });
systemLogSchema.index({ statusCode: 1 });

const SystemLog = mongoose.model('SystemLog', systemLogSchema);
module.exports = SystemLog;
