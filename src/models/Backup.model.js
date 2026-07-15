const mongoose = require('mongoose');

const backupSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  type: { type: String, enum: ['full', 'incremental', 'schema'], default: 'full', index: true },
  status: { type: String, enum: ['completed', 'failed', 'in-progress', 'pending'], default: 'pending', index: true },
  size: { type: Number, default: 0 },
  completedAt: Date,
  createdBy: {
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true }
  },
  metadata: {
    collections: [{ type: String }],
    documentsCount: { type: Number, default: 0 },
    compression: { type: String, enum: ['gzip', 'none'], default: 'gzip' },
    encryption: { type: Boolean, default: false }
  },
  downloadUrl: String
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

backupSchema.index({ type: 1, status: 1, createdAt: -1 });
backupSchema.index({ createdAt: -1 });

backupSchema.statics.getStorageStats = async function() {
    const backups = await this.find({ status: 'completed' }).lean();
    const totalBackups = backups.length;
    const totalSize = backups.reduce((sum, b) => sum + (b.size || 0), 0);
    const usedSpace = totalSize;
    const availableSpace = 100 * 1024 * 1024 * 1024; // 100 GB

    const backupsByDay = {};
    backups.forEach(b => {
        const day = new Date(b.createdAt).toISOString().split('T')[0];
        if (!backupsByDay[day]) {
            backupsByDay[day] = { count: 0, size: 0 };
        }
        backupsByDay[day].count += 1;
        backupsByDay[day].size += b.size || 0;
    });

    // Convert to array of objects sorted by date ascending
    const backupsByDayArray = Object.entries(backupsByDay)
        .map(([date, { count, size }]) => ({ date, count, size }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    const averageBackupSize = totalBackups > 0 ? Math.round(totalSize / totalBackups) : 0;
    const oldestBackup = backups.length > 0 ? backups[backups.length - 1].createdAt : null;
    const newestBackup = backups.length > 0 ? backups[0].createdAt : null;

    return {
        totalBackups,
        totalSize,
        availableSpace,
        usedSpace,
        backupsByDay: backupsByDayArray,
        averageBackupSize,
        oldestBackup,
        newestBackup
    };
};

const Backup = mongoose.model('Backup', backupSchema);
module.exports = Backup;
