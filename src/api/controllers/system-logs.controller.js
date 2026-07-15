const logsService = require('../../services/logs.service');
const catchAsync = require('../../utils/catchAsync');
const {ApiResponse} = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');

class SystemLogsController {
  getLogs = catchAsync(async (req, res) => {
    const { type } = req.params;
    const { page = 1, limit = 50, ...filters } = req.query;
    const result = await logsService.getLogs(type, parseInt(page), parseInt(limit), filters);
    return ApiResponse.paginated(res, result.logs, parseInt(page), parseInt(limit), result.pagination.total, 'Logs retrieved successfully');
  });

  getLogStats = catchAsync(async (req, res) => {
    const stats = await logsService.getLogStats();
    return ApiResponse.success(res, 200, 'Log stats retrieved successfully', stats);
  });

  resolveError = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await logsService.resolveError(id);
    return ApiResponse.success(res, 200, result.message, result.log);
  });

  exportLogs = catchAsync(async (req, res) => {
    const { type, format = 'json' } = req.query;
    if (!type) throw new AppError('Log type is required', 400);

    const result = await logsService.exportLogs(type, format);

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename=${result.filename}`);

    if (result.buffer) {
      return res.send(result.buffer);
    }

    return res.json(result.data);
  });

  clearLogs = catchAsync(async (req, res) => {
    const { type } = req.query;
    if (!type) throw new AppError('Log type is required', 400);

    const result = await logsService.clearLogs(type);
    return ApiResponse.success(res, 200, result.message);
  });
}

module.exports = new SystemLogsController();
