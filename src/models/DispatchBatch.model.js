const mongoose = require('mongoose');

const dispatchBatchSchema = new mongoose.Schema(
  {
    batchNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    zone: {
      type: String,
      default: 'all',
    },
    slotBucket: {
      type: String,
      enum: ['morning', 'afternoon', 'evening', 'flexible'],
      default: 'flexible',
    },
    dispatchDate: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['open', 'locked', 'assigned', 'in_progress', 'completed', 'cancelled'],
      default: 'open',
      index: true,
    },
    stops: [
      {
        delivery: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Delivery',
          required: true,
        },
        sequence: { type: Number, default: 0 },
        status: {
          type: String,
          enum: ['pending', 'completed', 'failed', 'skipped'],
          default: 'pending',
        },
        etaMinutes: Number,
        distanceKm: Number,
      },
    ],
    assignedPerson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DeliveryPerson',
    },
    assignedTeam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DeliveryTeam',
    },
    route: {
      totalDistanceKm: Number,
      estimatedMinutes: Number,
      optimized: { type: Boolean, default: false },
    },
    metadata: {
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      notes: String,
      tags: [String],
    },
  },
  { timestamps: true },
);

dispatchBatchSchema.index({ dispatchDate: 1, status: 1 });
dispatchBatchSchema.index({ 'stops.delivery': 1 });

dispatchBatchSchema.statics.generateBatchNumber = async function generateBatchNumber() {
  const count = await this.countDocuments();
  return `BAT${Date.now().toString().slice(-6)}${(count + 1).toString().padStart(4, '0')}`;
};

module.exports = mongoose.model('DispatchBatch', dispatchBatchSchema);
