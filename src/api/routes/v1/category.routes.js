

const express = require('express');
const router = express.Router();
const categoryController = require('../../controllers/category.controller');
// const { protect } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { categoryValidations } = require('../../middlewares/validation.middleware');
const { cacheCategory, clearCache } = require('../../middlewares/cache.middleware');
const { restrictTo, protectAdmin } = require('../../middlewares/admin-auth.middleware');
const { uploadSingleImage } = require('../../middlewares/upload.middleware');
const uploadController = require('../../controllers/uploadController');
// const { restrictTo } = require('../../middlewares/permissions.middleware');

// ==================== PUBLIC ROUTES ====================

// Get all categories (public - returns tree)
router.get('/', categoryController.getAllCategories);

// Get category tree (public - flat tree)
router.get('/tree', categoryController.getCategoryTree);

// Get featured categories (public)
router.get('/featured', categoryController.getFeaturedCategories);

// Get category by ID or slug (public)
router.get('/:identifier', cacheCategory(), categoryController.getCategory);

// Get category products (public)
router.get('/:id/products', categoryController.getCategoryProducts);

// Get category breadcrumbs (public)
router.get('/:id/breadcrumbs', categoryController.getCategoryBreadcrumbs);

// Get category filters (public)
router.get('/:id/filters', categoryController.getCategoryFilters);

// Get category path (public)
router.get('/:id/path', categoryController.getCategoryPath);

// Upload single image (supports both file and base64)
router.post('/upload/image', uploadSingleImage, uploadController.uploadImage);

// ==================== ADMIN ROUTES ====================

// All routes below require admin authentication
router.use(protectAdmin);
router.use(restrictTo('admin', 'super_admin'));

// ---------- Category Management ----------


// ---------- Statistics ----------

// Get category statistics
router.get('/admin/stats', categoryController.getCategoryStats);

// Get all categories with pagination (admin listing)
router.get('/admin/list', categoryController.getAdminCategories);

// Get category tree formatted for select dropdown
router.get('/admin/tree-select', categoryController.getCategoryTreeForSelect);

// Check slug availability
router.get('/admin/check-slug', categoryController.checkSlugAvailability);

// Get category by ID with full details (for editing)
router.get('/admin/:id', categoryController.getCategoryById);

// Create category
router.post('/', 
  validate(categoryValidations.createCategory), 
  categoryController.createCategory
);

// Update category
router.put('/:id', 
  validate(categoryValidations.updateCategory), 
  categoryController.updateCategory
);

// Delete category
router.delete('/:id', categoryController.deleteCategory);

// Toggle category status
router.patch('/:id/toggle-status', 
  validate(categoryValidations.toggleStatus), 
  categoryController.toggleCategoryStatus
);

// Reorder categories
router.post('/reorder', 
  validate(categoryValidations.reorder), 
  categoryController.reorderCategories
);

// Bulk update categories
router.post('/bulk-update', 
  validate(categoryValidations.bulkUpdate), 
  categoryController.bulkUpdateCategories
);

// ---------- Import/Export ----------

// Import categories
router.post('/import', 
  validate(categoryValidations.import), 
  categoryController.importCategories
);

// Export categories
router.get('/export/all', categoryController.exportCategories);



module.exports = router;