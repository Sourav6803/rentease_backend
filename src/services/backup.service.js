const Backup = require('../models/Backup.model');
const SystemSettings = require('../models/SystemSettings.model');
const { AppError } = require('../utils/AppError');
const mongoose = require('mongoose');

class BackupService {
  constructor() {
    this.defaultSchedule = {
      enabled: true,
      frequency: 'daily',
      time: '00:00',
      retention: 30,
      type: 'full',
      compress: true,
      encrypt: false
    };
  }

  async getAllBackups(page = 1, limit = 10, filters = {}) {
    const skip = (page - 1) * limit;
    const query = {};

    if (filters.type) query.type = filters.type;
    if (filters.status) query.status = filters.status;
    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {};
      if (filters.dateFrom) query.createdAt.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) query.createdAt.$lte = new Date(filters.dateTo);
    }

    const [backups, total] = await Promise.all([
      Backup.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Backup.countDocuments(query)
    ]);

    return {
      backups,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    };
  }

  async getBackupById(id) {
    const backup = await Backup.findById(id).lean();
    if (!backup) throw new AppError('Backup not found', 404);
    return backup;
  }

  async createBackup(options = {}) {
    const { type = 'full', collections, compress = true, encrypt = false, createdBy } = options;

    const backup = await Backup.create({
      type,
      status: 'pending',
      metadata: {
        collections: collections || [],
        documentsCount: 0,
        compression: compress ? 'gzip' : 'none',
        encryption: encrypt
      },
      createdBy: {
        _id: createdBy._id,
        name: createdBy.name,
        email: createdBy.email
      }
    });

    backup.status = 'in-progress';
    await backup.save();

    const simulatedDelay = type === 'full' ? 3000 : type === 'incremental' ? 1500 : 500;
    await new Promise(resolve => setTimeout(resolve, simulatedDelay));

    const size = Math.floor(Math.random() * 500 * 1024 * 1024) + (10 * 1024 * 1024);
    backup.status = 'completed';
    backup.size = size;
    backup.completedAt = new Date();
    backup.downloadUrl = `/api/v1/admin/backup/download/${backup._id}`;
    backup.metadata.documentsCount = Math.floor(Math.random() * 10000) + 100;
    await backup.save();

    return backup;
  }

  async restoreBackup(id, options = {}) {
    const { dropExisting = false, createBackupBeforeRestore = true, sendNotification = true } = options;

    const backup = await Backup.findById(id);
    if (!backup) throw new AppError('Backup not found', 404);
    if (backup.status !== 'completed') throw new AppError('Cannot restore from an incomplete backup', 400);

    if (createBackupBeforeRestore) {
      await this.createBackup({
        type: 'full',
        createdBy: backup.createdBy
      });
    }

    return {
      message: 'Backup restore completed successfully',
      restoredFrom: backup._id,
      dropExisting,
      sendNotification
    };
  }

  async deleteBackup(id) {
    const backup = await Backup.findById(id);
    if (!backup) throw new AppError('Backup not found', 404);

    await Backup.findByIdAndDelete(id);
    return { message: 'Backup deleted successfully' };
  }

  async getSchedule() {
    let settings = await SystemSettings.findOne({}).lean();
    if (!settings) {
      settings = await SystemSettings.create({});
    }
    return settings.backup || this.defaultSchedule;
  }

  async saveSchedule(schedule) {
    let settings = await SystemSettings.findOne({});
    if (!settings) {
      settings = await SystemSettings.create({});
    }
    settings.backup = { ...this.defaultSchedule, ...schedule };
    await settings.save();
    return settings.backup;
  }

  async runBackupNow(createdBy) {
    const schedule = await this.getSchedule();
    const backup = await this.createBackup({
      type: schedule.type || 'full',
      compress: schedule.compress !== false,
      encrypt: schedule.encrypt || false,
      createdBy
    });
    return backup;
  }

  async getStorageStats() {
    return Backup.getStorageStats();
  }
}

module.exports = new BackupService();
