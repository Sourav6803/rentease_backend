#!/usr/bin/env node

/**
 * Database Backup Script
 * Usage: npm run backup
 * Options:
 *   --type=full - full backup (default)
 *   --type=partial - partial backup (collections specified)
 *   --compress - compress backup
 *   --upload - upload to cloud storage
 *   --retain=7 - number of backups to retain
 */

const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const moment = require('moment');
const chalk = require('chalk');
const commandLineArgs = require('command-line-args');
const AWS = require('aws-sdk');
const { mongoose } = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const logger = console;

// Command line options
const options = commandLineArgs([
  { name: 'type', type: String, defaultValue: 'full' },
  { name: 'compress', type: Boolean, defaultValue: true },
  { name: 'upload', type: Boolean, defaultValue: false },
  { name: 'retain', type: Number, defaultValue: 7 },
  { name: 'collections', type: String, multiple: true, defaultOption: true },
  { name: 'help', type: Boolean, defaultValue: false },
]);

if (options.help) {
  console.log(`
  Usage: node scripts/backup.js [options]

  Options:
    --type=full         Backup type: full or partial
    --compress          Compress backup (default: true)
    --upload           Upload to cloud storage
    --retain=7         Number of backups to retain
    --collections      Collections to backup (for partial backup)
    --help             Show this help message

  Examples:
    node scripts/backup.js --type=full --compress --upload
    node scripts/backup.js --type=partial --collections users products rentals
  `);
  process.exit(0);
}

// Configuration
const config = {
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/rentease',
  dbName: process.env.MONGODB_URI ? process.env.MONGODB_URI.split('/').pop().split('?')[0] : 'rentease',
  backupDir: path.join(__dirname, '../backups'),
  timestamp: moment().format('YYYY-MM-DD_HH-mm-ss'),
  compress: options.compress,
  upload: options.upload,
  retain: options.retain,
  type: options.type,
  collections: options.collections || [],
};

// AWS S3 configuration (if upload enabled)
if (config.upload) {
  AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'ap-south-1',
  });
  config.s3Bucket = process.env.AWS_BACKUP_BUCKET || 'rentease-backups';
  config.s3 = new AWS.S3();
}

// Ensure backup directory exists
fs.ensureDirSync(config.backupDir);

// Create backup filename
const getBackupFileName = () => {
  const type = config.type === 'full' ? 'full' : 'partial';
  const collections = config.collections.length ? `-${config.collections.join('-')}` : '';
  return `${config.dbName}_${type}${collections}_${config.timestamp}`;
};

// Create full backup using mongodump
const createFullBackup = () => {
  return new Promise((resolve, reject) => {
    const backupPath = path.join(config.backupDir, getBackupFileName());
    logger.log(chalk.blue(`\n📀 Creating full backup: ${backupPath}`));

    const args = [
      '--uri', config.mongodbUri,
      '--out', backupPath,
      '--gzip',
    ];

    const mongodump = spawn('mongodump', args);

    mongodump.stdout.on('data', (data) => {
      logger.log(chalk.gray(data.toString()));
    });

    mongodump.stderr.on('data', (data) => {
      logger.error(chalk.red(data.toString()));
    });

    mongodump.on('close', (code) => {
      if (code === 0) {
        logger.log(chalk.green(`✅ Full backup created successfully: ${backupPath}`));
        resolve(backupPath);
      } else {
        reject(new Error(`mongodump failed with code ${code}`));
      }
    });
  });
};

// Create partial backup for specific collections
const createPartialBackup = async () => {
  const backupName = getBackupFileName();
  const backupPath = path.join(config.backupDir, backupName);
  fs.ensureDirSync(backupPath);

  logger.log(chalk.blue(`\n📀 Creating partial backup for collections: ${config.collections.join(', ')}`));

  // Connect to MongoDB
  await mongoose.connect(config.mongodbUri);
  logger.log(chalk.green('✅ Connected to MongoDB'));

  const results = [];

  for (const collectionName of config.collections) {
    try {
      const collection = mongoose.connection.collection(collectionName);
      const documents = await collection.find().toArray();
      
      const filePath = path.join(backupPath, `${collectionName}.json`);
      await fs.writeJson(filePath, documents, { spaces: 2 });
      
      logger.log(chalk.green(`  ✓ Backed up ${collectionName}: ${documents.length} documents`));
      results.push({ collection: collectionName, count: documents.length });
    } catch (error) {
      logger.error(chalk.red(`  ✗ Failed to backup ${collectionName}:`, error.message));
    }
  }

  await mongoose.disconnect();
  logger.log(chalk.green(`✅ Partial backup created successfully: ${backupPath}`));
  
  return { backupPath, results };
};

// Compress backup
const compressBackup = async (backupPath) => {
  if (!config.compress) return backupPath;

  const zipPath = `${backupPath}.zip`;
  logger.log(chalk.blue(`\n🗜️  Compressing backup to: ${zipPath}`));

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      logger.log(chalk.green(`✅ Backup compressed: ${archive.pointer()} total bytes`));
      
      // Remove uncompressed directory
      fs.removeSync(backupPath);
      logger.log(chalk.gray(`  Removed uncompressed directory: ${backupPath}`));
      
      resolve(zipPath);
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);
    archive.directory(backupPath, false);
    archive.finalize();
  });
};

// Upload to S3
const uploadToS3 = async (filePath) => {
  if (!config.upload) return;

  const fileName = path.basename(filePath);
  const s3Key = `backups/${config.dbName}/${fileName}`;

  logger.log(chalk.blue(`\n☁️  Uploading to S3: ${s3Key}`));

  try {
    const fileContent = await fs.readFile(filePath);
    
    const params = {
      Bucket: config.s3Bucket,
      Key: s3Key,
      Body: fileContent,
      StorageClass: 'STANDARD_IA', // Infrequent Access for backups
      Metadata: {
        database: config.dbName,
        timestamp: config.timestamp,
        type: config.type,
        compressed: String(config.compress),
      },
    };

    const result = await config.s3.upload(params).promise();
    logger.log(chalk.green(`✅ Backup uploaded to S3: ${result.Location}`));
    
    return result;
  } catch (error) {
    logger.error(chalk.red('✗ Failed to upload to S3:'), error);
    throw error;
  }
};

// Clean old backups
const cleanOldBackups = async () => {
  logger.log(chalk.blue(`\n🧹 Cleaning backups older than ${config.retain} days...`));

  const files = await fs.readdir(config.backupDir);
  const now = moment();

  let deletedCount = 0;

  for (const file of files) {
    const filePath = path.join(config.backupDir, file);
    const stats = await fs.stat(filePath);
    const fileAge = moment.duration(now.diff(stats.mtime)).asDays();

    if (fileAge > config.retain) {
      await fs.remove(filePath);
      logger.log(chalk.yellow(`  Deleted old backup: ${file} (${Math.round(fileAge)} days old)`));
      deletedCount++;
    }
  }

  logger.log(chalk.green(`✅ Cleaned ${deletedCount} old backups`));
};

// List available backups
const listBackups = async () => {
  const files = await fs.readdir(config.backupDir);
  
  logger.log(chalk.blue('\n📋 Available backups:'));
  
  for (const file of files) {
    const filePath = path.join(config.backupDir, file);
    const stats = await fs.stat(filePath);
    const size = (stats.size / (1024 * 1024)).toFixed(2);
    const modified = moment(stats.mtime).format('YYYY-MM-DD HH:mm:ss');
    
    logger.log(chalk.white(`  ${file} (${size} MB) - ${modified}`));
  }
};

// Main backup function
const runBackup = async () => {
  try {
    logger.log(chalk.blue('\n💾 Starting database backup...'));
    logger.log(chalk.gray(`Database: ${config.dbName}`));
    logger.log(chalk.gray(`Type: ${config.type}`));
    logger.log(chalk.gray(`Compress: ${config.compress}`));
    logger.log(chalk.gray(`Upload: ${config.upload}`));

    let backupPath;

    if (config.type === 'full') {
      backupPath = await createFullBackup();
    } else {
      const result = await createPartialBackup();
      backupPath = result.backupPath;
    }

    if (config.compress) {
      backupPath = await compressBackup(backupPath);
    }

    if (config.upload) {
      await uploadToS3(backupPath);
    }

    await cleanOldBackups();
    await listBackups();

    // Get backup size
    const stats = await fs.stat(backupPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    logger.log(chalk.green('\n✅ Backup completed successfully!'));
    logger.log(chalk.white(`\n📊 Backup Summary:`));
    logger.log(chalk.white(`  File: ${path.basename(backupPath)}`));
    logger.log(chalk.white(`  Size: ${sizeMB} MB`));
    logger.log(chalk.white(`  Location: ${backupPath}`));

    process.exit(0);
  } catch (error) {
    logger.error(chalk.red('\n❌ Backup failed:'), error);
    process.exit(1);
  }
};

// Run backup
runBackup();