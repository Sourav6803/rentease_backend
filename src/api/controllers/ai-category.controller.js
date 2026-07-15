

const AICategoryService = require('../../services/ai-category.service');
const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const { AppError } = require('../../utils/AppError');

class AICategoryController {
  /**
   * Generate category suggestions
   */
  generateSuggestions = catchAsync(async (req, res) => {
    const { categoryName, parentCategory, level } = req.body;
    
    if (!categoryName) {
      throw new AppError('Category name is required', 400);
    }
    
    const suggestions = await AICategoryService.generateCategorySuggestions(
      categoryName,
      parentCategory,
      level
    );
    
    return ApiResponse.success(res, 200, 'Category suggestions generated', suggestions);
  });

  /**
   * Generate single category icon
   */
  generateIcon = catchAsync(async (req, res) => {
    const { categoryName, description } = req.body;
    
    if (!categoryName) {
      throw new AppError('Category name is required', 400);
    }
    
    const icon = await AICategoryService.generateCategoryIcon(categoryName, description);
    
    return ApiResponse.success(res, 200, 'Category icon generated', icon);
  });

  /**
   * Generate multiple icon variations for selection
   */
  generateIconVariations = catchAsync(async (req, res) => {
    const { categoryName, description, count = 4 } = req.body;
    
    if (!categoryName) {
      throw new AppError('Category name is required', 400);
    }
    
    const variations = await AICategoryService.generateIconVariations(
      categoryName,
      description,
      Math.min(count, 6) // Max 6 variations
    );
    
    return ApiResponse.success(res, 200, 'Icon variations generated', variations);
  });

  /**
   * Regenerate specific icon with new prompt
   */
  regenerateIcon = catchAsync(async (req, res) => {
    const { categoryName, description, variationHint } = req.body;
    
    if (!categoryName) {
      throw new AppError('Category name is required', 400);
    }
    
    // Add variation hint to description for different style
    const enhancedDescription = description 
      ? `${description} ${variationHint || ''}`
      : variationHint || '';
    
    const icon = await AICategoryService.generateCategoryIcon(categoryName, enhancedDescription);
    
    return ApiResponse.success(res, 200, 'Icon regenerated successfully', icon);
  });

  /**
   * Get available icon styles for category
   */
  getIconStyles = catchAsync(async (req, res) => {
    const { categoryName } = req.params;
    
    const styles = [
      { 
        id: 'minimalist', 
        name: 'Minimalist', 
        description: 'Clean, simple design with basic shapes',
        example: 'https://via.placeholder.com/100x100?text=Minimal'
      },
      { 
        id: 'detailed', 
        name: 'Detailed', 
        description: 'Rich details and textures',
        example: 'https://via.placeholder.com/100x100?text=Detailed'
      },
      { 
        id: 'gradient', 
        name: 'Gradient', 
        description: 'Modern gradient colors',
        example: 'https://via.placeholder.com/100x100?text=Gradient'
      },
      { 
        id: 'flat', 
        name: 'Flat', 
        description: 'Flat design with solid colors',
        example: 'https://via.placeholder.com/100x100?text=Flat'
      },
      { 
        id: '3d', 
        name: '3D', 
        description: 'Three-dimensional with shadows',
        example: 'https://via.placeholder.com/100x100?text=3D'
      },
      { 
        id: 'outline', 
        name: 'Outline', 
        description: 'Outline style with thin strokes',
        example: 'https://via.placeholder.com/100x100?text=Outline'
      }
    ];
    
    return ApiResponse.success(res, 200, 'Icon styles retrieved', { styles });
  });

  /**
   * Save AI-generated category
   */
  saveCategory = catchAsync(async (req, res) => {
    const { categoryData } = req.body;
    
    if (!categoryData) {
      throw new AppError('Category data is required', 400);
    }
    
    const category = await AICategoryService.saveCategoryFromAI(
      categoryData,
      req.user?._id || req.admin?._id
    );
    
    return ApiResponse.success(res, 201, 'Category created successfully', { category });
  });

  /**
   * Track category performance
   */
  trackPerformance = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    
    const performance = await AICategoryService.trackCategoryPerformance(categoryId);
    
    return ApiResponse.success(res, 200, 'Category performance retrieved', performance);
  });

  /**
   * Get category trends
   */
  getTrends = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    
    const trends = await AICategoryService.getCategoryTrends(categoryId);
    
    return ApiResponse.success(res, 200, 'Category trends retrieved', { trends });
  });

  /**
   * Get category recommendations
   */
  getRecommendations = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    
    const recommendations = await AICategoryService.getCategoryRecommendations(categoryId);
    
    return ApiResponse.success(res, 200, 'Category recommendations retrieved', { recommendations });
  });

  /**
   * Generate bulk categories (for batch creation)
   */
  generateBulkCategories = catchAsync(async (req, res) => {
    const { categories } = req.body;
    
    if (!categories || !Array.isArray(categories) || categories.length === 0) {
      throw new AppError('Categories array is required', 400);
    }
    
    const results = [];
    const errors = [];
    
    for (const cat of categories) {
      try {
        const suggestions = await AICategoryService.generateCategorySuggestions(
          cat.name,
          cat.parentCategory
        );
        results.push({
          input: cat.name,
          suggestions,
          success: true
        });
      } catch (error) {
        errors.push({
          input: cat.name,
          error: error.message,
          success: false
        });
      }
    }
    
    return ApiResponse.success(res, 200, 'Bulk generation completed', {
      results,
      errors,
      total: categories.length,
      successful: results.length,
      failed: errors.length
    });
  });

  /**
   * Get icon generation status (for long-running tasks)
   */
  getIconStatus = catchAsync(async (req, res) => {
    const { taskId } = req.params;
    
    // This would check a task queue or Redis for status
    // For now, return a placeholder
    return ApiResponse.success(res, 200, 'Task status retrieved', {
      taskId,
      status: 'completed',
      progress: 100
    });
  });
}

module.exports = new AICategoryController();


