const express = require('express');
const router = express.Router();
const smsSettingsController = require('../../controllers/sms-settings.controller');
const { protectAdmin, restrictTo } = require('../../middlewares/admin-auth.middleware');

// All routes require admin authentication and super_admin or admin role
router.use(protectAdmin);
router.use(restrictTo('super_admin', 'admin'));

// GET / -> getSmsSettings
router.get('/', smsSettingsController.getSmsSettings);
router.get('/usage', smsSettingsController.getSmsSettings);
router.put('/twilio', smsSettingsController.updateTwilioSettings);
router.post('/test', smsSettingsController.testSms);
router.put('/templates/:id', smsSettingsController.updateTemplate);
router.get('/balance', smsSettingsController.getSmsBalance);

module.exports = router;
