const CategoryService = require('../../services/category.service');
const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const { AppError } = require('../../utils/AppError');
const logger = require('../../config/logger');
const Category = require('../../models/Category.model');

class CategoryController {
  /**
   * Get all categories
   */
  getAllCategories = catchAsync(async (req, res) => {
    const { includeInactive } = req.query;
    const categories = await CategoryService.getAllCategories(includeInactive === 'true');
    
    return ApiResponse.success(res, 200, 'Categories retrieved successfully', { categories });
  });

  /**
   * Get category by ID or slug
   */
  getCategory = catchAsync(async (req, res) => {
    const { identifier } = req.params;
    const category = await CategoryService.getCategory(identifier);
    
    return ApiResponse.success(res, 200, 'Category retrieved successfully', { category });
  });

  /**
   * Create new category
   */
  createCategory = catchAsync(async (req, res) => {
    const category = await CategoryService.createCategory(req.body, req.user?._id || req.admin?._id);
    
    return ApiResponse.success(res, 201, 'Category created successfully', { category });
  });

  /**
   * Update category
   */
  updateCategory = catchAsync(async (req, res) => {
    const { id } = req.params;
    const category = await CategoryService.updateCategory(id, req.body, req.user?._id || req.admin?._id);
    
    return ApiResponse.success(res, 200, 'Category updated successfully', { category });
  });

  /**
   * Delete category
   */
  deleteCategory = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await CategoryService.deleteCategory(id, req.user?._id || req.admin?._id);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Get category products
   */
  getCategoryProducts = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { page = 1, limit = 10, ...filters } = req.query;
    
    const products = await CategoryService.getCategoryProducts(
      id,
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Category products retrieved successfully', products);
  });

  /**
   * Get category breadcrumbs
   */
  getCategoryBreadcrumbs = catchAsync(async (req, res) => {
    const { id } = req.params;
    const breadcrumbs = await CategoryService.getCategoryBreadcrumbs(id);
    
    return ApiResponse.success(res, 200, 'Breadcrumbs retrieved successfully', { breadcrumbs });
  });

  /**
   * Get category filter options
   */
  getCategoryFilters = catchAsync(async (req, res) => {
    const { id } = req.params;
    const filters = await CategoryService.getCategoryFilterOptions(id);
    
    return ApiResponse.success(res, 200, 'Filter options retrieved successfully', { filters });
  });

  /**
   * Get category tree
   */
  getCategoryTree = catchAsync(async (req, res) => {
    const categories = await CategoryService.getAllCategories(false);
    
    return ApiResponse.success(res, 200, 'Category tree retrieved successfully', { categories });
  });

  /**
   * Get category statistics
   */
  getCategoryStats = catchAsync(async (req, res) => {
    const stats = await CategoryService.getCategoryStats();
    
    return ApiResponse.success(res, 200, 'Category statistics retrieved successfully', stats);
  });

  /**
   * Reorder categories (admin only)
   */
  reorderCategories = catchAsync(async (req, res) => {
    const { orderedIds } = req.body;
    
    if (!Array.isArray(orderedIds)) {
      throw new AppError('Ordered IDs must be an array', 400);
    }

    const result = await CategoryService.reorderCategories(orderedIds);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Bulk update categories (admin only)
   */
  bulkUpdateCategories = catchAsync(async (req, res) => {
    const { updates } = req.body;
    
    if (!Array.isArray(updates)) {
      throw new AppError('Updates must be an array', 400);
    }

    const results = await CategoryService.bulkUpdate(updates, req.admin?._id);
    
    return ApiResponse.success(res, 200, 'Bulk update completed', results);
  });

  /**
   * Import categories (admin only)
   */
  importCategories = catchAsync(async (req, res) => {
    const { categories } = req.body;
    
    if (!Array.isArray(categories)) {
      throw new AppError('Categories must be an array', 400);
    }

    const results = await CategoryService.importCategories(categories, req.admin?._id);
    
    return ApiResponse.success(res, 200, 'Categories imported successfully', results);
  });

  /**
   * Export categories (admin only)
   */
  exportCategories = catchAsync(async (req, res) => {
    const { format = 'json' } = req.query;
    
    const categories = await CategoryService.exportCategories(format);
    
    if (format === 'csv') {
      // Convert to CSV
      const { Parser } = require('json2csv');
      const parser = new Parser();
      const csv = parser.parse(categories);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=categories.csv');
      return res.send(csv);
    }
    
    return ApiResponse.success(res, 200, 'Categories exported successfully', { categories });
  });

  /**
   * Toggle category status (admin only)
   */
  toggleCategoryStatus = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { isActive } = req.body;
    
    const category = await CategoryService.updateCategory(
      id,
      { isActive },
      req.admin?._id
    );
    
    const status = isActive ? 'activated' : 'deactivated';
    return ApiResponse.success(res, 200, `Category ${status} successfully`, { category });
  });

  /**
   * Get featured categories
   */
  getFeaturedCategories = catchAsync(async (req, res) => {
    const { limit = 8 } = req.query;
    
    const categories = await Category.find({ 
      isActive: true,
      isFeatured: true 
    })
    .select('name slug image description productCount')
    .sort({ displayOrder: 1 })
    .limit(parseInt(limit))
    .lean();

    return ApiResponse.success(res, 200, 'Featured categories retrieved successfully', { categories });
  });

  /**
   * Get category path
   */
  getCategoryPath = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const path = await Category.aggregate([
      { $match: { _id: mongoose.Types.ObjectId(id) } },
      {
        $graphLookup: {
          from: 'categories',
          startWith: '$_id',
          connectFromField: 'parent',
          connectToField: '_id',
          as: 'ancestors',
          depthField: 'level',
          maxDepth: 10
        }
      },
      { $project: { path: '$ancestors.name' } }
    ]);

    return ApiResponse.success(res, 200, 'Category path retrieved successfully', { path: path[0]?.path || [] });
  });

  // controllers/category.controller.js

/**
 * Get admin categories with pagination
 */
getAdminCategories = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, ...filters } = req.query;
  
  const result = await CategoryService.getAllCategoriesWithPagination(
    parseInt(page),
    parseInt(limit),
    filters
  );
  
  return ApiResponse.success(res, 200, 'Categories retrieved successfully', result);
});

/**
 * Get category tree for select dropdown
 */
getCategoryTreeForSelect = catchAsync(async (req, res) => {
  const { excludeId } = req.query;
  
  const tree = await CategoryService.getCategoryTreeForSelect(excludeId);
  
  return ApiResponse.success(res, 200, 'Category tree retrieved successfully', { tree });
});

/**
 * Check slug availability
 */
checkSlugAvailability = catchAsync(async (req, res) => {
  const { slug, excludeId } = req.query;
  
  if (!slug) {
    throw new AppError('Slug is required', 400);
  }
  
  const result = await CategoryService.checkSlugAvailability(slug, excludeId);
  
  return ApiResponse.success(res, 200, 'Slug availability checked', result);
});

/**
 * Get category by ID with full details (for editing)
 */
getCategoryById = catchAsync(async (req, res) => {
  const { id } = req.params;
  
  const category = await CategoryService.getCategoryById(id);
  
  return ApiResponse.success(res, 200, 'Category retrieved successfully', { category });
});
}

module.exports = new CategoryController();