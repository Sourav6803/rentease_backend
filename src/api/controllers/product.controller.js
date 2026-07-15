const ProductService = require('../../services/product.service');
const catchAsync = require('../../utils/catchAsync');
const {ApiResponse} = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const { addJob } = require('../../jobs');

// const {addJob} = require('../middlewares/cache.middleware')



class ProductController {
  /**
   * Search products
   */
  searchProducts = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;

    const results = await ProductService.searchProducts(
      filters,
      parseInt(page),
      parseInt(limit),
    );

    return ApiResponse.success(
      res,
      200,
      "Products retrieved successfully",
      results,
    );
  });

  /**
   * Get product by ID or slug
   */
  getProduct = catchAsync(async (req, res) => {
    const { identifier } = req.params;
    const product = await ProductService.getProduct(identifier, req.user?._id);

    return ApiResponse.success(res, 200, "Product retrieved successfully", {
      product,
    });
  });

  /**
   * Get featured products
   */
  getFeaturedProducts = catchAsync(async (req, res) => {
    const { limit = 10 } = req.query;
    const products = await ProductService.getFeaturedProducts(parseInt(limit));

    return ApiResponse.success(
      res,
      200,
      "Featured products retrieved successfully",
      { products },
    );
  });

  /**
   * Get trending products
   */
  getTrendingProducts = catchAsync(async (req, res) => {
    const { limit = 10 } = req.query;

    const products = await ProductService.getTrendingProducts(parseInt(limit));

    return ApiResponse.success(
      res,
      200,
      "Trending products retrieved successfully",
      {
        products,
        count: products.length,
      },
    );
  });

  /**
   * Get new arrivals
   */
  getNewArrivals = catchAsync(async (req, res) => {
    const { limit = 10, days = 30 } = req.query;

    const products = await ProductService.getNewArrivals(
      parseInt(limit),
      parseInt(days),
    );

    return ApiResponse.success(
      res,
      200,
      "New arrivals retrieved successfully",
      {
        products,
        count: products.length,
      },
    );
  });

  /**
   * Get most popular products (all-time)
   */
  getMostPopularProducts = catchAsync(async (req, res) => {
    const { limit = 10 } = req.query;

    const products = await ProductService.getMostPopularProducts(
      parseInt(limit),
    );

    return ApiResponse.success(
      res,
      200,
      "Most popular products retrieved successfully",
      {
        products,
        count: products.length,
      },
    );
  });

  /**
   * Get products by category
   */
  getProductsByCategory = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { page = 1, limit = 10, ...filters } = req.query;

    const products = await ProductService.getProductsByCategory(
      categoryId,
      parseInt(page),
      parseInt(limit),
      filters,
    );

    return ApiResponse.success(
      res,
      200,
      "Category products retrieved successfully",
      products,
    );
  });

  /**
   * Get product recommendations
   */
  getRecommendations = catchAsync(async (req, res) => {
    const { limit = 10 } = req.query;

    let recommendations;
    if (req.user) {
      recommendations = await ProductService.getRecommendations(
        req.user._id,
        parseInt(limit),
      );
    } else {
      recommendations = await ProductService.getPopularProducts(
        parseInt(limit),
      );
    }

    return ApiResponse.success(
      res,
      200,
      "Recommendations retrieved successfully",
      { recommendations },
    );
  });

  /**
   * Check product availability
   */
  checkAvailability = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const availability = await ProductService.checkAvailability(productId);

    return ApiResponse.success(
      res,
      200,
      "Availability checked successfully",
      availability,
    );
  });

  /**
   * Get similar products
   */
  getSimilarProducts = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { limit = 5 } = req.query;

    const products = await ProductService.getSimilarProducts(
      productId,
      parseInt(limit),
    );

    return ApiResponse.success(
      res,
      200,
      "Similar products retrieved successfully",
      { products },
    );
  });

  /**
   * Generate AI product description
   */
  generateDescription = catchAsync(async (req, res) => {
    const productData = req.body;

    const description = await ProductService.generateAIDescription(productData);

    if (!description) {
      throw new AppError("AI description generation failed", 500);
    }

    return ApiResponse.success(res, 200, "Description generated successfully", {
      description,
    });
  });

  // ==================== VENDOR ROUTES ====================

  /**
   * Create product (vendor only)
   */
  createProduct = catchAsync(async (req, res) => {
    const product = await ProductService.createProduct(req.user._id, req.body);

    return ApiResponse.success(res, 201, "Product created successfully", {
      product,
    });
  });

  /**
   * Update product (vendor only)
   */
  updateProduct = catchAsync(async (req, res) => {
    const { id } = req.params;
    const product = await ProductService.updateProduct(
      id,
      req.vendor._id,
      req.body,
    );

    return ApiResponse.success(res, 200, "Product updated successfully", {
      product,
    });
  });

  /**
   * Delete product (vendor only)
   */
  deleteProduct = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await ProductService.deleteProduct(id, req.user._id);

    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Get vendor products (vendor only)
   */
  getVendorProducts = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;

    const products = await ProductService.getVendorProducts(
      req.user._id,
      parseInt(page),
      parseInt(limit),
      filters,
    );

    return ApiResponse.success(
      res,
      200,
      "Vendor products retrieved successfully",
      products,
    );
  });

  /**
   * Bulk update products (vendor only)
   */
  bulkUpdateProducts = catchAsync(async (req, res) => {
    const { updates } = req.body;

    if (!Array.isArray(updates)) {
      throw new AppError("Updates must be an array", 400);
    }

    const results = await ProductService.bulkUpdate(req.user._id, updates);

    return ApiResponse.success(res, 200, "Bulk update completed", results);
  });

  /**
   * Update product stock (vendor only)
   */
  updateStock = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { quantity, operation } = req.body;

    if (!quantity || !operation) {
      throw new AppError("Quantity and operation are required", 400);
    }

    const product = await ProductService.updateStock(id, quantity, operation);

    return ApiResponse.success(res, 200, "Stock updated successfully", {
      product,
    });
  });

  /**
   * Get product analytics (vendor only)
   */
  getProductAnalytics = catchAsync(async (req, res) => {
    const { id } = req.params;

    const [rentalStats, reviews, sentiment] = await Promise.all([
      ProductService.getProductRentalStats(id),
      Review.find({ product: id, "moderation.status": "approved" })
        .populate("user", "profile.firstName profile.lastName")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      ProductService.analyzeProductSentiment(id),
    ]);

    return ApiResponse.success(
      res,
      200,
      "Product analytics retrieved successfully",
      {
        rentalStats,
        recentReviews: reviews,
        sentiment,
      },
    );
  });

  // ==================== ADMIN ROUTES ====================

  /**
   * Get all products (admin only)
   */
  getAllProducts = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;

    // Add admin-specific filters
    filters.includeInactive = true;

    const results = await ProductService.searchProducts(
      filters,
      parseInt(page),
      parseInt(limit),
    );

    return ApiResponse.success(
      res,
      200,
      "All products retrieved successfully",
      results,
    );
  });

  /**
   * Toggle product featured status (admin only)
   */
  toggleFeatured = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { isFeatured } = req.body;

    const product = await ProductService.updateProduct(
      id,
      null, // Admin can update any product
      { "status.isFeatured": isFeatured },
    );

    const status = isFeatured ? "featured" : "unfeatured";
    return ApiResponse.success(res, 200, `Product ${status} successfully`, {
      product,
    });
  });

  /**
   * Approve product (admin only)
   */
  approveProduct = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { notes } = req.body;
    const adminId = req.admin?._id || req.user?._id;

    const product = await ProductService.approveProduct(id, adminId, notes);

    // Send notification to vendor
    await addJob("email", "send", {
      to: product.vendor?.user?.email,
      subject: "Your Product Has Been Approved",
      template: "product-approved",
      data: {
        productName: product.basicInfo.name,
        productUrl: `${process.env.CLIENT_URL}/products/${product.basicInfo.slug}`,
        dashboardUrl: `${process.env.CLIENT_URL}/vendor/products`,
      },
    });

    return ApiResponse.success(res, 200, "Product approved successfully", {
      product,
    });
  });

  /**
   * Reject product (admin only)
   */
  rejectProduct = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    const product = await ProductService.updateProduct(id, null, {
      "status.isVerified": false,
      "status.approvalStatus": "rejected",
      "status.rejectionReason": reason,
    });

    return ApiResponse.success(res, 200, "Product rejected successfully", {
      product,
    });
  });


  /**
   * Get pending products (admin only)
   */
  getPendingProducts = catchAsync(async (req, res) => {
    const { page = 1, limit = 20, search, category } = req.query;
    
    // Use dedicated service method instead of searchProducts
    const results = await ProductService.getPendingProducts(
      parseInt(page),
      parseInt(limit),
      { search, category }
    );

    return ApiResponse.success(
      res,
      200,
      "Pending products retrieved successfully",
      results,
    );
  });

  /**
   * Export products (admin only)
   */
  exportProducts = catchAsync(async (req, res) => {
    const { format = "json" } = req.query;

    const products = await Product.find()
      .populate("vendor", "business.name")
      .populate("category", "name")
      .lean();

    if (format === "csv") {
      const { Parser } = require("json2csv");
      const fields = [
        "_id",
        "basicInfo.name",
        "basicInfo.sku",
        "basicInfo.brand",
        "category.name",
        "pricing.monthlyRent",
        "inventory.totalQuantity",
        "inventory.availableQuantity",
        "condition",
        "status.isActive",
        "ratings.average",
        "createdAt",
      ];
      const parser = new Parser({ fields });
      const csv = parser.parse(products);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=products.csv");
      return res.send(csv);
    }

    return ApiResponse.success(res, 200, "Products exported successfully", {
      products,
    });
  });

  /**
   * Import products (admin only)
   */
  importProducts = catchAsync(async (req, res) => {
    const { products } = req.body;

    if (!Array.isArray(products)) {
      throw new AppError("Products must be an array", 400);
    }

    const results = {
      successful: [],
      failed: [],
    };

    for (const productData of products) {
      try {
        const product = await ProductService.createProduct(
          productData.vendorId,
          productData,
        );
        results.successful.push(product._id);
      } catch (error) {
        results.failed.push({
          name: productData.basicInfo?.name,
          reason: error.message,
        });
      }
    }

    return ApiResponse.success(
      res,
      200,
      "Products imported successfully",
      results,
    );
  });
}

module.exports = new ProductController();