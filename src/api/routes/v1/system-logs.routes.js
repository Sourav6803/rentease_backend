const express = require('express');
const router = express.Router();
const systemLogsController = require('../../controllers/system-logs.controller');
const { protectAdmin } = require('../../middlewares/admin-auth.middleware');

router.use(protectAdmin);

router.get('/stats', systemLogsController.getLogStats);
router.get('/export', systemLogsController.exportLogs);
router.delete('/clear', systemLogsController.clearLogs);
router.get('/:type', systemLogsController.getLogs);
router.patch('/errors/:id/resolve', systemLogsController.resolveError);

module.exports = router;
