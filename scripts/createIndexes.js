#!/usr/bin/env node

/**
 * Database Index Creation Script
 * Usage: npm run create-indexes
 * Options:
 *   --drop - drop existing indexes first
 *   --collection=users - specific collection
 */

const mongoose = require('mongoose');
const chalk = require('chalk');
const commandLineArgs = require('command-line-args');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const logger = console;

// Command line options
const options = commandLineArgs([
  { name: 'drop', type: Boolean, defaultValue: false },
  { name: 'collection', type: String },
  { name: 'help', type: Boolean, defaultValue: false },
]);

if (options.help) {
  console.log(`
  Usage: node scripts/createIndexes.js [options]

  Options:
    --drop             Drop existing indexes before creating
    --collection=name  Specific collection to index
    --help            Show this help message

  Examples:
    node scripts/createIndexes.js
    node scripts/createIndexes.js --collection=users
    node scripts/createIndexes.js --drop
  `);
  process.exit(0);
}

// Configuration
const config = {
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/rentease',
};

// Define indexes for each collection
const indexDefinitions = {
  users: [
    { keys: { email: 1 }, options: { unique: true, background: true } },
    { keys: { phone: 1 }, options: { unique: true, background: true } },
    { keys: { role: 1, 'status.isActive': 1 }, options: { background: true } },
    { keys: { 'profile.firstName': 'text', 'profile.lastName': 'text', email: 'text' }, options: { background: true } },
    { keys: { createdAt: -1 }, options: { background: true } },
    { keys: { 'verification.kyc.status': 1 }, options: { background: true } },
    { keys: { 'stats.lastActive': -1 }, options: { background: true, expireAfterSeconds: 7776000 } }, // 90 days
  ],

  vendors: [
    { keys: { user: 1 }, options: { unique: true, background: true } },
    { keys: { vendorId: 1 }, options: { unique: true, background: true } },
    { keys: { 'business.gstin': 1 }, options: { sparse: true, background: true } },
    { keys: { 'verification.status': 1, status: 1 }, options: { background: true } },
    { keys: { 'addresses.serviceablePincodes': 1 }, options: { background: true } },
    { keys: { 'performance.rating.average': -1 }, options: { background: true } },
    { keys: { 'subscription.plan': 1, 'subscription.validUntil': 1 }, options: { background: true } },
  ],

  admins: [
    { keys: { email: 1 }, options: { unique: true, background: true } },
    { keys: { user: 1 }, options: { sparse: true, unique: true, background: true } },
    { keys: { role: 1, 'status.isActive': 1 }, options: { background: true } },
    { keys: { 'profile.department': 1 }, options: { background: true } },
    { keys: { 'activity.lastActive': -1 }, options: { background: true } },
  ],

  products: [
    { keys: { vendor: 1 }, options: { background: true } },
    { keys: { category: 1 }, options: { background: true } },
    { keys: { 'basicInfo.slug': 1 }, options: { unique: true, background: true } },
    { keys: { 'basicInfo.sku': 1 }, options: { sparse: true, unique: true, background: true } },
    { keys: { 'pricing.monthlyRent': 1 }, options: { background: true } },
    { keys: { condition: 1, 'status.isActive': 1 }, options: { background: true } },
    { keys: { 'basicInfo.name': 'text', 'basicInfo.description': 'text', tags: 'text' }, options: { background: true } },
    { keys: { 'ratings.average': -1 }, options: { background: true } },
    { keys: { 'inventory.availableQuantity': 1 }, options: { background: true } },
    { keys: { 'rentalTerms.serviceablePincodes': 1 }, options: { background: true } },
    { keys: { createdAt: -1 }, options: { background: true } },
    { keys: { 'status.isFeatured': 1, 'ratings.average': -1 }, options: { background: true } },
  ],

  categories: [
    { keys: { slug: 1 }, options: { unique: true, background: true } },
    { keys: { parent: 1, displayOrder: 1 }, options: { background: true } },
    { keys: { isActive: 1 }, options: { background: true } },
    { keys: { 'ancestors._id': 1 }, options: { background: true } },
  ],

  rentals: [
    { keys: { rentalNumber: 1 }, options: { unique: true, background: true } },
    { keys: { user: 1, status: 1 }, options: { background: true } },
    { keys: { vendor: 1, status: 1 }, options: { background: true } },
    { keys: { product: 1 }, options: { background: true } },
    { keys: { inventory: 1 }, options: { sparse: true, background: true } },
    { keys: { 'rentalDetails.startDate': 1, 'rentalDetails.endDate': 1 }, options: { background: true } },
    { keys: { 'payment.status': 1, 'payment.nextDueDate': 1 }, options: { background: true } },
    { keys: { status: 1, 'rentalDetails.endDate': 1 }, options: { background: true } },
    { keys: { createdAt: -1 }, options: { background: true } },
    { keys: { 'timeline.timestamp': -1 }, options: { background: true } },
  ],

  payments: [
    { keys: { paymentNumber: 1 }, options: { unique: true, background: true } },
    { keys: { user: 1, createdAt: -1 }, options: { background: true } },
    { keys: { rental: 1, type: 1 }, options: { background: true } },
    { keys: { status: 1, createdAt: 1 }, options: { background: true } },
    { keys: { 'timestamps.completed': -1 }, options: { background: true } },
    { keys: { method: 1, status: 1 }, options: { background: true } },
  ],

  inventory: [
    { keys: { sku: 1 }, options: { unique: true, background: true } },
    { keys: { product: 1, status: 1 }, options: { background: true } },
    { keys: { serialNumber: 1 }, options: { sparse: true, unique: true, background: true } },
    { keys: { 'location.pincode': 1, status: 1 }, options: { background: true } },
    { keys: { 'condition.nextInspectionDate': 1 }, options: { background: true } },
    { keys: { 'purchaseInfo.warrantyExpiry': 1 }, options: { background: true } },
  ],

  addresses: [
    { keys: { user: 1, isDefault: 1 }, options: { background: true } },
    { keys: { pincode: 1, city: 1 }, options: { background: true } },
    { keys: { 'coordinates.coordinates': '2dsphere' }, options: { background: true } },
    { keys: { 'status.isActive': 1, user: 1 }, options: { background: true } },
  ],

  reviews: [
    { keys: { reviewNumber: 1 }, options: { unique: true, background: true } },
    { keys: { rental: 1 }, options: { unique: true, background: true } },
    { keys: { product: 1, 'moderation.status': 1, createdAt: -1 }, options: { background: true } },
    { keys: { user: 1, createdAt: -1 }, options: { background: true } },
    { keys: { vendor: 1, 'ratings.overall': 1 }, options: { background: true } },
    { keys: { 'ratings.overall': 1, 'helpful.count': -1 }, options: { background: true } },
    { keys: { 'verification.isVerifiedPurchase': 1 }, options: { background: true } },
  ],

  deliveries: [
    { keys: { deliveryNumber: 1 }, options: { unique: true, background: true } },
    { keys: { rental: 1, type: 1 }, options: { background: true } },
    { keys: { 'schedule.scheduledDate': 1, status: 1 }, options: { background: true } },
    { keys: { deliveryPerson: 1, status: 1 }, options: { background: true } },
    { keys: { 'tracking.currentLocation': '2dsphere' }, options: { background: true } },
    { keys: { 'address.pincode': 1, status: 1 }, options: { background: true } },
  ],

  maintenance: [
    { keys: { requestNumber: 1 }, options: { unique: true, background: true } },
    { keys: { rental: 1, status: 1 }, options: { background: true } },
    { keys: { assignedTo: 1, status: 1 }, options: { background: true } },
    { keys: { priority: 1, status: 1, createdAt: 1 }, options: { background: true } },
    { keys: { 'schedule.scheduledDate': 1, status: 1 }, options: { background: true } },
    { keys: { vendor: 1, status: 1 }, options: { background: true } },
  ],

  discounts: [
    { keys: { code: 1 }, options: { unique: true, background: true } },
    { keys: { status: 1, 'validity.startDate': 1, 'validity.endDate': 1 }, options: { background: true } },
    { keys: { 'applicableOn.categoryIds': 1 }, options: { background: true } },
    { keys: { 'applicableOn.productIds': 1 }, options: { background: true } },
    { keys: { 'userEligibility.userIds': 1 }, options: { background: true } },
  ],

  notifications: [
    { keys: { notificationNumber: 1 }, options: { unique: true, background: true } },
    { keys: { user: 1, createdAt: -1 }, options: { background: true } },
    { keys: { user: 1, status: 1, createdAt: -1 }, options: { background: true } },
    { keys: { type: 1, status: 1, 'schedule.scheduledFor': 1 }, options: { background: true } },
    { keys: { expiryDate: 1 }, options: { expireAfterSeconds: 0, background: true } },
  ],

  auditlogs: [
    { keys: { timestamp: -1 }, options: { background: true } },
    { keys: { user: 1, timestamp: -1 }, options: { background: true } },
    { keys: { action: 1, timestamp: -1 }, options: { background: true } },
    { keys: { 'resource.type': 1, 'resource.id': 1 }, options: { background: true } },
    { keys: { 'metadata.ipAddress': 1, timestamp: -1 }, options: { background: true } },
    { keys: { timestamp: 1 }, options: { expireAfterSeconds: 7776000, background: true } }, // 90 days
  ],

  supporttickets: [
    { keys: { ticketNumber: 1 }, options: { unique: true, background: true } },
    { keys: { assignedTo: 1, status: 1 }, options: { background: true } },
    { keys: { priority: 1, status: 1, createdAt: 1 }, options: { background: true } },
    { keys: { 'relatedTo.id': 1, 'relatedTo.type': 1 }, options: { background: true } },
    { keys: { createdBy: 1, createdAt: -1 }, options: { background: true } },
  ],

  adminactivities: [
    { keys: { admin: 1, createdAt: -1 }, options: { background: true } },
    { keys: { action: 1, createdAt: -1 }, options: { background: true } },
    { keys: { 'resource.type': 1, 'resource.id': 1 }, options: { background: true } },
    { keys: { ipAddress: 1, createdAt: -1 }, options: { background: true } },
  ],
};

// Drop all indexes for a collection
const dropIndexes = async (collection) => {
  try {
    const indexes = await collection.indexes();
    const systemIndexes = ['_id_'];
    
    for (const index of indexes) {
      if (!systemIndexes.includes(index.name)) {
        await collection.dropIndex(index.name);
        logger.log(chalk.yellow(`  Dropped index: ${index.name}`));
      }
    }
  } catch (error) {
    logger.error(chalk.red(`  Error dropping indexes: ${error.message}`));
  }
};

// Create indexes for a collection
const createIndexesForCollection = async (db, collectionName) => {
  const definitions = indexDefinitions[collectionName];
  if (!definitions) {
    logger.log(chalk.yellow(`  No index definitions for ${collectionName}`));
    return;
  }

  const collection = db.collection(collectionName);
  
  // Check if collection exists
  const collections = await db.listCollections({ name: collectionName }).toArray();
  if (collections.length === 0) {
    logger.log(chalk.yellow(`  Collection ${collectionName} does not exist, skipping...`));
    return;
  }

  logger.log(chalk.blue(`\n📦 Processing collection: ${collectionName}`));

  // Drop existing indexes if requested
  if (options.drop) {
    logger.log(chalk.yellow(`  Dropping existing indexes...`));
    await dropIndexes(collection);
  }

  // Create indexes
  let created = 0;
  for (const def of definitions) {
    try {
      const indexName = await collection.createIndex(def.keys, def.options);
      logger.log(chalk.green(`  ✓ Created index: ${indexName}`));
      created++;
    } catch (error) {
      if (error.code === 85) { // Index already exists
        logger.log(chalk.yellow(`  ⚠ Index already exists: ${JSON.stringify(def.keys)}`));
      } else {
        logger.error(chalk.red(`  ✗ Failed to create index: ${error.message}`));
      }
    }
  }

  logger.log(chalk.green(`  ✅ Created ${created} indexes for ${collectionName}`));
  return created;
};

// Main function
const createIndexes = async () => {
  try {
    logger.log(chalk.blue('\n🔧 Starting database index creation...'));
    
    // Connect to MongoDB
    await mongoose.connect(config.mongodbUri);
    const db = mongoose.connection.db;
    logger.log(chalk.green('✅ Connected to MongoDB'));

    let totalIndexes = 0;
    let collectionsProcessed = 0;

    if (options.collection) {
      // Process single collection
      logger.log(chalk.blue(`\nProcessing single collection: ${options.collection}`));
      const count = await createIndexesForCollection(db, options.collection);
      totalIndexes += count || 0;
      collectionsProcessed++;
    } else {
      // Process all collections
      for (const collectionName of Object.keys(indexDefinitions)) {
        const count = await createIndexesForCollection(db, collectionName);
        totalIndexes += count || 0;
        collectionsProcessed++;
      }
    }

    // Show summary
    logger.log(chalk.blue('\n📊 Index Creation Summary:'));
    logger.log(chalk.white(`  Collections Processed: ${collectionsProcessed}`));
    logger.log(chalk.white(`  Total Indexes Created: ${totalIndexes}`));
    logger.log(chalk.white(`  Drop Existing: ${options.drop ? 'Yes' : 'No'}`));

    // Get final index stats
    logger.log(chalk.blue('\n📈 Final Index Statistics:'));
    for (const collectionName of (options.collection ? [options.collection] : Object.keys(indexDefinitions))) {
      const collection = db.collection(collectionName);
      const indexes = await collection.indexes();
      logger.log(chalk.white(`  ${collectionName}: ${indexes.length} indexes`));
    }

    await mongoose.disconnect();
    logger.log(chalk.green('\n✅ Index creation completed successfully!'));
    process.exit(0);
  } catch (error) {
    logger.error(chalk.red('\n❌ Index creation failed:'), error);
    process.exit(1);
  }
};

// Run index creation
createIndexes();