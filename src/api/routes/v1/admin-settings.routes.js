const express = require('express');
const router = express.Router();
const adminSettingsController = require('../../controllers/admin-settings.controller');
const { protectAdmin } = require('../../middlewares/admin-auth.middleware');

router.use(protectAdmin);

router.get('/', adminSettingsController.getSettings);
router.put('/account', adminSettingsController.updateAccount);
router.put('/notifications', adminSettingsController.updateNotifications);
router.put('/privacy', adminSettingsController.updatePrivacy);
router.put('/appearance', adminSettingsController.updateAppearance);
router.put('/language', adminSettingsController.updateLanguage);
router.put('/security', adminSettingsController.updateSecurity);

module.exports = router;
