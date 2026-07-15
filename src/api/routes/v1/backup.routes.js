const express = require('express');
const router = express.Router();
const backupController = require('../../controllers/backup.controller');
const { protectAdmin } = require('../../middlewares/admin-auth.middleware');

router.use(protectAdmin);

// More specific routes first
router.get('/stats', backupController.getStorageStats);
router.get('/schedule', backupController.getSchedule);
router.get('/download/:id', backupController.getBackupDownload);
router.get('/list', backupController.getBackups);
router.get('/', backupController.getBackups);
router.get('/:id', backupController.getBackup);
router.post('/create', backupController.createBackup);
router.post('/restore/:id', backupController.restoreBackup);
router.delete('/:id', backupController.deleteBackup);
router.put('/schedule', backupController.saveSchedule);
router.post('/run-now', backupController.runBackupNow);

module.exports = router;
