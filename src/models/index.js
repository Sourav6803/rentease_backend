// models/index.js - Simple export file without any virtuals
const mongoose = require('mongoose');

// Import all models
const User = require('./User.model');
const Admin = require('./Admin.model');
const Vendor = require('./Vendor.model');
const Product = require('./Product.model');
const Category = require('./Category.model');
const Rental = require('./Rental.model');
const Payment = require('./Payment.model');
const Inventory = require('./Inventory.model');
const Address = require('./Address.model');
const Delivery = require('./Delivery.model');
const Maintenance = require('./Maintenance.model');
const Review = require('./Review.model');
const Discount = require('./Discount.model');
const Notification = require('./Notification.model');
const AuditLog = require('./AuditLog.model');
const SupportTicket = require('./SupportTicket.model');
const AdminActivity = require('./AdminActivity.model');
const Cart = require('./Cart.model');
const DeliveryPerson = require('./DeliveryPerson.model');
const DeliveryTeam = require('./DeliveryTeam.model');
const DispatchBatch = require('./DispatchBatch.model');
const Banner = require('./Banner.model');
const Wishlist = require('./Wishlist.model');
const UserBehaviorEvent = require('./UserBehaviorEvent.model');
const ProductInterest = require('./ProductInterest.model');
const CustomerSegment = require('./CustomerSegment.model');
const EmailTemplate = require('./EmailTemplate.model');
const EmailCampaign = require('./EmailCampaign.model');
const MarketingWorkflow = require('./MarketingWorkflow.model');
const SystemSettings = require('./SystemSettings.model');
const Backup = require('./Backup.model');
const ApiKey = require('./ApiKey.model');
const SystemLog = require('./SystemLog.model');

// Enable virtuals in JSON responses globally
mongoose.set('toJSON', { virtuals: true });
mongoose.set('toObject', { virtuals: true });

// Export all models
module.exports = {
  User,
  Admin,
  Vendor,
  Product,
  Category,
  Rental,
  Payment,
  Inventory,
  Address,
  Delivery,
  Maintenance,
  Review,
  Discount,
  Notification,
  AuditLog,
  SupportTicket,
  AdminActivity,
  Cart,
  DeliveryPerson,
  DeliveryTeam,
  DispatchBatch,
  Banner,
  Wishlist,
  UserBehaviorEvent,
  ProductInterest,
  CustomerSegment,
  EmailTemplate,
  EmailCampaign,
  MarketingWorkflow,
  SystemSettings,
  // Utility function to setup all indexes
  setupIndexes: async () => {
    console.log('Creating database indexes...');
    const models = [
      User, Admin, Vendor, Product, Category, Rental,
      Payment, Inventory, Address, Delivery, Maintenance,
      Review, Discount, Notification, AuditLog, SupportTicket,
      AdminActivity, Cart, DeliveryPerson, DeliveryTeam, DispatchBatch, Banner,
      Wishlist, UserBehaviorEvent, ProductInterest, CustomerSegment,
      EmailTemplate, EmailCampaign, MarketingWorkflow, SystemSettings,
      Backup, ApiKey, SystemLog,
    ];

    for (const model of models) {
      try {
        await model.createIndexes();
        console.log(`  ✓ Indexes created for ${model.modelName}`);
      } catch (error) {
        console.error(`  ✗ Error creating indexes for ${model.modelName}:`, error.message);
      }
    }
    console.log('All indexes created successfully');
  },
  
  // Utility function to check database connection
  checkConnection: () => {
    return mongoose.connection.readyState === 1;
  },
  
  // Get model by name
  getModel: (name) => {
    const models = {
      User, Admin, Vendor, Product, Category, Rental,
      Payment, Inventory, Address, Delivery, Maintenance,
      Review, Discount, Notification, AuditLog, SupportTicket,
      AdminActivity, Cart, DeliveryPerson, DeliveryTeam,
      DispatchBatch, Banner, Wishlist, SystemSettings,
      UserBehaviorEvent, ProductInterest, CustomerSegment,
      EmailTemplate, EmailCampaign, MarketingWorkflow,
      Backup, ApiKey, SystemLog,
    };
    return models[name];
  },
  
  // List all model names
  listModels: () => {
    return Object.keys(module.exports).filter(
      key => !['setupIndexes', 'checkConnection', 'getModel', 'listModels'].includes(key)
    );
  }
};