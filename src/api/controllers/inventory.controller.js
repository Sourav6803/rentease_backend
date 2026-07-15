const InventoryService = require('../../services/inventory.service');
const catchAsync = require('../../utils/catchAsync');
const {ApiResponse} = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const Product = require('../../models/Product.model');
const Inventory = require('../../models/Inventory.model');

class InventoryController {
  /**
   * Create inventory items
   */
  createInventoryItems = catchAsync(async (req, res) => {
    const { productId, quantity, purchaseInfo } = req.body;
    
    const items = await InventoryService.createInventoryItems(
      productId,
      req.user._id,
      quantity,
      purchaseInfo
    );
    
    return ApiResponse.success(res, 201, 'Inventory items created successfully', { items });
  });

  /**
   * Get inventory item by ID
   */
  getInventoryItem = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const item = await InventoryService.getInventoryItem(id, req.vendor._id);
    
    return ApiResponse.success(res, 200, 'Inventory item retrieved successfully', { item });
  });


  /**
 * Get all inventory for vendor (with pagination)
 */
  getAllVendorInventory = catchAsync(async (req, res) => {
    const { page = 1, limit = 15, status, search } = req.query;
    // console.log("req.vendor", req.vendor)
    // console.log("req.vendorId", req.vendorId)
    // console.log("req.vendor?._id;", req.vendor?._id)
    // console.log("req.user", req.user)

    // const vendorId = req.vendorId || req.vendor?._id;
    const vendorId =  req.vendor?._id;
    console.log("Vendor ID in getAllVendorInventory:", vendorId)
    
    if (!vendorId) {
      throw new AppError('Vendor ID not found', 400);
    }
    
    // Get all product IDs for this vendor
    const products = await Product.find({ vendor: vendorId }).select('_id');
    console.log("Products found for vendor:", products.length)
    const productIds = products.map(p => p._id);
    
    const query = { product: { $in: productIds } };
    if (status) query.status = status;
    
    const [items, total] = await Promise.all([
      Inventory.find(query)
        .populate('product', 'basicInfo.name basicInfo.images pricing.monthlyRent')
        .sort({ createdAt: -1 })
        .skip((parseInt(page) - 1) * parseInt(limit))
        .limit(parseInt(limit))
        .lean(),
      Inventory.countDocuments(query)
    ]);
    
    return ApiResponse.success(res, 200, 'Inventory retrieved successfully', {
      items,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  });

  /**
   * Get product inventory
   */
  getProductInventory = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { page = 1, limit = 20, ...filters } = req.query;
    
    const inventory = await InventoryService.getProductInventory(
      productId,
      req.user._id,
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Product inventory retrieved successfully', inventory);
  });

  /**
   * Update inventory item
   */
  updateInventoryItem = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const item = await InventoryService.updateInventoryItem(id, req.user._id, req.body);
    
    return ApiResponse.success(res, 200, 'Inventory item updated successfully', { item });
  });

  /**
   * Update inventory status
   */
  updateStatus = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { status, reason } = req.body;
    
    const item = await InventoryService.updateStatus(id, req.user._id, status, reason);
    
    return ApiResponse.success(res, 200, 'Inventory status updated successfully', { item });
  });

  /**
   * Transfer inventory
   */
  transferInventory = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const item = await InventoryService.transferInventory(id, req.user._id, req.body);
    
    return ApiResponse.success(res, 200, 'Inventory transferred successfully', { item });
  });

  /**
   * Get inventory analytics
   */
  getInventoryAnalytics = catchAsync(async (req, res) => {
    const { productId } = req.query;
    
    const analytics = await InventoryService.getInventoryAnalytics(req.user._id, { productId });
    
    return ApiResponse.success(res, 200, 'Inventory analytics retrieved successfully', analytics);
  });

  /**
   * Get low stock alerts
   */
  getLowStockAlerts = catchAsync(async (req, res) => {
    const alerts = await InventoryService.getLowStockAlerts(req.user._id);
    
    return ApiResponse.success(res, 200, 'Low stock alerts retrieved successfully', { alerts });
  });

  /**
   * Get maintenance due items
   */
  getMaintenanceDueItems = catchAsync(async (req, res) => {
    const items = await InventoryService.getMaintenanceDueItems(req.user._id);
    
    return ApiResponse.success(res, 200, 'Maintenance due items retrieved successfully', { items });
  });

  /**
   * Schedule maintenance
   */
  scheduleMaintenance = catchAsync(async (req, res) => {
    const maintenance = await InventoryService.scheduleMaintenance(req.user._id, req.body);
    
    return ApiResponse.success(res, 200, 'Maintenance scheduled successfully', { maintenance });
  });

  /**
   * Perform inventory audit
   */
  performAudit = catchAsync(async (req, res) => {
    const audit = await InventoryService.performAudit(req.user._id, req.body);
    
    return ApiResponse.success(res, 200, 'Inventory audit completed successfully', { audit });
  });

  /**
   * Get inventory value report
   */
  getInventoryValueReport = catchAsync(async (req, res) => {
    const report = await InventoryService.getInventoryValueReport(req.user._id);
    
    return ApiResponse.success(res, 200, 'Inventory value report generated successfully', report);
  });

  /**
   * Bulk import inventory
   */
  bulkImport = catchAsync(async (req, res) => {
    const { items } = req.body;
    
    if (!Array.isArray(items)) {
      throw new AppError('Items must be an array', 400);
    }

    const results = await InventoryService.bulkImport(req.user._id, items);
    
    return ApiResponse.success(res, 200, 'Bulk import completed', results);
  });

  /**
   * Export inventory
   */
  exportInventory = catchAsync(async (req, res) => {
    const { format = 'json' } = req.query;
    
    const data = await InventoryService.exportInventory(req.user._id, format);
    
    if (format === 'csv') {
      const { Parser } = require('json2csv');
      const parser = new Parser();
      const csv = parser.parse(data);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=inventory-export.csv');
      return res.send(csv);
    }
    
    return ApiResponse.success(res, 200, 'Inventory exported successfully', { data });
  });

  /**
   * Scan QR code
   */
  scanQRCode = catchAsync(async (req, res) => {
    const { code } = req.params;
    
    // Decode QR data
    const data = JSON.parse(Buffer.from(code, 'base64').toString());
    
    const item = await InventoryService.getInventoryItem(data.id);
    
    return ApiResponse.success(res, 200, 'QR code scanned successfully', { item });
  });

  /**
   * Get inventory movement history
   */
  getMovementHistory = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const item = await InventoryService.getInventoryItem(id, req.vendor._id);
    
    const history = {
      status: item.statusHistory || [],
      transfers: item.transferHistory || [],
      rentals: item.rentalHistory || [],
      maintenance: item.maintenanceHistory || []
    };
    
    return ApiResponse.success(res, 200, 'Movement history retrieved successfully', history);
  });

  // ==================== ADMIN ROUTES ====================

  /**
   * Get all inventory (admin)
   */
  getAllInventory = catchAsync(async (req, res) => {
    const { page = 1, limit = 20, vendorId, ...filters } = req.query;
    
    const skip = (page - 1) * limit;
    
    const query = {};
    if (vendorId) query['product.vendor'] = vendorId;
    if (filters.status) query.status = filters.status;
    
    const [items, total] = await Promise.all([
      Inventory.find(query)
        .populate({
          path: 'product',
          select: 'basicInfo.name vendor',
          populate: {
            path: 'vendor',
            select: 'business.name'
          }
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Inventory.countDocuments(query)
    ]);

    return ApiResponse.success(res, 200, 'All inventory retrieved successfully', {
      items,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  });

  /**
   * Get inventory summary (admin)
   */
  getInventorySummary = catchAsync(async (req, res) => {
    const summary = await Inventory.aggregate([
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalValue: { $sum: '$purchaseInfo.price' },
          available: {
            $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] }
          },
          rented: {
            $sum: { $cond: [{ $eq: ['$status', 'rented'] }, 1, 0] }
          },
          maintenance: {
            $sum: { $cond: [{ $eq: ['$status', 'maintenance'] }, 1, 0] }
          },
          damaged: {
            $sum: { $cond: [{ $eq: ['$status', 'damaged'] }, 1, 0] }
          }
        }
      }
    ]);

    return ApiResponse.success(res, 200, 'Inventory summary retrieved successfully', summary[0] || {});
  });
}

module.exports = new InventoryController();