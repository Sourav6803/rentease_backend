const DispatchService = require('../../services/dispatch.service');
const DeliveryAIService = require('../../services/delivery-ai.service');
const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const { AppError } = require('../../utils/AppError');

class DispatchController {
  /** Pool: unassigned scheduled deliveries for admin dashboard */
  getPool = catchAsync(async (req, res) => {
    const { page = 1, limit = 20, includeSuggestions, ...filters } = req.query;
    const result = await DispatchService.getDispatchPool(
      parseInt(page, 10),
      parseInt(limit, 10),
      { ...filters, includeSuggestions },
    );
    return ApiResponse.success(res, 200, 'Dispatch pool retrieved', result);
  });

  /** Ranked best partners for one delivery */
  getSuggestions = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    const { limit, minScoreThreshold } = req.query;
    const result = await DispatchService.getSuggestionsForDelivery(deliveryId, {
      limit: limit ? parseInt(limit, 10) : 10,
      minScoreThreshold: minScoreThreshold ? parseInt(minScoreThreshold, 10) : 0,
    });
    return ApiResponse.success(res, 200, 'Personnel suggestions retrieved', result);
  });

  createBatch = catchAsync(async (req, res) => {
    const { deliveryIds, zone, notes, tags } = req.body;
    if (!deliveryIds?.length) {
      throw new AppError('deliveryIds array is required', 400);
    }
    const batch = await DispatchService.createBatch(deliveryIds, req.user._id, {
      zone,
      notes,
      tags,
    });
    return ApiResponse.success(res, 201, 'Dispatch batch created', { batch });
  });

  listBatches = catchAsync(async (req, res) => {
    const { page = 1, limit = 20, status, date } = req.query;
    const result = await DispatchService.listBatches(
      { status, date },
      parseInt(page, 10),
      parseInt(limit, 10),
    );
    return ApiResponse.success(res, 200, 'Dispatch batches retrieved', result);
  });

  assignBatch = catchAsync(async (req, res) => {
    const { batchId } = req.params;
    const { personId, type, notes, force } = req.body;
    const result = await DispatchService.assignBatch(batchId, {
      personId,
      type,
      notes,
      force: force === true,
      assignedBy: req.user._id,
    });
    return ApiResponse.success(res, 200, 'Batch assigned successfully', result);
  });

  cancelBatch = catchAsync(async (req, res) => {
    const { batchId } = req.params;
    const batch = await DispatchService.cancelBatch(batchId, req.user._id);
    return ApiResponse.success(res, 200, 'Batch cancelled', { batch });
  });

  assignSingle = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    const { type, personId, teamId, notes, force } = req.body;
    const delivery = await DispatchService.assignSingleDelivery(deliveryId, {
      type,
      personId,
      teamId,
      notes,
      force: force === true,
      assignedBy: req.user._id,
    });
    return ApiResponse.success(res, 200, 'Delivery assigned successfully', { delivery });
  });

  optimizeBatchRoute = catchAsync(async (req, res) => {
    const { personId, deliveryIds } = req.body;
    if (!personId || !deliveryIds?.length) {
      throw new AppError('personId and deliveryIds are required', 400);
    }
    const route = await DeliveryAIService.optimizeRoute(personId, deliveryIds);
    return ApiResponse.success(res, 200, 'Route optimized', route);
  });
}

module.exports = new DispatchController();
