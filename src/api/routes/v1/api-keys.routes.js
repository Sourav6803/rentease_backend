const express = require('express');
const router = express.Router();
const apiKeysController = require('../../controllers/api-keys.controller');
const { protectAdmin } = require('../../middlewares/admin-auth.middleware');

router.use(protectAdmin);

router.get('/stats', apiKeysController.getApiKeyStats);
router.post('/:id/regenerate', apiKeysController.regenerateApiKey);
router.delete('/:id', apiKeysController.revokeApiKey);
router.post('/', apiKeysController.createApiKey);
router.get('/', apiKeysController.getApiKeys);

module.exports = router;
