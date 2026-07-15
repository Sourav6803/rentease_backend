const backupService = require('../../services/backup.service');
const catchAsync = require('../../utils/catchAsync');
const {ApiResponse} = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const fs = require('fs');

class BackupController {
  getBackups = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    const result = await backupService.getAllBackups(parseInt(page), parseInt(limit), filters);
    return ApiResponse.paginated(res, result.backups, parseInt(page), parseInt(limit), result.pagination.total, 'Backups retrieved successfully');
  });

  getBackup = catchAsync(async (req, res) => {
    const { id } = req.params;
    const backup = await backupService.getBackupById(id);
    return ApiResponse.success(res, 200, 'Backup retrieved successfully', backup);
  });

  getBackupDownload = catchAsync(async (req, res) => {
    const { id } = req.params;
    const backup = await backupService.getBackupById(id);
    if (!backup) throw new AppError('Backup not found', 404);

    // For simulated backups, generate a mock file
    const downloadPath = backup.downloadPath || `/tmp/backups/backup-${backup._id}.tar.gz`;

    // Since backups are simulated, we'll send a mock response
    const mockContent = `Mock backup file for ${backup.name}`;
    const buffer = Buffer.from(mockContent);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="backup-${backup._id}.tar.gz"`);
    res.send(buffer);
  });

  createBackup = catchAsync(async (req, res) => {
    const backup = await backupService.createBackup({
      ...req.body,
      createdBy: { _id: req.admin._id, name: req.admin.profile?.firstName + ' ' + req.admin.profile?.lastName, email: req.admin.email }
    });
    return ApiResponse.created(res, 'Backup created successfully', backup);
  });

  restoreBackup = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await backupService.restoreBackup(id, req.body || {});
    return ApiResponse.success(res, 200, result.message, result);
  });

  deleteBackup = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await backupService.deleteBackup(id);
    return ApiResponse.success(res, 200, result.message);
  });

  getSchedule = catchAsync(async (req, res) => {
    const schedule = await backupService.getSchedule();
    return ApiResponse.success(res, 200, 'Backup schedule retrieved successfully', { schedule });
  });

  saveSchedule = catchAsync(async (req, res) => {
    const schedule = await backupService.saveSchedule(req.body);
    return ApiResponse.success(res, 200, 'Backup schedule updated successfully', { schedule });
  });

  runBackupNow = catchAsync(async (req, res) => {
    const backup = await backupService.runBackupNow({ _id: req.admin._id, name: req.admin.profile?.firstName + ' ' + req.admin.profile?.lastName, email: req.admin.email });
    return ApiResponse.created(res, 'Backup started successfully', backup);
  });

  getStorageStats = catchAsync(async (req, res) => {
    const stats = await backupService.getStorageStats();
    return ApiResponse.success(res, 200, 'Storage stats retrieved successfully', stats);
  });
}

module.exports = new BackupController();