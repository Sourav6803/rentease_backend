const AdminVendorService = require('../../services/admin-vendor.service');
const catchAsync = require('../../utils/catchAsync');
// const {ApiResponse} = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const { ApiResponse } = require('../../utils/apiResponse');

class AdminVendorController {
  /**
   * Get all vendors
   */
  getAllVendors = catchAsync(async (req, res) => {
    const { page = 1, limit = 20, ...filters } = req.query;

    // console.log('getAllVendors called with query:', req.query)
    // console.log("req.admin", req.admin)
    
    const result = await AdminVendorService.getAllVendors(
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Vendors retrieved successfully', result);
  });

  /**
   * Get pending vendors
   */
  getPendingVendors = catchAsync(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    
    const result = await AdminVendorService.getPendingVendors(
      parseInt(page),
      parseInt(limit)
    );
    
    return ApiResponse.success(res, 200, 'Pending vendors retrieved successfully', result);
  });

  /**
   * Get vendor details for review
   */
  getVendorForReview = catchAsync(async (req, res) => {
    const { vendorId } = req.params;
    
    const vendor = await AdminVendorService.getVendorForReview(vendorId);
    
    return ApiResponse.success(res, 200, 'Vendor details retrieved successfully', { vendor });
  });

  /**
   * Approve vendor
   */
  approveVendor = catchAsync(async (req, res) => {
    const { vendorId } = req.params;
    
    const vendor = await AdminVendorService.approveVendor(
      vendorId,
      req.admin._id,
      req.body
    );
    
    return ApiResponse.success(res, 200, 'Vendor approved successfully', { vendor });
  });

  /**
   * Reject vendor
   */
  rejectVendor = catchAsync(async (req, res) => {
    const { vendorId } = req.params;
    const { reason, notes } = req.body;
    
    if (!reason) {
      throw new AppError('Rejection reason is required', 400);
    }
    
    const vendor = await AdminVendorService.rejectVendor(
      vendorId,
      req.admin._id,
      { reason, notes, sendEmail: true }
    );
    
    return ApiResponse.success(res, 200, 'Vendor rejected successfully', { vendor });
  });

  /**
   * Suspend vendor
   */
  suspendVendor = catchAsync(async (req, res) => {
    const { vendorId } = req.params;
    const { reason, notes, duration } = req.body;
    
    if (!reason) {
      throw new AppError('Suspension reason is required', 400);
    }
    
    const vendor = await AdminVendorService.suspendVendor(
      vendorId,
      req.admin._id,
      { reason, notes, duration, sendEmail: true }
    );
    
    return ApiResponse.success(res, 200, 'Vendor suspended successfully', { vendor });
  });

  /**
   * Reinstate vendor
   */
  reinstateVendor = catchAsync(async (req, res) => {
    const { vendorId } = req.params;
    
    const vendor = await AdminVendorService.reinstateVendor(
      vendorId,
      req.admin._id,
      req.body
    );
    
    return ApiResponse.success(res, 200, 'Vendor reinstated successfully', { vendor });
  });

  /**
   * Update vendor commission
   */
  updateVendorCommission = catchAsync(async (req, res) => {
    const { vendorId } = req.params;
    
    const commission = await AdminVendorService.updateVendorCommission(
      vendorId,
      req.admin._id,
      req.body
    );
    
    return ApiResponse.success(res, 200, 'Commission updated successfully', { commission });
  });

  /**
   * Get vendor documents
   */
  getVendorDocuments = catchAsync(async (req, res) => {
    const { vendorId } = req.params;
    
    const documents = await AdminVendorService.getVendorDocuments(vendorId);
    
    return ApiResponse.success(res, 200, 'Vendor documents retrieved successfully', { documents });
  });

  /**
   * Verify vendor document
   */
  verifyVendorDocument = catchAsync(async (req, res) => {
    const { vendorId, documentIndex } = req.params;
    
    const document = await AdminVendorService.verifyVendorDocument(
      vendorId,
      parseInt(documentIndex),
      req.admin._id,
      req.body
    );
    
    return ApiResponse.success(res, 200, 'Document verified successfully', { document });
  });

  /**
   * Get vendor statistics
   */
  getVendorStats = catchAsync(async (req, res) => {
    const stats = await AdminVendorService.getVendorStats();
    
    return ApiResponse.success(res, 200, 'Vendor statistics retrieved successfully', stats);
  });
}

module.exports = new AdminVendorController();