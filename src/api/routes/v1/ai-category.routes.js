
const express = require('express');
const router = express.Router();
const aiCategoryController = require('../../controllers/ai-category.controller');
const { protect, restrictTo } = require('../../middlewares/auth.middleware');

// All routes require admin authentication
// router.use(protect);
// router.use(restrictTo('admin', 'super-admin'));

// ==================== CATEGORY GENERATION ====================

// Generate category suggestions
router.post('/generate', aiCategoryController.generateSuggestions);

// Generate single icon
router.post('/generate-icon', aiCategoryController.generateIcon);

// Generate multiple icon variations
router.post('/generate-icon-variations', aiCategoryController.generateIconVariations);

// Regenerate icon with different style
router.post('/regenerate-icon', aiCategoryController.regenerateIcon);

// Get available icon styles
router.get('/icon-styles/:categoryName', aiCategoryController.getIconStyles);

// Get icon generation status
router.get('/icon-status/:taskId', aiCategoryController.getIconStatus);

// Save AI-generated category
router.post('/save', aiCategoryController.saveCategory);

// ==================== BULK OPERATIONS ====================

// Generate bulk categories
router.post('/bulk-generate', aiCategoryController.generateBulkCategories);

// ==================== CATEGORY ANALYTICS ====================

// Track category performance
router.get('/track/:categoryId', aiCategoryController.trackPerformance);

// Get category trends
router.get('/trends/:categoryId', aiCategoryController.getTrends);

// Get category recommendations
router.get('/recommendations/:categoryId', aiCategoryController.getRecommendations);

module.exports = router;