const express = require('express');
const router = express.Router();
const emailSettingsController = require('../../controllers/email-settings.controller');
const { protectAdmin, restrictTo } = require('../../middlewares/admin-auth.middleware');

// All routes require admin authentication and super_admin or admin role
router.use(protectAdmin);
router.use(restrictTo('super_admin', 'admin'));

router.get('/', emailSettingsController.getEmailSettings);
router.put('/smtp', emailSettingsController.updateSmtpSettings);
router.post('/test', emailSettingsController.testEmail);
router.put('/templates/:id', emailSettingsController.updateTemplate);

module.exports = router;
