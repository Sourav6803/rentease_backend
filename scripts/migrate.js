#!/usr/bin/env node

/**
 * Database Migration Script
 * Usage: npm run migrate
 * Options:
 *   --direction=up - migrate up (default)
 *   --direction=down - migrate down
 *   --version=1 - specific migration version
 */

const mongoose = require('mongoose');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const commandLineArgs = require('command-line-args');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const logger = console;

// Command line options
const options = commandLineArgs([
  { name: 'direction', type: String, defaultValue: 'up' },
  { name: 'version', type: Number },
  { name: 'create', type: String },
  { name: 'help', type: Boolean, defaultValue: false },
]);

if (options.help) {
  console.log(`
  Usage: node scripts/migrate.js [options]

  Options:
    --direction=up     Migration direction: up or down
    --version=1        Specific migration version to run
    --create=name      Create a new migration file
    --help            Show this help message

  Examples:
    node scripts/migrate.js --direction=up
    node scripts/migrate.js --direction=down --version=1
    node scripts/migrate.js --create=add-product-indexes
  `);
  process.exit(0);
}

// Configuration
const config = {
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/rentease',
  migrationsDir: path.join(__dirname, '../migrations'),
  collectionName: 'migrations',
};

// Ensure migrations directory exists
fs.ensureDirSync(config.migrationsDir);

// Create new migration file
const createMigration = (name) => {
  const timestamp = Date.now();
  const fileName = `${timestamp}_${name.replace(/\s+/g, '_')}.js`;
  const filePath = path.join(config.migrationsDir, fileName);

  const template = `/**
 * Migration: ${name}
 * Created: ${new Date().toISOString()}
 */

module.exports = {
  version: ${timestamp},
  name: '${name}',
  
  async up(db) {
    // Add your migration logic here
    // Example:
    // await db.collection('users').updateMany(
    //   {},
    //   { $set: { newField: 'default' } }
    // );
    
    console.log('Running migration up: ${name}');
  },
  
  async down(db) {
    // Add rollback logic here
    // Example:
    // await db.collection('users').updateMany(
    //   {},
    //   { $unset: { newField: '' } }
    // );
    
    console.log('Running migration down: ${name}');
  }
};
`;

  fs.writeFileSync(filePath, template);
  logger.log(chalk.green(`✅ Created migration file: ${fileName}`));
};

// Get all migration files
const getMigrationFiles = () => {
  const files = fs.readdirSync(config.migrationsDir)
    .filter(f => f.endsWith('.js'))
    .sort();

  return files.map(file => {
    const match = file.match(/^(\d+)_(.+)\.js$/);
    if (!match) return null;
    
    return {
      version: parseInt(match[1]),
      name: match[2],
      file,
      path: path.join(config.migrationsDir, file),
    };
  }).filter(Boolean);
};

// Get executed migrations from database
const getExecutedMigrations = async (db) => {
  const collection = db.collection(config.collectionName);
  const migrations = await collection.find().sort({ version: 1 }).toArray();
  return migrations;
};

// Record migration execution
const recordMigration = async (db, migration, direction) => {
  const collection = db.collection(config.collectionName);
  
  if (direction === 'up') {
    await collection.insertOne({
      version: migration.version,
      name: migration.name,
      executedAt: new Date(),
      duration: migration.duration,
    });
  } else {
    await collection.deleteOne({ version: migration.version });
  }
};

// Run migrations
const runMigrations = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(config.mongodbUri);
    const db = mongoose.connection.db;
    logger.log(chalk.green('✅ Connected to MongoDB'));

    // Get migrations
    const migrations = getMigrationFiles();
    
    if (migrations.length === 0) {
      logger.log(chalk.yellow('No migration files found'));
      process.exit(0);
    }

    // Get executed migrations
    const executed = await getExecutedMigrations(db);
    const executedVersions = executed.map(m => m.version);

    // Filter pending migrations
    const pending = migrations.filter(m => !executedVersions.includes(m.version));

    if (options.direction === 'up') {
      // Run pending migrations
      if (pending.length === 0) {
        logger.log(chalk.green('✅ No pending migrations'));
      } else {
        logger.log(chalk.blue(`\n📦 Running ${pending.length} migrations up...\n`));

        for (const migration of pending) {
          if (options.version && migration.version !== options.version) continue;

          logger.log(chalk.cyan(`  ⚡ Running: ${migration.name} (${migration.version})`));
          
          const startTime = Date.now();
          const mod = require(migration.path);
          
          try {
            await mod.up(db);
            const duration = Date.now() - startTime;
            
            await recordMigration(db, { ...migration, duration }, 'up');
            
            logger.log(chalk.green(`  ✓ Completed in ${duration}ms\n`));
          } catch (error) {
            logger.error(chalk.red(`  ✗ Failed: ${error.message}`));
            throw error;
          }
        }
      }
    } else {
      // Rollback migrations
      const toRollback = migrations
        .filter(m => executedVersions.includes(m.version))
        .reverse();

      if (options.version) {
        const idx = toRollback.findIndex(m => m.version === options.version);
        if (idx === -1) {
          logger.log(chalk.yellow(`Migration version ${options.version} not found in executed migrations`));
          process.exit(0);
        }
        toRollback.splice(0, idx);
      }

      if (toRollback.length === 0) {
        logger.log(chalk.green('✅ No migrations to rollback'));
      } else {
        logger.log(chalk.blue(`\n📦 Rolling back ${toRollback.length} migrations...\n`));

        for (const migration of toRollback) {
          logger.log(chalk.cyan(`  ⚡ Rolling back: ${migration.name} (${migration.version})`));
          
          const startTime = Date.now();
          const mod = require(migration.path);
          
          try {
            await mod.down(db);
            const duration = Date.now() - startTime;
            
            await recordMigration(db, { ...migration, duration }, 'down');
            
            logger.log(chalk.green(`  ✓ Rolled back in ${duration}ms\n`));
          } catch (error) {
            logger.error(chalk.red(`  ✗ Failed: ${error.message}`));
            throw error;
          }
        }
      }
    }

    // Show status
    const finalExecuted = await getExecutedMigrations(db);
    logger.log(chalk.blue('\n📊 Migration Status:'));
    logger.log(chalk.white(`  Total Migrations: ${migrations.length}`));
    logger.log(chalk.white(`  Executed: ${finalExecuted.length}`));
    logger.log(chalk.white(`  Pending: ${migrations.length - finalExecuted.length}`));

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error(chalk.red('\n❌ Migration failed:'), error);
    process.exit(1);
  }
};

// Main function
if (options.create) {
  createMigration(options.create);
} else {
  runMigrations();
}