const eventEmitter = require('./eventEmitter');
const logger = require('../config/logger');
const { createBulkNotifications } = require('../services/notification.service');
const User = require('../models/User.model');
const Vendor = require('../models/Vendor.model');

const PRODUCT_CREATED = 'product:created';
const PRODUCT_APPROVED = 'product:approved';
const PRODUCT_REJECTED = 'product:rejected';

// ====================================
// PRODUCT CREATED
// ====================================

eventEmitter.on(PRODUCT_CREATED, async (data) => {
  try {
    const adminUsers = await User.find({
      role: { $in: ['admin', 'super-admin'] }
    }).distinct('_id').lean();

    if (!adminUsers.length) return;

    await createBulkNotifications(adminUsers, {
      type: 'in_app',
      category: 'product',
      title: 'New Product Created',
      content: `Product "${data.productName}" has been created and is pending approval.`,
      data: {
        productId: data.productId,
        vendorId: data.vendorId,
        action: 'review_product'
      },
      priority: 'medium'
    });

    const { emitToAdmins } = require('../socket');
    emitToAdmins('product:created', {
      productId: data.productId,
      productName: data.productName,
      vendorId: data.vendorId,
      categoryId: data.categoryId,
      timestamp: new Date()
    });
  } catch (error) {
    logger.error('Error handling product created event:', error);
  }
});

// ====================================
// PRODUCT APPROVED
// ====================================

eventEmitter.on(PRODUCT_APPROVED, async (data) => {
  try {
    const vendor = await Vendor.findById(data.vendorId);
    const userId = vendor?.user;

    if (!userId) return;

    await createBulkNotifications([userId], {
      type: 'in_app',
      category: 'product',
      title: 'Product Approved',
      content: `Your product "${data.productName}" has been approved successfully.`,
      data: {
        productId: data.productId,
        approvedBy: data.approvedBy,
        notes: data.notes,
        action: 'view_product'
      },
      priority: 'high'
    });

    const { emitToUser } = require('../socket');
    emitToUser(userId, 'product:approved', {
      productId: data.productId,
      productName: data.productName,
      message: 'Your product has been approved',
      timestamp: new Date()
    });
  } catch (error) {
    logger.error('Error handling product approved event:', error);
  }
});

// ====================================
// PRODUCT REJECTED
// ====================================

eventEmitter.on(PRODUCT_REJECTED, async (data) => {
  try {
    const vendor = await Vendor.findById(data.vendorId);
    const userId = vendor?.user;

    if (!userId) return;

    await createBulkNotifications([userId], {
      type: 'in_app',
      category: 'product',
      title: 'Product Rejected',
      content: `Your product "${data.productName}" has been rejected. Reason: ${data.reason}`,
      data: {
        productId: data.productId,
        rejectedBy: data.rejectedBy,
        reason: data.reason,
        action: 'view_product'
      },
      priority: 'high'
    });

    const { emitToUser } = require('../socket');
    emitToUser(userId, 'product:rejected', {
      productId: data.productId,
      productName: data.productName,
      reason: data.reason,
      message: 'Your product has been rejected',
      timestamp: new Date()
    });
  } catch (error) {
    logger.error('Error handling product rejected event:', error);
  }
});
