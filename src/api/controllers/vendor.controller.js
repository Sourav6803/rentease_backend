const VendorService = require('../../services/vendor.service');
const catchAsync = require('../../utils/catchAsync');
const {ApiResponse} = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const vendorAnalyticsService = require('../../services/vendor-analytics.service');

class VendorController {
  /**
   * Complete vendor profile after approval
   */
  completeProfile = catchAsync(async (req, res) => {
    const vendor = await VendorService.completeProfile(req.user._id, req.body);

    return ApiResponse.success(
      res,
      200,
      "Vendor profile completed successfully",
      { vendor },
    );
  });

  /**
   * Upload vendor documents
   */
  uploadDocuments = catchAsync(async (req, res) => {
    const documents = req.files.map((file) => ({
      type: file.fieldname,
      url: file.path,
      documentNumber: req.body[`${file.fieldname}Number`],
      uploadedAt: new Date(),
    }));

    const uploaded = await VendorService.uploadDocuments(
      req.user._id,
      documents,
    );

    return ApiResponse.success(res, 200, "Documents uploaded successfully", {
      documents: uploaded,
    });
  });

  /**
   * Upload product images
   */

  uploadProductImages = catchAsync(async (req, res) => {
    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      throw new AppError("Please upload at least one image", 400);
    }

    // Get uploaded files from middleware
    const uploadedFiles =
      req.uploadedFiles ||
      req.files.map((file) => ({
        url: file.path || file.secure_url,
        thumbnail:
          file.path?.replace("/upload/", "/upload/w_200,h_200,c_fill/") ||
          file.secure_url?.replace("/upload/", "/upload/w_200,h_200,c_fill/"),
        publicId: file.filename || file.public_id,
        width: file.width,
        height: file.height,
        format: file.format,
        size: file.size,
      }));

    // 🔥 Return consistent structure
    return ApiResponse.success(res, 200, "Images uploaded successfully", {
      images: uploadedFiles,
      count: uploadedFiles.length,
    });
  });

  /**
   * Get vendor registration status
   */
  getRegistrationStatus = catchAsync(async (req, res) => {
    const status = await AuthService.getVendorRegistrationStatus(req.user._id);

    return ApiResponse.success(
      res,
      200,
      "Registration status retrieved successfully",
      status,
    );
  });

  /**
   * Get vendor profile
   */
  getProfile = catchAsync(async (req, res) => {
    const profile = await VendorService.getVendorProfile(req.user._id);

    return ApiResponse.success(
      res,
      200,
      "Vendor profile retrieved successfully",
      { profile },
    );
  });

  /**
   * Get vendor by ID (public)
   */
  getVendorById = catchAsync(async (req, res) => {
    const { vendorId } = req.params;
    console.log(`Received request to get vendor by ID: ${vendorId}`)
    const vendor = await VendorService.getVendorById(vendorId);

    return ApiResponse.success(res, 200, "Vendor retrieved successfully", {
      vendor,
    });
  });

  /**
   * Update vendor profile
   */
  updateProfile = catchAsync(async (req, res) => {
    const vendor = await VendorService.updateVendorProfile(
      req.user._id,
      req.body,
    );

    return ApiResponse.success(
      res,
      200,
      "Vendor profile updated successfully",
      { vendor },
    );
  });

  /**
   * Get vendor dashboard
   */
  getDashboard = catchAsync(async (req, res) => {
    const dashboard = await VendorService.getVendorDashboard(req.user._id);

    return ApiResponse.success(
      res,
      200,
      "Dashboard data retrieved successfully",
      dashboard,
    );
  });

  /**
   * Get vendor products
   */
  getProducts = catchAsync(async (req, res) => {

    const { page = 1, limit = 10, ...filters } = req.query;
    
    const products = await VendorService.getVendorProducts(
      req.vendor._id,
      parseInt(page),
      parseInt(limit),
      filters,
    );

    return ApiResponse.success(
      res,
      200,
      "Products retrieved successfully",
      products,
    );
  });

  /**
   * Get vendor rentals
   */
  getRentals = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    const rentals = await VendorService.getVendorRentals(
      req.user._id,
      parseInt(page),
      parseInt(limit),
      filters,
    );

    return ApiResponse.success(
      res,
      200,
      "Rentals retrieved successfully",
      rentals,
    );
  });

  /**
   * Get vendor analytics
   */
  getAnalytics = catchAsync(async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw new AppError("Start date and end date are required", 400);
    }

    const analytics = await VendorService.getVendorAnalytics(
      req.user._id,
      startDate,
      endDate,
    );

    return ApiResponse.success(
      res,
      200,
      "Analytics retrieved successfully",
      analytics,
    );
  });

  /**
   * Update bank details
   */
  updateBankDetails = catchAsync(async (req, res) => {
    const bankDetails = await VendorService.updateBankDetails(
      req.user._id,
      req.body,
    );

    return ApiResponse.success(res, 200, "Bank details updated successfully", {
      bankDetails,
    });
  });

  /**
   * Update subscription plan
   */
  updateSubscription = catchAsync(async (req, res) => {
    const { plan } = req.body;

    if (!plan) {
      throw new AppError("Plan is required", 400);
    }

    const subscription = await VendorService.updateSubscription(
      req.user._id,
      plan,
    );

    return ApiResponse.success(res, 200, "Subscription updated successfully", {
      subscription,
    });
  });

  /**
   * Get subscription details
   */
  getSubscription = catchAsync(async (req, res) => {
    const subscription = await VendorService.getSubscriptionDetails(
      req.user._id,
    );

    return ApiResponse.success(
      res,
      200,
      "Subscription details retrieved successfully",
      subscription,
    );
  });

  /**
   * Update payout schedule
   */
  updatePayoutSchedule = catchAsync(async (req, res) => {
    const { schedule } = req.body;

    if (!schedule) {
      throw new AppError("Schedule is required", 400);
    }

    const payoutSchedule = await VendorService.updatePayoutSchedule(
      req.user._id,
      schedule,
    );

    return ApiResponse.success(
      res,
      200,
      "Payout schedule updated successfully",
      { payoutSchedule },
    );
  });

  /**
   * Get payout history
   */
  getPayoutHistory = catchAsync(async (req, res) => {
    const { page = 1, limit = 10 } = req.query;
    const history = await VendorService.getPayoutHistory(
      req.user._id,
      parseInt(page),
      parseInt(limit),
    );

    return ApiResponse.success(
      res,
      200,
      "Payout history retrieved successfully",
      history,
    );
  });

  /**
   * Update business hours
   */
  updateBusinessHours = catchAsync(async (req, res) => {
    const { businessHours } = req.body;

    if (!businessHours) {
      throw new AppError("Business hours are required", 400);
    }

    const updated = await VendorService.updateBusinessHours(
      req.user._id,
      businessHours,
    );

    return ApiResponse.success(
      res,
      200,
      "Business hours updated successfully",
      { businessHours: updated },
    );
  });

  /**
   * Update notification preferences
   */
  updateNotificationPreferences = catchAsync(async (req, res) => {
    const preferences = await VendorService.updateNotificationPreferences(
      req.user._id,
      req.body,
    );

    return ApiResponse.success(
      res,
      200,
      "Notification preferences updated successfully",
      { preferences },
    );
  });

  /**
   * Get vendor reviews
   */
  getReviews = catchAsync(async (req, res) => {
    const { page = 1, limit = 10 } = req.query;
    const reviews = await VendorService.getVendorReviews(
      req.user._id,
      parseInt(page),
      parseInt(limit),
    );

    return ApiResponse.success(
      res,
      200,
      "Reviews retrieved successfully",
      reviews,
    );
  });

  /**
   * Reply to review
   */
  replyToReview = catchAsync(async (req, res) => {
    const { reviewId } = req.params;
    const { reply } = req.body;

    if (!reply) {
      throw new AppError("Reply content is required", 400);
    }

    const response = await VendorService.replyToReview(
      req.user._id,
      reviewId,
      reply,
    );

    return ApiResponse.success(res, 200, "Reply added successfully", {
      response,
    });
  });

  /**
   * Get vendor statistics
   */
  getStats = catchAsync(async (req, res) => {
    const stats = await VendorService.getVendorStats(req.vendor._id);

    return ApiResponse.success(
      res,
      200,
      "Vendor statistics retrieved successfully",
      { stats },
    );
  });

  /**
   * Check availability for rental
   */
  checkAvailability = catchAsync(async (req, res) => {
    const { vendorId, productId, startDate, endDate } = req.body;

    if (!vendorId || !productId || !startDate || !endDate) {
      throw new AppError(
        "Vendor ID, product ID, start date, and end date are required",
        400,
      );
    }

    const availability = await VendorService.checkVendorAvailability(
      vendorId,
      productId,
      startDate,
      endDate,
    );

    return ApiResponse.success(
      res,
      200,
      "Availability checked successfully",
      availability,
    );
  });

  // ==================== ADMIN METHODS ====================

  /**
   * Get pending verifications (admin)
   */
  getPendingVerifications = catchAsync(async (req, res) => {
    const vendors = await VendorService.getPendingVerifications();

    return ApiResponse.success(
      res,
      200,
      "Pending verifications retrieved successfully",
      { vendors },
    );
  });

  /**
   * Approve vendor (admin)
   */
  approveVendor = catchAsync(async (req, res) => {
    const { vendorId } = req.params;
    const { commission } = req.body;

    const vendor = await VendorService.approveVendor(
      vendorId,
      req.admin._id,
      commission,
    );

    return ApiResponse.success(res, 200, "Vendor approved successfully", {
      vendor,
    });
  });

  /**
   * Reject vendor (admin)
   */
  rejectVendor = catchAsync(async (req, res) => {
    const { vendorId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      throw new AppError("Rejection reason is required", 400);
    }

    const vendor = await VendorService.rejectVendor(
      vendorId,
      req.admin._id,
      reason,
    );

    return ApiResponse.success(res, 200, "Vendor rejected successfully", {
      vendor,
    });
  });

  /**
   * Suspend vendor (admin)
   */
  suspendVendor = catchAsync(async (req, res) => {
    const { vendorId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      throw new AppError("Suspension reason is required", 400);
    }

    const vendor = await VendorService.suspendVendor(
      vendorId,
      req.admin._id,
      reason,
    );

    return ApiResponse.success(res, 200, "Vendor suspended successfully", {
      vendor,
    });
  });

  /**
   * Reinstate vendor (admin)
   */
  reinstateVendor = catchAsync(async (req, res) => {
    const { vendorId } = req.params;

    const vendor = await VendorService.reinstateVendor(vendorId, req.admin._id);

    return ApiResponse.success(res, 200, "Vendor reinstated successfully", {
      vendor,
    });
  });

  /**
   * Get all vendors (admin)
   */
  getAllVendors = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    const vendors = await VendorService.getAllVendors(
      parseInt(page),
      parseInt(limit),
      filters,
    );

    return ApiResponse.success(
      res,
      200,
      "Vendors retrieved successfully",
      vendors,
    );
  });

  /**
   * Get top vendors (public)
   */
  getTopVendors = catchAsync(async (req, res) => {
    console.log("Fetching top vendors with query:", req.query)
    const { limit = 10 } = req.query;
    const vendors = await VendorService.getTopVendors(parseInt(limit));

    return ApiResponse.success(res, 200, "Top vendors retrieved successfully", {
      vendors,
    });
  });

  // Add to vendor.controller.js
  getAnalyticsOverview = catchAsync(async (req, res) => {
    const { period = '30d' } = req.query;
    
    const overview = await vendorAnalyticsService.getOverview(req.vendor._id, period);
    
    return ApiResponse.success(res, 200, 'Analytics overview retrieved', overview);
  });

  getSalesReport = catchAsync(async (req, res) => {
    const { period = '30d' } = req.query;
    
    const sales = await vendorAnalyticsService.getSalesReport(req.vendor._id, period);
    
    return ApiResponse.success(res, 200, 'Sales report retrieved', sales);
  });

  getProductPerformance = catchAsync(async (req, res) => {
    const { period = '30d', limit = 10 } = req.query;
    
    const performance = await vendorAnalyticsService.getProductPerformance(
      req.vendor._id, 
      period,
      parseInt(limit)
    );
    
    return ApiResponse.success(res, 200, 'Product performance retrieved', performance);
  });

  getCustomerInsights = catchAsync(async (req, res) => {
    const { period = '30d' } = req.query;
    
    const insights = await vendorAnalyticsService.getCustomerInsights(req.vendor._id, period);
    
    return ApiResponse.success(res, 200, 'Customer insights retrieved', insights);
  });
}

module.exports = new VendorController();