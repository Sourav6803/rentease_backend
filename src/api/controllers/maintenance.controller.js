const MaintenanceService = require('../../services/maintenance.service');
const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');

class MaintenanceController {
  /**
   * Create maintenance request
   */
  createRequest = catchAsync(async (req, res) => {
    const request = await MaintenanceService.createRequest(req.user._id, req.body);
    
    return ApiResponse.success(res, 201, 'Maintenance request created successfully', { request });
  });

  /**
   * Get maintenance request by ID
   */
  getRequest = catchAsync(async (req, res) => {
    const { id } = req.params;
    const request = await MaintenanceService.getRequest(id, req.user._id, req.user.role);
    
    return ApiResponse.success(res, 200, 'Maintenance request retrieved successfully', { request });
  });

  /**
   * Get user maintenance requests
   */
  getUserRequests = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    
    const requests = await MaintenanceService.getUserRequests(
      req.user._id,
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Maintenance requests retrieved successfully', requests);
  });

  /**
   * Get vendor maintenance requests
   */
  getVendorRequests = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    
    const requests = await MaintenanceService.getVendorRequests(
      req.user._id,
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Vendor maintenance requests retrieved successfully', requests);
  });

  /**
   * Get maintenance statistics
   */
  getStats = catchAsync(async (req, res) => {
    const stats = await MaintenanceService.getMaintenanceStats(req.user._id, req.user.role);
    
    return ApiResponse.success(res, 200, 'Maintenance statistics retrieved successfully', stats);
  });

  /**
   * Assign technician
   */
  assignTechnician = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { technicianId } = req.body;
    
    if (!technicianId) {
      throw new AppError('Technician ID is required', 400);
    }

    const request = await MaintenanceService.assignTechnician(id, req.user._id, technicianId);
    
    return ApiResponse.success(res, 200, 'Technician assigned successfully', { request });
  });

  /**
   * Schedule visit
   */
  scheduleVisit = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const request = await MaintenanceService.scheduleVisit(id, req.user._id, req.body);
    
    return ApiResponse.success(res, 200, 'Visit scheduled successfully', { request });
  });

  /**
   * Start work
   */
  startWork = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const request = await MaintenanceService.startWork(id, req.user._id, req.body);
    
    return ApiResponse.success(res, 200, 'Work started successfully', { request });
  });

  /**
   * Complete work
   */
  completeWork = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const request = await MaintenanceService.completeWork(id, req.user._id, req.body);
    
    return ApiResponse.success(res, 200, 'Work completed successfully', { request });
  });

  /**
   * Cancel request
   */
  cancelRequest = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    
    if (!reason) {
      throw new AppError('Cancellation reason is required', 400);
    }

    const request = await MaintenanceService.cancelRequest(id, req.user._id, req.user.role, reason);
    
    return ApiResponse.success(res, 200, 'Request cancelled successfully', { request });
  });

  /**
   * Add parts required
   */
  addPartsRequired = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { parts } = req.body;
    
    if (!parts || !Array.isArray(parts)) {
      throw new AppError('Parts must be an array', 400);
    }

    const request = await MaintenanceService.addPartsRequired(id, req.user._id, parts);
    
    return ApiResponse.success(res, 200, 'Parts added successfully', { request });
  });

  /**
   * Add feedback
   */
  addFeedback = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const request = await MaintenanceService.addFeedback(id, req.user._id, req.body);
    
    return ApiResponse.success(res, 200, 'Feedback submitted successfully', { request });
  });

  /**
   * Get technician workload
   */
  getTechnicianWorkload = catchAsync(async (req, res) => {
    const { technicianId } = req.params;
    
    const workload = await MaintenanceService.getTechnicianWorkload(technicianId);
    
    return ApiResponse.success(res, 200, 'Technician workload retrieved successfully', workload);
  });

  /**
   * Generate report (vendor only)
   */
  generateReport = catchAsync(async (req, res) => {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      throw new AppError('Start date and end date are required', 400);
    }

    const report = await MaintenanceService.generateReport(req.user._id, startDate, endDate);
    
    return ApiResponse.success(res, 200, 'Report generated successfully', report);
  });

  /**
   * Export report (vendor only)
   */
  exportReport = catchAsync(async (req, res) => {
    const { startDate, endDate, format = 'json' } = req.query;
    
    if (!startDate || !endDate) {
      throw new AppError('Start date and end date are required', 400);
    }

    const report = await MaintenanceService.generateReport(req.user._id, startDate, endDate);

    if (format === 'csv') {
      // Flatten data for CSV
      const csvData = [];
      
      report.byIssueType?.forEach(item => {
        csvData.push({
          type: 'Issue Type',
          category: item._id,
          count: item.count,
          cost: item.cost
        });
      });

      report.byPriority?.forEach(item => {
        csvData.push({
          type: 'Priority',
          category: item._id,
          count: item.count,
          avgResolutionHours: item.avgResolutionTime ? 
            Math.round(item.avgResolutionTime / (1000 * 60 * 60)) : 0
        });
      });

      const { Parser } = require('json2csv');
      const parser = new Parser();
      const csv = parser.parse(csvData);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=maintenance-report-${startDate}-to-${endDate}.csv`);
      return res.send(csv);
    }

    return ApiResponse.success(res, 200, 'Report generated successfully', report);
  });

  // ==================== ADMIN ROUTES ====================

  /**
   * Get all maintenance requests (admin)
   */
  getAllRequests = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    
    // Use vendor requests method with admin privileges
    const requests = await MaintenanceService.getVendorRequests(
      null,
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'All maintenance requests retrieved successfully', requests);
  });

  /**
   * Get SLA breaches (admin)
   */
  getSLABreaches = catchAsync(async (req, res) => {
    const breaches = await Maintenance.find({
      status: { $in: ['pending', 'assigned', 'scheduled', 'in_progress'] },
      'sla.responseDue': { $lt: new Date() }
    })
    .populate('vendor', 'business.name')
    .populate('user', 'profile.firstName profile.lastName')
    .populate('product', 'basicInfo.name')
    .sort({ 'sla.responseDue': 1 })
    .lean();

    return ApiResponse.success(res, 200, 'SLA breaches retrieved successfully', { breaches });
  });

  /**
   * Escalate request (admin)
   */
  escalateRequest = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const request = await MaintenanceService.escalateRequest(id);
    
    return ApiResponse.success(res, 200, 'Request escalated successfully', { request });
  });

  /**
   * Get maintenance analytics (admin)
   */
  getMaintenanceAnalytics = catchAsync(async (req, res) => {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      throw new AppError('Start date and end date are required', 400);
    }

    const analytics = await Maintenance.aggregate([
      {
        $match: {
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
                totalRequests: { $sum: 1 },
                completedRequests: {
                  $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                },
                totalCost: { $sum: '$resolution.cost.total' },
                averageResolutionTime: {
                  $avg: {
                    $subtract: ['$schedule.actualEndDate', '$createdAt']
                  }
                }
              }
            }
          ],
          byVendor: [
            {
              $group: {
                _id: '$vendor',
                count: { $sum: 1 },
                completed: {
                  $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                },
                cost: { $sum: '$resolution.cost.total' }
              }
            },
            {
              $lookup: {
                from: 'vendors',
                localField: '_id',
                foreignField: 'user',
                as: 'vendor'
              }
            },
            { $unwind: '$vendor' },
            {
              $project: {
                vendorName: '$vendor.business.name',
                count: 1,
                completed: 1,
                cost: 1,
                completionRate: {
                  $multiply: [
                    { $divide: ['$completed', { $max: ['$count', 1] }] },
                    100
                  ]
                }
              }
            },
            { $sort: { count: -1 } }
          ],
          slaPerformance: [
            {
              $match: {
                status: 'completed',
                'sla.responseDue': { $exists: true }
              }
            },
            {
              $project: {
                withinSLA: {
                  $lte: ['$schedule.actualStartDate', '$sla.responseDue']
                },
                responseTime: {
                  $subtract: ['$schedule.actualStartDate', '$createdAt']
                }
              }
            },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                withinSLA: { $sum: { $cond: ['$withinSLA', 1, 0] } },
                avgResponseTime: { $avg: '$responseTime' }
              }
            }
          ]
        }
      }
    ]);

    return ApiResponse.success(res, 200, 'Maintenance analytics retrieved successfully', analytics[0]);
  });
}

module.exports = new MaintenanceController();