const express = require('express');
const router = express.Router();
const searchController = require('../../controllers/search.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { uploadImage } = require('../../middlewares/upload.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');

// ==================== PUBLIC SEARCH ROUTES ====================

// Main search endpoint
router.get('/products', searchController.searchProducts);

// Autocomplete suggestions
router.get('/suggestions', searchController.getSuggestions);

// Fuzzy search
router.get('/fuzzy', searchController.fuzzySearch);

// Vendor search
router.get('/vendors', searchController.searchVendors);

// Global search
router.get('/global', searchController.globalSearch);

// Trending searches
router.get('/trending', searchController.getTrendingSearches);

// Popular searches
router.get('/popular', searchController.getPopularSearches);

// Search facets
router.get('/facets', searchController.getSearchFacets);

// Category-specific suggestions
router.get('/category/:categoryId/suggestions', searchController.getCategorySuggestions);

// ==================== PROTECTED SEARCH ROUTES ====================

// User search history (requires authentication)
router.get('/history', protect, searchController.getUserSearchHistory);
router.delete('/history', protect, searchController.clearSearchHistory);

// Advanced search (requires authentication)
router.post('/advanced', protect, searchController.advancedSearch);

// Image search (requires authentication)
router.post('/image', 
  protect, 
  uploadImage.single('image'),
  searchController.searchByImage
);

// Voice search (requires authentication)
router.post('/voice', protect, searchController.voiceSearch);

// ==================== ADMIN SEARCH ROUTES ====================

// Search analytics (admin only)
router.get('/analytics', 
  protect, 
  restrictTo('admin', 'super-admin'),
  searchController.getSearchAnalytics
);

module.exports = router;