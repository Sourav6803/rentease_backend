const RentalService = require('../../services/rental.service');
const catchAsync = require('../../utils/catchAsync');
const {ApiResponse} = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const PDFService = require('../../services/pdf.service');
const fs = require('fs');
const path = require('path');
const moment = require('moment');

class RentalController {
  /**
   * Create new rental
   */
  createRental = catchAsync(async (req, res) => {
    const rental = await RentalService.createRental(req.user._id, req.body);
    
    
    return ApiResponse.success(res, 201, 'Rental created successfully', { rental });
  });

  /**
   * Create new rental from cart (NEW)
   */
  createRentalFromCart = catchAsync(async (req, res) => {
    const { cartId, addressId, deliverySlot, specialRequests } = req.body;

    console.log('Creating rental from cart with data:', { cartId, addressId, deliverySlot, specialRequests });
    
    const rental = await RentalService.createRentalFromCart(
      req.user._id,
      cartId,
      addressId,
      { deliverySlot, specialRequests }
    );
    
    return ApiResponse.success(res, 201, 'Rental created successfully from cart', { rental });
  });

  /**
   * Get rental by ID
   */
  getRental = catchAsync(async (req, res) => {
    const { id } = req.params;
    const rental = await RentalService.getRental(id, req.user._id, req.user.role);
    
    return ApiResponse.success(res, 200, 'Rental retrieved successfully', { rental });
  });

  /**
   * Get user rentals
   */
  getUserRentals = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    
    const rentals = await RentalService.getUserRentals(
      req.user._id,
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Rentals retrieved successfully', rentals);
  });

  /**
   * Get vendor rentals (vendor only)
   */
  getVendorRentals = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    
    const rentals = await RentalService.getVendorRentals(
      req.user._id,
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Vendor rentals retrieved successfully', rentals);
  });

  /**
   * Confirm rental (vendor only)
   */
  confirmRental = catchAsync(async (req, res) => {
    const { id } = req.params;
    const rental = await RentalService.confirmRental(id, req.user._id);
    
    return ApiResponse.success(res, 200, 'Rental confirmed successfully', { rental });
  });

  /**
   * Cancel rental
   */
  cancelRental = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    
    if (!reason) {
      throw new AppError('Cancellation reason is required', 400);
    }

    const rental = await RentalService.cancelRental(
      id,
      req.user._id,
      req.user.role,
      reason
    );
    
    return ApiResponse.success(res, 200, 'Rental cancelled successfully', { rental });
  });

  /**
   * Extend rental
   */
  extendRental = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { extensionMonths } = req.body;
    
    if (!extensionMonths || extensionMonths < 1 || extensionMonths > 6) {
      throw new AppError('Extension months must be between 1 and 6', 400);
    }

    const rental = await RentalService.extendRental(id, req.user._id, extensionMonths);
    
    return ApiResponse.success(res, 200, 'Extension requested successfully', { rental });
  });

  /**
   * Approve extension (vendor only)
   */
  approveExtension = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { extensionIndex } = req.body;
    
    if (extensionIndex === undefined) {
      throw new AppError('Extension index is required', 400);
    }

    const rental = await RentalService.approveExtension(id, req.user._id, extensionIndex);
    
    return ApiResponse.success(res, 200, 'Extension approved successfully', { rental });
  });

  /**
   * Mark as delivered (vendor only)
   */
  markAsDelivered = catchAsync(async (req, res) => {
    const { id } = req.params;
    const deliveryData = req.body;
    
    const rental = await RentalService.markAsDelivered(id, deliveryData);
    
    return ApiResponse.success(res, 200, 'Rental marked as delivered', { rental });
  });

  /**
   * Mark as active (vendor only)
   */
  markAsActive = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const rental = await RentalService.markAsActive(id);
    
    return ApiResponse.success(res, 200, 'Rental marked as active', { rental });
  });

  /**
   * Initiate return
   */
  initiateReturn = catchAsync(async (req, res) => {
    const { id } = req.params;
    const returnData = req.body;
    
    const rental = await RentalService.initiateReturn(id, req.user._id, returnData);
    
    return ApiResponse.success(res, 200, 'Return initiated successfully', { rental });
  });

  /**
   * Complete return (vendor only)
   */
  completeReturn = catchAsync(async (req, res) => {
    const { id } = req.params;
    const returnData = req.body;
    
    const rental = await RentalService.completeReturn(id, req.user._id, returnData);
    
    return ApiResponse.success(res, 200, 'Return completed successfully', { rental });
  });

  /**
   * Get rental timeline
   */
  getTimeline = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const timeline = await RentalService.getRentalTimeline(id);
    
    return ApiResponse.success(res, 200, 'Timeline retrieved successfully', { timeline });
  });

  /**
   * Get rental statistics
   */
  getStats = catchAsync(async (req, res) => {
    const stats = await RentalService.getRentalStats(req.user._id, req.user.role);
    
    return ApiResponse.success(res, 200, 'Rental statistics retrieved successfully', stats);
  });

  /**
   * Check availability
   */
  checkAvailability = catchAsync(async (req, res) => {
    const { productId, startDate, endDate } = req.query;
    
    if (!productId || !startDate || !endDate) {
      throw new AppError('Product ID, start date, and end date are required', 400);
    }

    const availability = await RentalService.checkProductAvailability(
      productId,
      new Date(startDate),
      new Date(endDate)
    );
    
    return ApiResponse.success(res, 200, 'Availability checked successfully', availability);
  });

  /**
   * Generate invoice
   */
  generateInvoice = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const invoice = await RentalService.generateInvoice(id);
    
    return ApiResponse.success(res, 200, 'Invoice generated successfully', { invoice });
  });

  /**
   * Download invoice as PDF
   */
  // downloadInvoice = catchAsync(async (req, res) => {
  //   const { id } = req.params;
    
  //   const invoice = await RentalService.generateInvoice(id);
    
  //   // Generate PDF (you would implement this with a PDF library)
  //   // const pdf = await generatePDF(invoice);
    
  //   res.setHeader('Content-Type', 'application/pdf');
  //   res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice.invoiceNumber}.pdf`);
    
  //   // res.send(pdf);
  //   return res.json({ message: 'PDF generation not implemented yet', invoice });
  // });

  // Add this method to your rental controller
downloadInvoice = catchAsync(async (req, res) => {
  const { id } = req.params;
  
  // Get invoice data
  const invoice = await RentalService.generateInvoice(id);
  
  // Create temp directory if it doesn't exist
  const tempDir = path.join(__dirname, '../temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  // Generate PDF
  const pdfPath = path.join(tempDir, `invoice-${id}-${Date.now()}.pdf`);
  await PDFService.generateInvoicePDF(invoice, pdfPath);
  
  // Send file
  res.download(pdfPath, `invoice-${invoice.rental.number}.pdf`, (err) => {
    if (err) {
      console.error('Error downloading invoice:', err);
    }
    // Clean up temp file after download
    fs.unlink(pdfPath, (unlinkErr) => {
      if (unlinkErr) console.error('Error deleting temp file:', unlinkErr);
    });
  });
});
  /**
   * Get rental summary for dashboard
   */
  getDashboardSummary = catchAsync(async (req, res) => {
    const userId = req.user._id;
    const role = req.user.role;

    const [stats, recentRentals, upcomingReturns] = await Promise.all([
      RentalService.getRentalStats(userId, role),
      RentalService.getUserRentals(userId, 1, 5),
      RentalService.getUserRentals(userId, 1, 5, { 
        status: 'active',
        endDate: { $gte: new Date(), $lte: moment().add(7, 'days').toDate() }
      })
    ]);

    return ApiResponse.success(res, 200, 'Dashboard summary retrieved successfully', {
      stats,
      recentRentals: recentRentals.rentals,
      upcomingReturns: upcomingReturns.rentals
    });
  });

  /**
   * Admin: Get all rentals
   */
  getAllRentals = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    
    // Use vendor rentals method but with admin privileges
    const rentals = await RentalService.getVendorRentals(
      null, // No vendor filter
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'All rentals retrieved successfully', rentals);
  });

  /**
   * Admin: Get overdue rentals
   */
  getOverdueRentals = catchAsync(async (req, res) => {
    const { page = 1, limit = 10 } = req.query;
    
    const rentals = await RentalService.getVendorRentals(
      null,
      parseInt(page),
      parseInt(limit),
      { status: 'overdue' }
    );
    
    return ApiResponse.success(res, 200, 'Overdue rentals retrieved successfully', rentals);
  });

  /**
   * Admin: Force complete rental
   */
  forceCompleteRental = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    
    // This would be a special admin-only operation
    // You would implement a forceComplete method in the service
    
    return ApiResponse.success(res, 200, 'Rental force completed successfully');
  });
}

module.exports = new RentalController();