const apiKeysService = require('../../services/api-keys.service');
const catchAsync = require('../../utils/catchAsync');
const {ApiResponse} = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');

class ApiKeysController {
  getApiKeys = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    const result = await apiKeysService.getAllKeys(parseInt(page), parseInt(limit), filters);
    return ApiResponse.paginated(res, result.keys, parseInt(page), parseInt(limit), result.pagination.total, 'API keys retrieved successfully');
  });

  getApiKeyStats = catchAsync(async (req, res) => {
    const stats = await apiKeysService.getKeyStats();
    return ApiResponse.success(res, 200, 'API key stats retrieved successfully', stats);
  });

  createApiKey = catchAsync(async (req, res) => {
    const apiKey = await apiKeysService.createKey(req.body, { _id: req.admin._id, name: req.admin.profile?.firstName + ' ' + req.admin.profile?.lastName, email: req.admin.email });
    return ApiResponse.created(res, 'API key created successfully', apiKey);
  });

  regenerateApiKey = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await apiKeysService.regenerateKey(id);
    return ApiResponse.success(res, 200, result.message, result);
  });

  revokeApiKey = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await apiKeysService.revokeKey(id);
    return ApiResponse.success(res, 200, result.message);
  });
}

module.exports = new ApiKeysController();
