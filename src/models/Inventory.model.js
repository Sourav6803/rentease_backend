// models/Inventory.model.js
const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    index: true
  },
  sku: {
    type: String,
    required: true,
    unique: true
  },
  serialNumber: {
    type: String,
    sparse: true,
    unique: true
  },
  qrCode: String,
  barcode: String,
  location: {
    warehouse: String,
    shelf: String,
    city: String,
    pincode: String
  },
  condition: {
    status: {
      type: String,
      enum: ['new', 'excellent', 'good', 'fair', 'poor', 'damaged'],
      default: 'new'
    },
    notes: String,
    lastInspectionDate: Date,
    nextInspectionDate: Date,
    inspectionHistory: [{
      date: Date,
      inspector: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      condition: String,
      notes: String,
      images: [String]
    }]
  },
  status: {
    type: String,
    enum: ['available', 'reserved', 'rented', 'maintenance', 'damaged', 'retired', 'lost'],
    default: 'available',
    index: true
  },
  currentRental: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rental',
    sparse: true
  },
  rentalHistory: [{
    rental: { type: mongoose.Schema.Types.ObjectId, ref: 'Rental' },
    startDate: Date,
    endDate: Date,
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  maintenanceHistory: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Maintenance'
  }],
  purchaseInfo: {
    date: Date,
    price: Number,
    from: String,
    invoiceNumber: String,
    warrantyExpiry: Date
  },
  depreciation: {
    rate: Number,
    currentValue: Number,
    lastCalculated: Date
  },
  metadata: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }
}, {
  timestamps: true
});

// Indexes
// inventorySchema.index({ sku: 1 });
inventorySchema.index({ 'location.pincode': 1 });
inventorySchema.index({ status: 1, 'location.city': 1 });

// Methods
inventorySchema.methods.reserve = async function(rentalId) {
  this.status = 'reserved';
  this.currentRental = rentalId;
  await this.save();
};

inventorySchema.methods.rent = async function(rentalId, userId) {
  this.status = 'rented';
  this.currentRental = rentalId;
  this.rentalHistory.push({
    rental: rentalId,
    startDate: new Date(),
    user: userId
  });
  await this.save();
};

inventorySchema.methods.return = async function(condition) {
  this.status = 'available';
  if (this.rentalHistory.length > 0) {
    const lastRental = this.rentalHistory[this.rentalHistory.length - 1];
    lastRental.endDate = new Date();
  }
  this.condition.status = condition;
  await this.save();
};

module.exports = mongoose.model('Inventory', inventorySchema);