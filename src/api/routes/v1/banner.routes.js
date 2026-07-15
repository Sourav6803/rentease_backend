// routes/banner.routes.js
const express = require('express');
const router = express.Router();
const bannerController = require('../../controllers/banner.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');

// ==================== PUBLIC ROUTES ====================

// All live homepage banners grouped by type (hero/promo/strip/deal)
router.get('/', bannerController.getHomeBanners);

// Live banners of a single type
router.get('/type/:type', bannerController.getBannersByType);

// Track a click / impression (best-effort)
router.post('/:id/track', bannerController.trackEvent);

// AI Banner prompt (editable template shown in the admin UI)
router.get('/ai-prompt', bannerController.getBannerPromptPreview);

// AI Banner image generation
router.post('/ai-generate', bannerController.generateAIBannerImagePreview);

router.use(protect);
router.use('/admin', restrictTo('admin', 'super-admin'));

router.get('/admin', bannerController.getAllBanners);
router.post('/admin', bannerController.createBanner);
router.get('/admin/:id', bannerController.getBanner);
router.put('/admin/:id', bannerController.updateBanner);
router.patch('/admin/:id/status', bannerController.toggleStatus);
router.delete('/admin/:id', bannerController.deleteBanner);

module.exports = router;
