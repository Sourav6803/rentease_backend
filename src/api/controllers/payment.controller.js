const PaymentService = require('../../services/payment.service');
const { Payment } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const {ApiResponse} = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');

class PaymentController {
  /**
   * Initiate payment
   */
  initiatePayment = catchAsync(async (req, res) => {
    const paymentData = {
      ...req.body,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    };

    const result = await PaymentService.initiatePayment(req.user._id, paymentData);
    
    return ApiResponse.success(res, 200, 'Payment initiated successfully', result);
  });

  /**
   * Verify payment
   */
  verifyPayment = catchAsync(async (req, res) => {
    const { paymentId } = req.params;
    const verificationData = req.body;

    const payment = await PaymentService.verifyPayment(paymentId, verificationData);
    
    return ApiResponse.success(res, 200, 'Payment verified successfully', { payment });
  });

  /**
   * Get payment by ID
   */
  getPayment = catchAsync(async (req, res) => {
    const { id } = req.params;
    const payment = await PaymentService.getPayment(id, req.user._id, req.user.role);
    
    return ApiResponse.success(res, 200, 'Payment retrieved successfully', { payment });
  });

  /**
   * Get user payments
   */
  getUserPayments = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    
    const payments = await PaymentService.getUserPayments(
      req.user._id,
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Payments retrieved successfully', payments);
  });

  /**
   * Get vendor payments
   */
  getVendorPayments = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    
    const payments = await PaymentService.getVendorPayments(
      req.user._id,
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Vendor payments retrieved successfully', payments);
  });

  /**
   * Get payment statistics
   */
  getPaymentStats = catchAsync(async (req, res) => {
    const { period = 'month' } = req.query;
    
    const stats = await PaymentService.getPaymentStats(req.user._id, req.user.role, period);
    
    return ApiResponse.success(res, 200, 'Payment statistics retrieved successfully', stats);
  });

  /**
   * Generate payment receipt
   */
  generateReceipt = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const receipt = await PaymentService.generateReceipt(id);
    
    return ApiResponse.success(res, 200, 'Receipt generated successfully', { receipt });
  });

  /**
   * Download receipt as PDF
   */
  downloadReceipt = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const receipt = await PaymentService.generateReceipt(id);
    
    // Generate PDF (you would implement this with a PDF library)
    // const pdf = await generatePDF(receipt);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=receipt-${receipt.receiptNumber}.pdf`);
    
    // res.send(pdf);
    return res.json({ message: 'PDF generation not implemented yet', receipt });
  });

  /**
   * Get payment methods
   */
  getPaymentMethods = catchAsync(async (req, res) => {
    // This would fetch user's saved payment methods
    const methods = [
      {
        id: 'card_1',
        type: 'card',
        last4: '4242',
        brand: 'visa',
        expMonth: 12,
        expYear: 2025,
        isDefault: true
      }
    ];
    
    return ApiResponse.success(res, 200, 'Payment methods retrieved successfully', { methods });
  });

  /**
   * Add payment method
   */
  addPaymentMethod = catchAsync(async (req, res) => {
    const { paymentMethodId } = req.body;
    
    // This would save payment method to user's account
    // Implementation depends on payment gateway
    
    return ApiResponse.success(res, 200, 'Payment method added successfully');
  });

  /**
   * Remove payment method
   */
  removePaymentMethod = catchAsync(async (req, res) => {
    const { methodId } = req.params;
    
    // Remove payment method
    
    return ApiResponse.success(res, 200, 'Payment method removed successfully');
  });

  /**
   * Set default payment method
   */
  setDefaultPaymentMethod = catchAsync(async (req, res) => {
    const { methodId } = req.params;
    
    // Set as default
    
    return ApiResponse.success(res, 200, 'Default payment method updated');
  });

  // ==================== ADMIN ROUTES ====================

  /**
   * Process refund (admin only)
   */
  processRefund = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const payment = await PaymentService.processRefund(id, req.admin._id, req.body);
    
    return ApiResponse.success(res, 200, 'Refund processed successfully', { payment });
  });

  /**
   * Get all payments (admin only)
   */
  getAllPayments = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    
    // Use vendor payments method but with admin privileges
    const payments = await PaymentService.getVendorPayments(
      null,
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'All payments retrieved successfully', payments);
  });

  /**
   * Get payment analytics (admin only)
   */
  getPaymentAnalytics = catchAsync(async (req, res) => {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      throw new AppError('Start date and end date are required', 400);
    }

    const analytics = await Payment.aggregate([
      {
        $match: {
          status: 'success',
          createdAt: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          }
        }
      },
      {
        $facet: {
          overview: [
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: '$amount' },
                totalTransactions: { $sum: 1 },
                averageTransaction: { $avg: '$amount' }
              }
            }
          ],
          byGateway: [
            {
              $group: {
                _id: '$paymentDetails.gateway',
                count: { $sum: 1 },
                amount: { $sum: '$amount' }
              }
            }
          ],
          byMethod: [
            {
              $group: {
                _id: '$method',
                count: { $sum: 1 },
                amount: { $sum: '$amount' }
              }
            }
          ],
          byType: [
            {
              $group: {
                _id: '$type',
                count: { $sum: 1 },
                amount: { $sum: '$amount' }
              }
            }
          ],
          dailyRevenue: [
            {
              $group: {
                _id: {
                  year: { $year: '$createdAt' },
                  month: { $month: '$createdAt' },
                  day: { $dayOfMonth: '$createdAt' }
                },
                revenue: { $sum: '$amount' },
                transactions: { $sum: 1 }
              }
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
          ]
        }
      }
    ]);

    return ApiResponse.success(res, 200, 'Payment analytics retrieved successfully', analytics[0]);
  });

  /**
   * Trigger monthly payments (admin only)
   */
  triggerMonthlyPayments = catchAsync(async (req, res) => {
    const results = await PaymentService.processMonthlyPayments();
    
    return ApiResponse.success(res, 200, 'Monthly payments processed', results);
  });
}

module.exports = new PaymentController();