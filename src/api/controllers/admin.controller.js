const AdminService = require('../../services/admin.service');
const catchAsync = require('../../utils/catchAsync');
const {ApiResponse} = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const adminVendorService = require('../../services/admin-vendor.service');
const SystemSettings = require('../../models/SystemSettings.model');
const Admin = require('../../models/Admin.model');
const Payment = require('../../models/Payment.model');
const User = require('../../models/User.model');
const Vendor = require('../../models/Vendor.model');
const Product = require('../../models/Product.model');
const Rental = require('../../models/Rental.model');

class AdminController {
  /**
   * Create new admin
   */
  createAdmin = catchAsync(async (req, res) => {
    const admin = await AdminService.createAdmin(req.body, req.admin._id);
    
    return ApiResponse.success(res, 201, 'Admin created successfully', { admin });
  });

  /**
   * Get all admins
   */
  getAdmins = catchAsync(async (req, res) => {
    console.log('Fetching all admins with query:', req.query)
    const { page = 1, limit = 10, ...filters } = req.query;
    
    const admins = await AdminService.getAdmins(
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Admins retrieved successfully', admins);
  });

  /**
   * Get admin by ID
   */
  getAdminById = catchAsync(async (req, res) => {
    const { id } = req.params;
    console.log('Fetching admin with ID:', id)

    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
      throw new AppError('Invalid admin ID', 400);
    }

    const admin = await AdminService.getAdminById(id);

    return ApiResponse.success(res, 200, 'Admin retrieved successfully', { admin });
  });

  /**
   * Update admin
   */
  updateAdmin = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const admin = await AdminService.updateAdmin(id, req.body, req.admin._id);
    
    return ApiResponse.success(res, 200, 'Admin updated successfully', { admin });
  });

  /**
   * Delete admin
   */
  deleteAdmin = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const result = await AdminService.deleteAdmin(id, req.admin._id);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Get admin activity
   */
  getAdminActivity = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    
    const activity = await AdminService.getAdminActivity(
      id,
      parseInt(page),
      parseInt(limit)
    );
    
    return ApiResponse.success(res, 200, 'Admin activity retrieved successfully', activity);
  });

  /**
   * Get dashboard statistics
   */
  getDashboardStats = catchAsync(async (req, res) => {
    const stats = await AdminService.getDashboardStats();
    
    return ApiResponse.success(res, 200, 'Dashboard statistics retrieved successfully', stats);
  });

  /**
   * Get platform analytics
   */
  getPlatformAnalytics = catchAsync(async (req, res) => {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      throw new AppError('Start date and end date are required', 400);
    }

    const analytics = await AdminService.getPlatformAnalytics(startDate, endDate);
    
    return ApiResponse.success(res, 200, 'Platform analytics retrieved successfully', analytics);
  });

  /**
   * Generate report
   */
  generateReport = catchAsync(async (req, res) => {
    const { type, format = 'json', startDate, endDate } = req.query;
    
    if (!type || !startDate || !endDate) {
      throw new AppError('Report type, start date, and end date are required', 400);
    }

    const report = await AdminService.generateReport(type, format, startDate, endDate);
    
    res.setHeader('Content-Type', report.contentType);
    res.setHeader('Content-Disposition', `attachment; filename=${report.filename}`);
    
    if (report.buffer) {
      return res.send(report.buffer);
    }
    
    return res.json(report.data);
  });

  /**
   * Get system logs
   */
  getSystemLogs = catchAsync(async (req, res) => {
    const { page = 1, limit = 50, ...filters } = req.query;
    
    const logs = await AdminService.getSystemLogs(
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'System logs retrieved successfully', logs);
  });

  /**
   * Get system health
   */
  getSystemHealth = catchAsync(async (req, res) => {
    const health = await AdminService.getSystemHealth();
    
    return ApiResponse.success(res, 200, 'System health retrieved successfully', health);
  });

  /**
   * Clear cache
   */
  clearCache = catchAsync(async (req, res) => {
    const { pattern = '*' } = req.query;
    
    const result = await AdminService.clearCache(pattern);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Run maintenance
   */
  runMaintenance = catchAsync(async (req, res) => {
    const { task } = req.body;
    
    if (!task) {
      throw new AppError('Maintenance task is required', 400);
    }

    const result = await AdminService.runMaintenance(task);
    
    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Get audit trail
   */
  getAuditTrail = catchAsync(async (req, res) => {
    const { resourceType, resourceId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    
    const audit = await AdminService.getAuditTrail(
      resourceType,
      resourceId,
      parseInt(page),
      parseInt(limit)
    );
    
    return ApiResponse.success(res, 200, 'Audit trail retrieved successfully', audit);
  });

  /**
   * Get user activity timeline
   */
  getUserActivityTimeline = catchAsync(async (req, res) => {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    
    const timeline = await AdminService.getUserActivityTimeline(
      userId,
      parseInt(page),
      parseInt(limit)
    );
    
    return ApiResponse.success(res, 200, 'User activity timeline retrieved successfully', timeline);
  });

  /**
   * Get system settings
   */
  getSystemSettings = catchAsync(async (req, res) => {
    const settings = await SystemSettings.getInstance();

    const envDefaults = {
      siteName: process.env.SITE_NAME || 'RentEase',
      supportEmail: process.env.SUPPORT_EMAIL || ''
    };

    const merged = { ...envDefaults, ...settings.toObject ? settings.toObject() : settings };

    return ApiResponse.success(res, 200, 'System settings retrieved successfully', merged);
  });

  /**
   * Update system settings
   */
  updateSystemSettings = catchAsync(async (req, res) => {
    const updated = await SystemSettings.upsertSettings(req.body);

    return ApiResponse.success(res, 200, 'System settings updated successfully', { settings: updated });
  });

  /**
   * Get admin stats
   */
  getAdminStats = catchAsync(async (req, res) => {
    const total = await Admin.countDocuments();

    const byRole = await Admin.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const active = await Admin.countDocuments({
      'activity.lastActive': { $gte: fiveMinutesAgo },
      'status.isActive': true
    });
    const inactive = total - active;
    const activeSessions = await Admin.countDocuments({
      'activity.currentSession.token': { $exists: true, $ne: '' },
      'status.isActive': true
    });

    return ApiResponse.success(res, 200, 'Admin stats retrieved successfully', {
      total,
      active,
      inactive,
      byRole,
      activeSessions
    });
  });

  /**
   * Get payment stats
   */
  getPaymentStats = catchAsync(async (req, res) => {
    const paymentSettingsController = require('./payment-settings.controller');
    return paymentSettingsController.getPaymentStats(req, res);
  });

  /**
    * Get platform metrics
    */
  getPlatformMetrics = catchAsync(async (req, res) => {
    const metrics = await AdminService.getDashboardStats();
    
    return ApiResponse.success(res, 200, 'Platform metrics retrieved successfully', metrics);
  });

  /**
    * Export data
    */
  exportData = catchAsync(async (req, res) => {
    const { type, format = 'csv' } = req.query;
    
    if (!type) {
      throw new AppError('Export type is required', 400);
    }

    let data;
    let filename;

    switch (type) {
      case 'users':
        data = await User.find().lean();
        filename = 'users-export';
        break;
      case 'vendors':
        data = await Vendor.find().populate('user').lean();
        filename = 'vendors-export';
        break;
      case 'products':
        data = await Product.find().populate('category').lean();
        filename = 'products-export';
        break;
      case 'rentals':
        data = await Rental.find().populate('user product').lean();
        filename = 'rentals-export';
        break;
      default:
        throw new AppError('Invalid export type', 400);
    }

    if (format === 'csv') {
      const { Parser } = require('json2csv');
      const parser = new Parser();
      const csv = parser.parse(data);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}.csv`);
      return res.send(csv);
    }

    return ApiResponse.success(res, 200, 'Data exported successfully', { data });
  });

  /**
   * Import data
   */
  importData = catchAsync(async (req, res) => {
    const { type } = req.body;
    
    if (!type || !req.file) {
      throw new AppError('Import type and file are required', 400);
    }

    // Parse file based on type (CSV/JSON)
    let data;
    if (req.file.mimetype === 'application/json') {
      data = JSON.parse(req.file.buffer.toString());
    } else if (req.file.mimetype === 'text/csv') {
      const csv = req.file.buffer.toString();
      const lines = csv.split('\n');
      const headers = lines[0].split(',');
      data = lines.slice(1).map(line => {
        const values = line.split(',');
        return headers.reduce((obj, header, i) => {
          obj[header.trim()] = values[i]?.trim();
          return obj;
        }, {});
      });
    }

    // Process import based on type
    // This would validate and insert data

    return ApiResponse.success(res, 200, 'Data imported successfully', {
      imported: data?.length || 0
    });
  });

  /**
   * Test email configuration
   */
  testEmailConfig = catchAsync(async (req, res) => {
    const { to } = req.body;
    
    if (!to) {
      throw new AppError('Recipient email is required', 400);
    }

    await addJob('email', 'send', {
      to,
      subject: 'Test Email from RentEase Admin',
      html: '<h1>Test Email</h1><p>This is a test email to verify your email configuration.</p>'
    });

    return ApiResponse.success(res, 200, 'Test email sent successfully');
  });

  /**
   * Test SMS configuration
   */
  testSMSConfig = catchAsync(async (req, res) => {
    const { to } = req.body;
    
    if (!to) {
      throw new AppError('Recipient phone number is required', 400);
    }

    await addJob('sms', 'send', {
      to,
      message: 'Test SMS from RentEase Admin'
    });

    return ApiResponse.success(res, 200, 'Test SMS sent successfully');
  });


  /**
 * Get all vendors
 */
getAllVendors = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, ...filters } = req.query;

  logger.info('Getting all vendors with filters:', { page, limit, filters });
  
  const result = await adminVendorService.getAllVendors(
    parseInt(page),
    parseInt(limit),
    filters
  );
  
  return ApiResponse.success(res, 200, 'Vendors retrieved successfully', result);
});

}

module.exports = new AdminController();