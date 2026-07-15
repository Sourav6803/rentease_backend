// const { eventEmitter, EVENTS } = require('./index');
const eventEmitter = require('./eventEmitter');
const EVENTS = require('./events.constants');
const logger = require('../config/logger');
const { emitToUser, emitToVendor, emitToAdmins } = require('../socket');
const { createNotification } = require('../services/notification.service');
const { addJob } = require('../jobs');
const Vendor = require('../models/Vendor.model');
const User = require('../models/User.model');

// ====================================
// VENDOR REGISTRATION EVENTS
// ====================================

/**
 * Vendor registered
 * Triggered when a new vendor registers
 */
eventEmitter.on(EVENTS.VENDOR.REGISTERED, async (data) => {
  try {
    logger.info(`Vendor registered: ${data.vendorId} - ${data.businessName}`);

    // Send welcome email to vendor
    await addJob('email', 'send', {
      to: data.email,
      subject: 'Welcome to RentEase Vendor Family!',
      template: 'vendor-welcome',
      data: {
        name: data.ownerName,
        businessName: data.businessName,
        verificationLink: `${process.env.CLIENT_URL}/vendor/complete-profile/${data.vendorId}`,
      },
    });

    // Send in-app notification
    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Welcome to RentEase!',
      content: 'Thank you for registering as a vendor. Please complete your profile to start listing products.',
      data: { vendorId: data.vendorId, action: 'complete_profile' },
    });

    // Notify admins about new vendor registration
    emitToAdmins('vendor:registered', {
      vendorId: data.vendorId,
      businessName: data.businessName,
      ownerName: data.ownerName,
      timestamp: new Date(),
    });

    // Schedule reminder for incomplete profile
    await addJob('vendor', 'profile-completion-reminder', {
      vendorId: data.vendorId,
      userId: data.userId,
      scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
    });

    // Log to audit
    await addJob('audit', 'log', {
      action: 'VENDOR_REGISTERED',
      actor: data.userId,
      target: data.vendorId,
      details: {
        businessName: data.businessName,
        email: data.email,
        phone: data.phone,
      },
    });
  } catch (error) {
    logger.error('Error handling vendor registered event:', error);
  }
});

// ====================================
// VENDOR VERIFICATION EVENTS
// ====================================

/**
 * Vendor verification submitted
 * Triggered when vendor submits KYC documents
 */
eventEmitter.on('vendor:verification-submitted', async (data) => {
  try {
    logger.info(`Vendor verification submitted: ${data.vendorId}`);

    // Notify vendor
    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Verification Documents Received',
      content: 'Your KYC documents have been submitted successfully. We will verify them within 24-48 hours.',
      data: { vendorId: data.vendorId },
    });

    // Send email confirmation
    await addJob('email', 'send', {
      to: data.email,
      subject: 'KYC Documents Received - RentEase',
      template: 'kyc-received',
      data: {
        name: data.ownerName,
        businessName: data.businessName,
        estimatedTime: '24-48 hours',
      },
    });

    // Notify admins with high priority
    emitToAdmins('vendor:verification-pending', {
      vendorId: data.vendorId,
      businessName: data.businessName,
      documents: data.documents,
      priority: 'high',
      timestamp: new Date(),
    });

    // Create admin task for verification
    await addJob('admin', 'create-verification-task', {
      vendorId: data.vendorId,
      documents: data.documents,
      priority: 'high',
      dueIn: 24, // hours
    });
  } catch (error) {
    logger.error('Error handling vendor verification submitted event:', error);
  }
});

/**
 * Vendor approved
 * Triggered when admin approves a vendor
 */
eventEmitter.on(EVENTS.VENDOR.APPROVED, async (data) => {
  try {
    logger.info(`Vendor approved: ${data.vendorId} - ${data.businessName}`);

    // Update vendor status
    await Vendor.findOneAndUpdate(
      { vendorId: data.vendorId },
      {
        'verification.status': 'verified',
        'verification.verifiedAt': new Date(),
        'verification.verifiedBy': data.approvedBy,
        'status.isOnboarded': true,
        'status.onboardedAt': new Date(),
      }
    );

    // Send congratulatory email
    await addJob('email', 'send', {
      to: data.email,
      subject: 'Congratulations! Your Vendor Account is Approved 🎉',
      template: 'vendor-approved',
      data: {
        name: data.ownerName,
        businessName: data.businessName,
        dashboardLink: `${process.env.CLIENT_URL}/vendor/dashboard`,
        nextSteps: [
          'Add your products',
          'Set up payment details',
          'Configure delivery areas',
          'Start receiving orders',
        ],
      },
    });

    // Send in-app notification
    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Vendor Account Approved! 🎉',
      content: 'Congratulations! Your vendor account has been approved. You can now start listing products.',
      data: { vendorId: data.vendorId, action: 'go_to_dashboard' },
    });

    // Send SMS notification
    await addJob('sms', 'send', {
      to: data.phone,
      message: `Congratulations ${data.ownerName}! Your RentEase vendor account is now approved. Start listing products now: ${process.env.CLIENT_URL}/vendor/dashboard`,
    });

    // Notify vendor via socket
    emitToUser(data.userId, 'vendor:approved', {
      vendorId: data.vendorId,
      message: 'Your vendor account has been approved!',
      timestamp: new Date(),
    });

    // Update vendor metrics
    await addJob('analytics', 'update-vendor-metrics', {
      vendorId: data.vendorId,
      event: 'approval',
    });

    // Log to audit
    await addJob('audit', 'log', {
      action: 'VENDOR_APPROVED',
      actor: data.approvedBy,
      target: data.vendorId,
      details: {
        businessName: data.businessName,
        approvedAt: new Date(),
      },
    });
  } catch (error) {
    logger.error('Error handling vendor approved event:', error);
  }
});

/**
 * Vendor rejected
 * Triggered when admin rejects a vendor application
 */
eventEmitter.on(EVENTS.VENDOR.REJECTED, async (data) => {
  try {
    logger.info(`Vendor rejected: ${data.vendorId} - Reason: ${data.reason}`);

    // Send rejection email with reason
    await addJob('email', 'send', {
      to: data.email,
      subject: 'Update on Your Vendor Application - RentEase',
      template: 'vendor-rejected',
      data: {
        name: data.ownerName,
        businessName: data.businessName,
        reason: data.reason,
        feedback: data.feedback,
        reapplyLink: `${process.env.CLIENT_URL}/vendor/reapply`,
        supportEmail: process.env.SUPPORT_EMAIL,
      },
    });

    // Send in-app notification
    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Vendor Application Update',
      content: `Your vendor application was not approved at this time. Reason: ${data.reason}`,
      data: { vendorId: data.vendorId, action: 'contact_support' },
    });

    // Notify vendor via socket
    emitToUser(data.userId, 'vendor:rejected', {
      vendorId: data.vendorId,
      reason: data.reason,
      feedback: data.feedback,
      timestamp: new Date(),
    });

    // Schedule follow-up if applicable
    if (data.canReapply) {
      await addJob('vendor', 'reapplication-reminder', {
        vendorId: data.vendorId,
        userId: data.userId,
        scheduledAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      });
    }

    // Log to audit
    await addJob('audit', 'log', {
      action: 'VENDOR_REJECTED',
      actor: data.rejectedBy,
      target: data.vendorId,
      details: {
        businessName: data.businessName,
        reason: data.reason,
        feedback: data.feedback,
        rejectedAt: new Date(),
      },
    });
  } catch (error) {
    logger.error('Error handling vendor rejected event:', error);
  }
});

// ====================================
// VENDOR SUSPENSION EVENTS
// ====================================

/**
 * Vendor suspended
 * Triggered when a vendor is suspended
 */
eventEmitter.on(EVENTS.VENDOR.SUSPENDED, async (data) => {
  try {
    logger.warn(`Vendor suspended: ${data.vendorId} - Reason: ${data.reason}`);

    // Update vendor status
    await Vendor.findOneAndUpdate(
      { vendorId: data.vendorId },
      {
        'status.isActive': false,
        'status.isBlocked': true,
        'status.blockReason': data.reason,
        'status.blockedAt': new Date(),
        'status.blockedBy': data.suspendedBy,
      }
    );

    // Suspend all active products
    await addJob('product', 'bulk-update-status', {
      vendorId: data.vendorId,
      status: 'inactive',
      reason: 'Vendor suspended',
    });

    // Cancel all pending rentals
    await addJob('rental', 'cancel-vendor-rentals', {
      vendorId: data.vendorId,
      reason: 'Vendor suspended',
    });

    // Send notification email
    await addJob('email', 'send', {
      to: data.email,
      subject: 'Important: Your Vendor Account Has Been Suspended',
      template: 'vendor-suspended',
      data: {
        name: data.ownerName,
        businessName: data.businessName,
        reason: data.reason,
        appealLink: `${process.env.CLIENT_URL}/vendor/appeal-suspension`,
        supportEmail: process.env.SUPPORT_EMAIL,
      },
    });

    // Send in-app notification
    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Account Suspended',
      content: `Your vendor account has been suspended. Reason: ${data.reason}. Please contact support for more information.`,
      data: { vendorId: data.vendorId, action: 'contact_support' },
    });

    // Force logout vendor sessions
    emitToUser(data.userId, 'force-logout', {
      reason: 'Account suspended',
      message: data.reason,
    });

    // Notify admins
    emitToAdmins('vendor:suspended', {
      vendorId: data.vendorId,
      businessName: data.businessName,
      reason: data.reason,
      suspendedBy: data.suspendedBy,
      timestamp: new Date(),
    });

    // Log to audit
    await addJob('audit', 'log', {
      action: 'VENDOR_SUSPENDED',
      actor: data.suspendedBy,
      target: data.vendorId,
      details: {
        businessName: data.businessName,
        reason: data.reason,
        suspendedAt: new Date(),
      },
    });
  } catch (error) {
    logger.error('Error handling vendor suspended event:', error);
  }
});

/**
 * Vendor reinstated
 * Triggered when a suspended vendor is reinstated
 */
eventEmitter.on('vendor:reinstated', async (data) => {
  try {
    logger.info(`Vendor reinstated: ${data.vendorId}`);

    // Update vendor status
    await Vendor.findOneAndUpdate(
      { vendorId: data.vendorId },
      {
        'status.isActive': true,
        'status.isBlocked': false,
        'status.blockReason': null,
        'status.blockedAt': null,
        'status.blockedBy': null,
      }
    );

    // Reactivate products
    await addJob('product', 'bulk-update-status', {
      vendorId: data.vendorId,
      status: 'active',
      reason: 'Vendor reinstated',
    });

    // Send notification email
    await addJob('email', 'send', {
      to: data.email,
      subject: 'Your Vendor Account Has Been Reinstated',
      template: 'vendor-reinstated',
      data: {
        name: data.ownerName,
        businessName: data.businessName,
        dashboardLink: `${process.env.CLIENT_URL}/vendor/dashboard`,
      },
    });

    // Send in-app notification
    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Account Reinstated',
      content: 'Your vendor account has been reinstated. You can now resume your business operations.',
      data: { vendorId: data.vendorId, action: 'go_to_dashboard' },
    });

    emitToUser(data.userId, 'vendor:reinstated', {
      vendorId: data.vendorId,
      message: 'Your account has been reinstated!',
      timestamp: new Date(),
    });

    // Log to audit
    await addJob('audit', 'log', {
      action: 'VENDOR_REINSTATED',
      actor: data.reinstatedBy,
      target: data.vendorId,
      details: {
        businessName: data.businessName,
        reinstatedAt: new Date(),
      },
    });
  } catch (error) {
    logger.error('Error handling vendor reinstated event:', error);
  }
});

// ====================================
// VENDOR PRODUCT EVENTS
// ====================================

/**
 * Product added by vendor
 */
eventEmitter.on(EVENTS.VENDOR.PRODUCT_ADDED, async (data) => {
  try {
    logger.info(`Product added by vendor: ${data.vendorId} - Product: ${data.productId}`);

    // Update vendor product count
    await Vendor.findOneAndUpdate(
      { user: data.vendorId },
      {
        $inc: { 'products.total': 1, 'products.active': 1 },
        $push: {
          'products.categories': {
            category: data.categoryId,
            count: 1,
          },
        },
      }
    );

    // Notify admins for approval if needed
    if (data.requiresApproval) {
      emitToAdmins('product:pending-approval', {
        vendorId: data.vendorId,
        productId: data.productId,
        productName: data.productName,
        timestamp: new Date(),
      });
    }

    // Log to audit
    await addJob('audit', 'log', {
      action: 'PRODUCT_ADDED',
      actor: data.vendorId,
      target: data.productId,
      details: {
        productName: data.productName,
        category: data.categoryName,
      },
    });
  } catch (error) {
    logger.error('Error handling product added event:', error);
  }
});

/**
 * Inventory low alert
 */
eventEmitter.on(EVENTS.VENDOR.INVENTORY_LOW, async (data) => {
  try {
    logger.warn(`Low inventory alert for vendor: ${data.vendorId} - Product: ${data.productId}`);

    // Send immediate notification to vendor
    await createNotification({
      userId: data.vendorId,
      type: 'in_app',
      title: '⚠️ Low Inventory Alert',
      content: `Product "${data.productName}" is running low on stock. Only ${data.quantity} left.`,
      data: {
        productId: data.productId,
        productName: data.productName,
        quantity: data.quantity,
        action: 'restock',
      },
      priority: 'high',
    });

    // Send email alert
    await addJob('email', 'send', {
      to: data.email,
      subject: '⚠️ Low Inventory Alert - Action Required',
      template: 'inventory-low',
      data: {
        name: data.ownerName,
        businessName: data.businessName,
        productName: data.productName,
        currentStock: data.quantity,
        restockLink: `${process.env.CLIENT_URL}/vendor/products/${data.productId}/restock`,
      },
      priority: 'high',
    });

    // Send SMS for critical low stock
    if (data.quantity <= data.criticalLevel) {
      await addJob('sms', 'send', {
        to: data.phone,
        message: `URGENT: ${data.productName} is critically low (${data.quantity} left). Restock immediately: ${process.env.CLIENT_URL}/vendor/products/${data.productId}`,
      });
    }

    // Update vendor dashboard alert
    emitToVendor(data.vendorId, 'inventory:alert', {
      productId: data.productId,
      productName: data.productName,
      quantity: data.quantity,
      level: data.quantity <= data.criticalLevel ? 'critical' : 'low',
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error('Error handling inventory low event:', error);
  }
});

// ====================================
// VENDOR PAYOUT EVENTS
// ====================================

/**
 * Payout processed
 */
eventEmitter.on(EVENTS.VENDOR.PAYOUT_PROCESSED, async (data) => {
  try {
    logger.info(`Payout processed for vendor: ${data.vendorId} - Amount: ₹${data.amount}`);

    // Send notification to vendor
    await createNotification({
      userId: data.vendorId,
      type: 'in_app',
      title: '💰 Payout Processed',
      content: `Your payout of ₹${data.amount} has been processed. It will reflect in your account within 24-48 hours.`,
      data: {
        payoutId: data.payoutId,
        amount: data.amount,
        transactionId: data.transactionId,
        action: 'view_details',
      },
    });

    // Send email with payout details
    await addJob('email', 'send', {
      to: data.email,
      subject: 'Payout Processed - RentEase',
      template: 'payout-processed',
      data: {
        name: data.ownerName,
        businessName: data.businessName,
        amount: data.amount,
        payoutDate: new Date(data.processedAt).toLocaleDateString(),
        transactionId: data.transactionId,
        viewLink: `${process.env.CLIENT_URL}/vendor/payouts/${data.payoutId}`,
      },
    });

    // Update vendor payout history
    await Vendor.findOneAndUpdate(
      { user: data.vendorId },
      {
        $inc: { 'payments.paid': data.amount },
        $push: {
          'payments.paymentHistory': data.payoutId,
        },
      }
    );

    emitToVendor(data.vendorId, 'payout:processed', {
      payoutId: data.payoutId,
      amount: data.amount,
      status: 'success',
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error('Error handling payout processed event:', error);
  }
});

/**
 * Payout failed
 */
eventEmitter.on('vendor:payout-failed', async (data) => {
  try {
    logger.error(`Payout failed for vendor: ${data.vendorId} - Reason: ${data.reason}`);

    // Send urgent notification
    await createNotification({
      userId: data.vendorId,
      type: 'in_app',
      title: '⚠️ Payout Failed',
      content: `Your payout of ₹${data.amount} failed. Reason: ${data.reason}. Please update your bank details.`,
      data: {
        payoutId: data.payoutId,
        amount: data.amount,
        reason: data.reason,
        action: 'update_bank_details',
      },
      priority: 'high',
    });

    // Send email
    await addJob('email', 'send', {
      to: data.email,
      subject: 'URGENT: Payout Failed - Action Required',
      template: 'payout-failed',
      data: {
        name: data.ownerName,
        businessName: data.businessName,
        amount: data.amount,
        reason: data.reason,
        updateLink: `${process.env.CLIENT_URL}/vendor/bank-details`,
      },
      priority: 'high',
    });

    // Notify finance team
    emitToAdmins('vendor:payout-failed', {
      vendorId: data.vendorId,
      businessName: data.businessName,
      amount: data.amount,
      reason: data.reason,
      timestamp: new Date(),
    });

    emitToVendor(data.vendorId, 'payout:failed', {
      payoutId: data.payoutId,
      amount: data.amount,
      reason: data.reason,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error('Error handling payout failed event:', error);
  }
});

// ====================================
// VENDOR PERFORMANCE EVENTS
// ====================================

/**
 * Vendor rating updated
 */
eventEmitter.on('vendor:rating-updated', async (data) => {
  try {
    logger.info(`Vendor rating updated: ${data.vendorId} - New rating: ${data.newRating}`);

    // Check if rating dropped significantly
    if (data.previousRating && data.newRating < data.previousRating - 1) {
      await createNotification({
        userId: data.vendorId,
        type: 'in_app',
        title: '📉 Rating Alert',
        content: 'Your vendor rating has decreased. Check recent reviews for feedback.',
        data: {
          oldRating: data.previousRating,
          newRating: data.newRating,
          action: 'view_reviews',
        },
        priority: 'medium',
      });

      // Notify vendor success team
      emitToAdmins('vendor:rating-drop', {
        vendorId: data.vendorId,
        businessName: data.businessName,
        oldRating: data.previousRating,
        newRating: data.newRating,
        timestamp: new Date(),
      });
    }

    // Update vendor performance metrics
    await Vendor.findOneAndUpdate(
      { user: data.vendorId },
      {
        'performance.rating.average': data.newRating,
        'performance.rating.count': data.totalReviews,
      }
    );

    // Check for achievement badges
    if (data.newRating >= 4.5 && data.totalReviews >= 50) {
      await addJob('vendor', 'check-achievements', {
        vendorId: data.vendorId,
        type: 'top_rated',
      });
    }
  } catch (error) {
    logger.error('Error handling rating updated event:', error);
  }
});

/**
 * Vendor milestone achieved
 */
eventEmitter.on('vendor:milestone-achieved', async (data) => {
  try {
    logger.info(`Vendor milestone achieved: ${data.vendorId} - ${data.milestone}`);

    const milestones = {
      first_sale: {
        title: '🎉 First Sale!',
        message: 'Congratulations on your first rental!',
        badge: 'beginner',
      },
      tenth_sale: {
        title: '🌟 10 Rentals Completed',
        message: 'You\'ve completed 10 rentals! Keep up the great work!',
        badge: 'rising_star',
      },
      hundredth_sale: {
        title: '💯 100 Rentals Milestone',
        message: 'Amazing! You\'ve completed 100 rentals. You\'re a top vendor now!',
        badge: 'top_vendor',
      },
      year_anniversary: {
        title: '🎂 One Year with RentEase',
        message: 'Thank you for being with us for a year!',
        badge: 'veteran',
      },
    };

    const milestone = milestones[data.milestone];

    // Send congratulatory notification
    await createNotification({
      userId: data.vendorId,
      type: 'in_app',
      title: milestone.title,
      content: milestone.message,
      data: {
        milestone: data.milestone,
        badge: milestone.badge,
        action: 'view_achievements',
      },
    });

    // Send email
    await addJob('email', 'send', {
      to: data.email,
      subject: milestone.title,
      template: 'vendor-milestone',
      data: {
        name: data.ownerName,
        businessName: data.businessName,
        milestone: milestone,
        dashboardLink: `${process.env.CLIENT_URL}/vendor/achievements`,
      },
    });

    // Award badge
    if (milestone.badge) {
      await addJob('vendor', 'award-badge', {
        vendorId: data.vendorId,
        badge: milestone.badge,
      });
    }

    // Share achievement (if opted in)
    if (data.shareable) {
      emitToAdmins('vendor:milestone', {
        vendorId: data.vendorId,
        businessName: data.businessName,
        milestone: data.milestone,
        timestamp: new Date(),
      });
    }
  } catch (error) {
    logger.error('Error handling milestone achieved event:', error);
  }
});

// ====================================
// VENDOR PROFILE EVENTS
// ====================================

/**
 * Vendor profile updated
 */
eventEmitter.on('vendor:profile-updated', async (data) => {
  try {
    logger.info(`Vendor profile updated: ${data.vendorId}`);

    // Log the update
    await addJob('audit', 'log', {
      action: 'VENDOR_PROFILE_UPDATED',
      actor: data.vendorId,
      target: data.vendorId,
      details: {
        updatedFields: data.updatedFields,
        updatedAt: new Date(),
      },
    });

    // Notify if bank details were updated
    if (data.updatedFields.includes('bankDetails')) {
      await createNotification({
        userId: data.vendorId,
        type: 'in_app',
        title: 'Bank Details Updated',
        content: 'Your bank details have been updated successfully.',
        data: { action: 'view_details' },
      });

      // Notify finance team for verification
      emitToAdmins('vendor:bank-details-updated', {
        vendorId: data.vendorId,
        businessName: data.businessName,
        timestamp: new Date(),
      });
    }

    emitToUser(data.vendorId, 'vendor:profile-updated', {
      updatedFields: data.updatedFields,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error('Error handling profile updated event:', error);
  }
});

// ====================================
// VENDOR SUBSCRIPTION EVENTS
// ====================================

/**
 * Vendor subscription upgraded
 */
eventEmitter.on('vendor:subscription-upgraded', async (data) => {
  try {
    logger.info(`Vendor subscription upgraded: ${data.vendorId} - Plan: ${data.newPlan}`);

    await createNotification({
      userId: data.vendorId,
      type: 'in_app',
      title: '⭐ Subscription Upgraded',
      content: `You've been upgraded to the ${data.newPlan} plan. Enjoy your new features!`,
      data: {
        oldPlan: data.oldPlan,
        newPlan: data.newPlan,
        action: 'view_features',
      },
    });

    // Send email with new features
    await addJob('email', 'send', {
      to: data.email,
      subject: 'Subscription Upgraded - RentEase',
      template: 'subscription-upgraded',
      data: {
        name: data.ownerName,
        businessName: data.businessName,
        oldPlan: data.oldPlan,
        newPlan: data.newPlan,
        features: data.newFeatures,
        dashboardLink: `${process.env.CLIENT_URL}/vendor/subscription`,
      },
    });

    // Unlock new features
    emitToVendor(data.vendorId, 'subscription:upgraded', {
      plan: data.newPlan,
      features: data.newFeatures,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error('Error handling subscription upgraded event:', error);
  }
});

/**
 * Vendor subscription expiring
 */
eventEmitter.on('vendor:subscription-expiring', async (data) => {
  try {
    logger.warn(`Vendor subscription expiring: ${data.vendorId} - Expires in ${data.daysLeft} days`);

    const daysLeft = data.daysLeft;
    const urgency = daysLeft <= 3 ? 'high' : 'medium';

    await createNotification({
      userId: data.vendorId,
      type: 'in_app',
      title: '⚠️ Subscription Expiring Soon',
      content: `Your ${data.plan} plan will expire in ${daysLeft} days. Renew now to avoid interruption.`,
      data: {
        plan: data.plan,
        daysLeft,
        action: 'renew',
      },
      priority: urgency,
    });

    // Send reminder email
    await addJob('email', 'send', {
      to: data.email,
      subject: `Your subscription expires in ${daysLeft} days`,
      template: 'subscription-expiring',
      data: {
        name: data.ownerName,
        businessName: data.businessName,
        plan: data.plan,
        daysLeft,
        renewLink: `${process.env.CLIENT_URL}/vendor/subscription/renew`,
      },
      priority: urgency,
    });

    // Send SMS for urgent cases
    if (daysLeft <= 3) {
      await addJob('sms', 'send', {
        to: data.phone,
        message: `URGENT: Your RentEase vendor subscription expires in ${daysLeft} days. Renew now: ${process.env.CLIENT_URL}/vendor/subscription/renew`,
      });
    }
  } catch (error) {
    logger.error('Error handling subscription expiring event:', error);
  }
});

// ====================================
// VENDOR SUPPORT EVENTS
// ====================================

/**
 * Vendor support ticket created
 */
eventEmitter.on('vendor:support-ticket-created', async (data) => {
  try {
    logger.info(`Support ticket created by vendor: ${data.vendorId} - Ticket: ${data.ticketId}`);

    // Acknowledge receipt
    await createNotification({
      userId: data.vendorId,
      type: 'in_app',
      title: 'Support Ticket Received',
      content: `Your support ticket #${data.ticketNumber} has been created. We'll get back to you soon.`,
      data: {
        ticketId: data.ticketId,
        ticketNumber: data.ticketNumber,
        action: 'track_ticket',
      },
    });

    // Send email confirmation
    await addJob('email', 'send', {
      to: data.email,
      subject: `Support Ticket #${data.ticketNumber} Created`,
      template: 'support-ticket-created',
      data: {
        name: data.ownerName,
        businessName: data.businessName,
        ticketNumber: data.ticketNumber,
        issueType: data.issueType,
        description: data.description,
        trackLink: `${process.env.CLIENT_URL}/vendor/support/${data.ticketId}`,
      },
    });

    // Notify support team based on priority
    emitToAdmins('support:ticket-created', {
      ticketId: data.ticketId,
      ticketNumber: data.ticketNumber,
      vendorId: data.vendorId,
      businessName: data.businessName,
      issueType: data.issueType,
      priority: data.priority,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error('Error handling support ticket created event:', error);
  }
});

module.exports = eventEmitter; // Export for use in other files