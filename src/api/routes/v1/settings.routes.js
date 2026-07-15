// routes/settings.routes.js
const express = require('express');
const router = express.Router();
const settingsController = require('../../controllers/settings.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');

// All routes require user authentication
router.use(protect);

// Get all settings
router.get('/', settingsController.getSettings);

// Update specific setting sections
router.put('/account', settingsController.updateAccount);
router.put('/notifications', settingsController.updateNotifications);
router.put('/privacy', settingsController.updatePrivacy);
router.put('/appearance', settingsController.updateAppearance);
router.put('/language', settingsController.updateLanguage);
router.put('/security', settingsController.updateSecurity);

// Password management
router.post('/change-password', settingsController.changePassword);

// Account deletion
router.delete('/account', settingsController.deleteAccount);

module.exports = router;