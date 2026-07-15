const SearchService = require('../../services/search.service');
const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');

class SearchController {
  /**
   * Search products
   */
  searchProducts = catchAsync(async (req, res) => {
    const {
      q,
      page = 1,
      limit = 20,
      sort,
      category,
      minPrice,
      maxPrice,
      condition,
      brand,
      inStock,
      rating,
      tags,
      vendor,
      city
    } = req.query;

    const filters = {
      category,
      minPrice,
      maxPrice,
      condition,
      brand,
      inStock,
      rating,
      tags,
      vendor,
      city,
      sort
    };

    // Remove undefined filters
    Object.keys(filters).forEach(key => 
      filters[key] === undefined && delete filters[key]
    );

    const results = await SearchService.searchProducts(
      q,
      filters,
      parseInt(page),
      parseInt(limit)
    );

    // Save search query if user is logged in
    if (req.user) {
      await SearchService.saveSearchQuery(
        req.user._id,
        q,
        results.total
      );
    }

    return ApiResponse.success(res, 200, 'Search results retrieved successfully', results);
  });

  /**
   * Get autocomplete suggestions
   */
  getSuggestions = catchAsync(async (req, res) => {
    const { q, limit = 10 } = req.query;

    if (!q || q.length < 2) {
      return ApiResponse.success(res, 200, 'Suggestions retrieved successfully', { suggestions: [] });
    }

    const suggestions = await SearchService.getSuggestions(q, parseInt(limit));

    return ApiResponse.success(res, 200, 'Suggestions retrieved successfully', { suggestions });
  });

  /**
   * Fuzzy search
   */
  fuzzySearch = catchAsync(async (req, res) => {
    const { q, limit = 20 } = req.query;

    if (!q) {
      throw new AppError('Search query is required', 400);
    }

    const results = await SearchService.fuzzySearch(q, parseInt(limit));

    return ApiResponse.success(res, 200, 'Fuzzy search results retrieved successfully', { results });
  });

  /**
   * Search vendors
   */
  searchVendors = catchAsync(async (req, res) => {
    const {
      q,
      page = 1,
      limit = 20,
      city,
      rating,
      verified
    } = req.query;

    const filters = { city, rating, verified };

    Object.keys(filters).forEach(key => 
      filters[key] === undefined && delete filters[key]
    );

    const results = await SearchService.searchVendors(
      q,
      filters,
      parseInt(page),
      parseInt(limit)
    );

    return ApiResponse.success(res, 200, 'Vendor search results retrieved successfully', results);
  });

  /**
   * Global search across all entities
   */
  globalSearch = catchAsync(async (req, res) => {
    const { q, limit = 10 } = req.query;

    if (!q) {
      throw new AppError('Search query is required', 400);
    }

    const results = await SearchService.globalSearch(q, parseInt(limit));

    return ApiResponse.success(res, 200, 'Global search results retrieved successfully', results);
  });

  /**
   * Get trending searches
   */
  getTrendingSearches = catchAsync(async (req, res) => {
    const { limit = 10 } = req.query;

    const trending = await SearchService.getTrendingSearches(parseInt(limit));

    return ApiResponse.success(res, 200, 'Trending searches retrieved successfully', { trending });
  });

  /**
   * Get popular searches
   */
  getPopularSearches = catchAsync(async (req, res) => {
    const { limit = 10 } = req.query;

    const popular = await SearchService.getPopularSearches(parseInt(limit));

    return ApiResponse.success(res, 200, 'Popular searches retrieved successfully', { popular });
  });

  /**
   * Get user search history
   */
  getUserSearchHistory = catchAsync(async (req, res) => {
    const { limit = 20 } = req.query;

    const history = await SearchService.getUserSearchHistory(
      req.user._id,
      parseInt(limit)
    );

    return ApiResponse.success(res, 200, 'Search history retrieved successfully', { history });
  });

  /**
   * Clear user search history
   */
  clearSearchHistory = catchAsync(async (req, res) => {
    // This would clear search history from database
    // Placeholder implementation
    return ApiResponse.success(res, 200, 'Search history cleared successfully');
  });

  /**
   * Get search suggestions by category
   */
  getCategorySuggestions = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { q, limit = 5 } = req.query;

    const suggestions = await SearchService.getSuggestions(
      q || categoryId,
      parseInt(limit)
    );

    return ApiResponse.success(res, 200, 'Category suggestions retrieved successfully', { suggestions });
  });

  /**
   * Advanced search with filters
   */
  advancedSearch = catchAsync(async (req, res) => {
    const {
      q,
      page = 1,
      limit = 20,
      ...filters
    } = req.body;

    if (!filters || Object.keys(filters).length === 0) {
      throw new AppError('At least one filter is required', 400);
    }

    const results = await SearchService.searchProducts(
      q,
      filters,
      parseInt(page),
      parseInt(limit)
    );

    return ApiResponse.success(res, 200, 'Advanced search results retrieved successfully', results);
  });

  /**
   * Get search facets
   */
  getSearchFacets = catchAsync(async (req, res) => {
    const { q, ...filters } = req.query;

    const facets = await SearchService.getSearchFacets(q, filters);

    return ApiResponse.success(res, 200, 'Search facets retrieved successfully', { facets });
  });

  /**
   * Search by image (placeholder - would need image recognition)
   */
  searchByImage = catchAsync(async (req, res) => {
    if (!req.file) {
      throw new AppError('Image is required', 400);
    }

    // This would integrate with image recognition service
    // Placeholder response
    return ApiResponse.success(res, 200, 'Image search results retrieved successfully', {
      message: 'Image search not fully implemented',
      image: req.file
    });
  });

  /**
   * Voice search (placeholder - would need speech-to-text)
   */
  voiceSearch = catchAsync(async (req, res) => {
    const { audio } = req.body;

    if (!audio) {
      throw new AppError('Audio data is required', 400);
    }

    // This would integrate with speech-to-text service
    // Placeholder response
    return ApiResponse.success(res, 200, 'Voice search results retrieved successfully', {
      message: 'Voice search not fully implemented',
      transcribed: 'Sample transcribed text'
    });
  });

  /**
   * Get search analytics (admin only)
   */
  getSearchAnalytics = catchAsync(async (req, res) => {
    const { period = '30d' } = req.query;

    // This would aggregate search analytics
    // Placeholder response
    const analytics = {
      totalSearches: 15000,
      uniqueSearches: 8500,
      averageResults: 45,
      topQueries: [
        { query: 'sofa', count: 1200 },
        { query: 'refrigerator', count: 980 },
        { query: 'bed', count: 750 }
      ],
      zeroResultQueries: [
        { query: 'xyz', count: 15 },
        { query: 'abc', count: 12 }
      ],
      searchesByHour: Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        count: Math.floor(Math.random() * 500)
      })),
      clickThroughRate: 0.35
    };

    return ApiResponse.success(res, 200, 'Search analytics retrieved successfully', analytics);
  });
}

module.exports = new SearchController();