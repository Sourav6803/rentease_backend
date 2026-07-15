const express = require('express');
const router = express.Router();
const productController = require('../../controllers/product.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { productValidations } = require('../../middlewares/validation.middleware');
const { cacheProduct, cacheList, invalidateCache } = require('../../middlewares/cache.middleware');
const { uploadProductImages } = require('../../middlewares/upload.middleware');
const { restrictTo } = require('../../middlewares/permissions.middleware');

// ==================== PUBLIC ROUTES ====================

// Search products
router.get('/search', productController.searchProducts);

router.get('/trending', productController.getTrendingProducts);
router.get('/new-arrivals', productController.getNewArrivals);
router.get('/most-popular', productController.getMostPopularProducts);

// Get featured products
router.get('/featured', cacheList('featured-products', 1800), productController.getFeaturedProducts);

// Get product recommendations
router.get('/recommendations', productController.getRecommendations);

// Get product by ID or slug
router.get('/:identifier', cacheProduct(), productController.getProduct);

// Get products by category
router.get('/category/:categoryId', productController.getProductsByCategory);

// Check product availability
router.get('/:productId/availability', productController.checkAvailability);

// Get similar products
router.get('/:productId/similar', productController.getSimilarProducts);

// Generate AI description (public but rate limited)
router.post('/generate-description', 
  validate(productValidations.generateDescription),
  productController.generateDescription
);

// ==================== VENDOR ROUTES ====================

// All routes below require vendor authentication
router.use(protect);
// router.use(restrictTo('vendor'));
router.use('/vendor', restrictTo('vendor'));

// Get vendor's products
router.get('/vendor/me', productController.getVendorProducts);

// Create product
router.post('/', 
  uploadProductImages,
  validate(productValidations.createProduct),
  invalidateCache(['list:vendor-products*', 'list:featured-products*']),
  productController.createProduct
);

// Update product
router.put('/:id', 
  uploadProductImages,
  validate(productValidations.updateProduct),
  invalidateCache(['product:*', 'list:vendor-products*', 'list:featured-products*']),
  productController.updateProduct
);

// Delete product
router.delete('/:id', 
  invalidateCache(['product:*', 'list:vendor-products*', 'list:featured-products*']),
  productController.deleteProduct
);

// Bulk update products
router.post('/bulk/update', 
  validate(productValidations.bulkUpdate),
  invalidateCache(['product:*', 'list:vendor-products*']),
  productController.bulkUpdateProducts
);

// Update stock
router.patch('/:id/stock', 
  validate(productValidations.updateStock),
  invalidateCache(['product:*', 'list:vendor-products*']),
  productController.updateStock
);

// Get product analytics
router.get('/:id/analytics', productController.getProductAnalytics);

// ==================== ADMIN ROUTES ====================

// All routes below require admin authentication
// router.use(restrictTo('admin', 'super-admin'));
router.use('/admin', restrictTo('admin', 'super-admin'));

// Get all products (including inactive)
router.get('/admin/all',  productController.getAllProducts);

// Get pending products for approval
router.get('/admin/pending', productController.getPendingProducts);

// Toggle featured status
router.patch('/admin/:id/feature', 
  validate(productValidations.toggleFeatured),
  invalidateCache(['product:*', 'list:featured-products*']),
  productController.toggleFeatured
);

// Approve product
router.post('/admin/:id/approve', productController.approveProduct);

// Reject product
router.post('/admin/:id/reject', 
  validate(productValidations.rejectProduct),
  productController.rejectProduct
);

// Export products
router.get('/admin/export/all', productController.exportProducts);

// Import products
router.post('/admin/import', 
  validate(productValidations.importProducts),
  productController.importProducts
);

module.exports = router;