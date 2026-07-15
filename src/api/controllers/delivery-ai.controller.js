// controllers/delivery-ai.controller.js
const DeliveryAIService = require('../../services/delivery-ai.service');
const DeliveryOTPService = require('../../services/delivery-otp.service');
const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const { AppError } = require('../../utils/AppError');
const logger = require('../../config/logger');

class DeliveryAIController {
  /**
   * Auto-assign delivery using AI
   */
  autoAssignDelivery = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    const { minScoreThreshold, considerPreferences, trafficData } = req.body;

    const result = await DeliveryAIService.autoAssignDelivery(deliveryId, {
      minScoreThreshold,
      considerPreferences: considerPreferences !== false,
      trafficData
    });

    return ApiResponse.success(res, 200, 'AI auto-assignment completed', result);
  });

  /**
   * Batch auto-assign multiple deliveries
   */
  batchAutoAssignDeliveries = catchAsync(async (req, res) => {
    const { deliveryIds, minScoreThreshold, considerPreferences } = req.body;

    if (!deliveryIds || deliveryIds.length === 0) {
      throw new AppError('Delivery IDs are required', 400);
    }

    const results = await DeliveryAIService.batchAutoAssignDeliveries(deliveryIds, {
      minScoreThreshold,
      considerPreferences: considerPreferences !== false
    });

    return ApiResponse.success(res, 200, 'Batch auto-assignment completed', results);
  });

  /**
   * Find best delivery person for a delivery
   */
  findBestDeliveryPerson = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    const { minScoreThreshold, considerPreferences } = req.query;

    const result = await DeliveryAIService.findBestDeliveryPerson(deliveryId, {
      minScoreThreshold: minScoreThreshold ? parseInt(minScoreThreshold) : undefined,
      considerPreferences: considerPreferences !== 'false'
    });

    return ApiResponse.success(res, 200, 'Best delivery person found', result);
  });

  /**
   * Optimize delivery route for multiple deliveries
   */
  optimizeDeliveryRoute = catchAsync(async (req, res) => {
    const { personId } = req.params;
    const { deliveryIds } = req.body;

    if (!deliveryIds || deliveryIds.length === 0) {
      throw new AppError('Delivery IDs are required', 400);
    }

    const optimizedRoute = await DeliveryAIService.optimizeRoute(personId, deliveryIds);

    return ApiResponse.success(res, 200, 'Route optimized successfully', optimizedRoute);
  });

  /**
   * Get AI assignment suggestions
   */
  getAssignmentSuggestions = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;

    const ranked = await DeliveryAIService.getRankedSuggestions(deliveryId, {
      minScoreThreshold: 40,
      limit: 10,
    });

    return ApiResponse.success(res, 200, 'Assignment suggestions retrieved', {
      ...ranked,
      reasoning: {
        factors: ['Distance', 'Workload', 'Rating', 'On-Time Performance', 'Battery'],
        weights: DeliveryAIService.weights,
      },
    });
  });

  /**
   * Generate OTP for delivery
   */
  generateOTP = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    const { customerPhone, length, expiryMinutes } = req.body;

    const result = await DeliveryOTPService.createDeliveryOTP(deliveryId, customerPhone, {
      length: length || 6,
      expiryMinutes: expiryMinutes || 5
    });

    return ApiResponse.success(res, 200, 'OTP generated and sent successfully', result);
  });

  /**
   * Verify OTP
   */
  verifyOTP = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    const { otp } = req.body;

    const result = await DeliveryOTPService.verifyDeliveryOTP(deliveryId, otp);

    if (!result.verified) {
      throw new AppError(result.error, 400, result.code);
    }

    return ApiResponse.success(res, 200, 'OTP verified successfully', result);
  });
}

module.exports = new DeliveryAIController();