const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const productRoutes = require('./product.routes');
const rentalRoutes = require('./rental.routes');
const paymentRoutes = require('./payment.routes');
const categoryRoutes = require('./category.routes');
const vendorRoutes = require('./vendor.routes');
const adminRoutes = require('./admin.routes');
const reviewRoutes = require('./review.routes');
const deliveryRoutes = require('./delivery.routes');
const maintenanceRoutes = require('./maintenance.routes');
const discountRoutes = require('./discount.routes');
const notificationRoutes = require('./notification.routes');
const searchRoutes = require('./search.routes');
const webhookRoutes = require('./webhook.routes');
const adminAuthRoutes = require('./admin-auth.routes');
const roleManagementRoutes = require('./role-management.routes');
const adminVendorRoutes = require('./admin-vendor.routes');
const aiCategoryRoutes = require('./ai-category.routes');
const inventoryRoutes = require('./inventory.routes');
const supportTicketRoutes = require('./supportTicket.routes');
const aiChatRoutes = require('./ai-chat.routes');
const cartRoutes = require('./cart.routes');
const adminSettingsRoutes = require('./admin-settings.routes');
const analyticsRoutes = require('./analytics.routes');
const deliveryPersonnelRoutes = require('./delivery-personnel.routes');
const adminIntelligenceRoutes = require('./admin-intelligence.routes');
const behaviorRoutes = require('./behavior.routes');
const bannerRoutes = require('./banner.routes');
const emailSettingsRoutes = require('./email-settings.routes');
const smsSettingsRoutes = require('./sms-settings.routes');
const paymentSettingsRoutes = require('./payment-settings.routes');
const backupRoutes = require('./backup.routes');
const apiKeysRoutes = require('./api-keys.routes');
const systemLogsRoutes = require('./system-logs.routes');
const settingRoutes = require("./settings.routes");

// Vendor/admin middleware
const { restrictTo } = require('../../middlewares/permissions.middleware');
const { protectAdmin } = require('../../middlewares/admin-auth.middleware');

// Public routes
router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/categories', categoryRoutes);
router.use('/search', searchRoutes);
router.use('/banners', bannerRoutes);
router.use('/ai', aiChatRoutes);

// Admin auth routes (public)
router.use('/admin/auth', adminAuthRoutes);

// Webhook routes (no auth)
router.use('/webhooks', webhookRoutes);

// Protected routes (auth required for all below)
const { protect } = require('../../middlewares/auth.middleware');

// User routes
router.use('/users', userRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/settings', settingRoutes);
router.use('/admin/backups', backupRoutes);

// Rental routes
router.use('/rentals', rentalRoutes);

// Cart routes
router.use('/cart', cartRoutes);

// Payment routes
router.use('/payments', paymentRoutes);

// Review routes
router.use('/reviews', reviewRoutes);

// Delivery routes
router.use('/deliveries', deliveryRoutes);

// Support tickets
router.use('/supportTicket', supportTicketRoutes);
router.use('/support', supportTicketRoutes);

// Maintenance routes
router.use('/maintenance', maintenanceRoutes);

router.use('/analytics', analyticsRoutes);

router.use('/admin/vendors', adminVendorRoutes);
router.use('/admin/backup', backupRoutes);

router.use('/admin/intelligence', adminIntelligenceRoutes);
router.use('/behavior', behaviorRoutes);

// Discount routes
router.use('/discounts', discountRoutes);

// Notification routes
router.use('/notifications', notificationRoutes);

router.use('/vendor', vendorRoutes);

// Admin settings routes
router.use('/admin/settings/email', emailSettingsRoutes);
router.use('/admin/settings/sms', smsSettingsRoutes);
router.use('/admin/settings/payments', paymentSettingsRoutes);
router.use('/admin/settings', adminSettingsRoutes);

router.use('/admin/api-keys', apiKeysRoutes);
router.use('/admin/logs', systemLogsRoutes);

// Role management routes (super admin only)
router.use('/admin/roles', roleManagementRoutes);

// Admin routes
router.use('/admin', adminRoutes);

// Vendor management

router.use('/admin/ai-category', aiCategoryRoutes);

// Delivery personnel
router.use('/delivery-personnel', deliveryPersonnelRoutes);

module.exports = router;
