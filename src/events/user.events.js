// const { eventEmitter, EVENTS } = require('./index');
const eventEmitter = require('./eventEmitter');
const EVENTS = require('./events.constants');
const logger = require('../config/logger');
const { emitToUser, emitToAdmins } = require('../socket');
const { createNotification } = require('../services/notification.service');
const { processJob } = require('../jobs');

// User registered
eventEmitter.on(EVENTS.USER.REGISTERED, async (data) => {
  try {
    logger.info(`User registered: ${data.email}`);

    // Send welcome email
    await processJob('email:send', {
      to: data.email,
      template: 'welcome',
      data: {
        name: data.profile?.firstName,
        userId: data._id,
      },
    });

    // Send welcome notification
    await createNotification({
      userId: data._id,
      type: 'in_app',
      title: 'Welcome to RentEase!',
      content: 'Thank you for joining RentEase. Start exploring our products!',
      data: { userId: data._id },
    });

    // Notify admins
    emitToAdmins(EVENTS.USER.REGISTERED, {
      userId: data._id,
      email: data.email,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error('Error handling user registered event:', error);
  }
});

// User logged in
eventEmitter.on(EVENTS.USER.LOGGED_IN, async (data) => {
  try {
    logger.info(`User logged in: ${data.userId}`);

    // Update last login in database
    // await User.findByIdAndUpdate(data.userId, { lastLogin: new Date() });

    // Send login notification if new device
    if (data.isNewDevice) {
      await createNotification({
        userId: data.userId,
        type: 'email',
        title: 'New Device Login',
        content: `A new device logged into your account from ${data.location}`,
        data: { deviceInfo: data.deviceInfo, location: data.location },
      });
    }

    // Emit to user's other devices
    emitToUser(data.userId, 'user:loggedin-other', {
      timestamp: new Date(),
      deviceInfo: data.deviceInfo,
    });
  } catch (error) {
    logger.error('Error handling user logged in event:', error);
  }
});

// User logged out
eventEmitter.on(EVENTS.USER.LOGGED_OUT, async (data) => {
  try {
    logger.info(`User logged out: ${data.userId}`);
    
    // Emit to user's other devices
    emitToUser(data.userId, 'user:loggedout-other', {
      timestamp: new Date(),
      deviceInfo: data.deviceInfo,
    });
  } catch (error) {
    logger.error('Error handling user logged out event:', error);
  }
});

// Profile updated
eventEmitter.on(EVENTS.USER.PROFILE_UPDATED, async (data) => {
  try {
    logger.info(`Profile updated: ${data.userId}`);

    // Send confirmation notification
    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Profile Updated',
      content: 'Your profile has been updated successfully.',
      data: { changes: data.changes },
    });

    // Emit to user
    emitToUser(data.userId, 'user:profile-updated', {
      timestamp: new Date(),
      changes: data.changes,
    });
  } catch (error) {
    logger.error('Error handling profile updated event:', error);
  }
});

// Email verified
eventEmitter.on(EVENTS.USER.EMAIL_VERIFIED, async (data) => {
  try {
    logger.info(`Email verified: ${data.userId}`);

    // Send welcome email if first verification
    if (data.firstTime) {
      await processJob('email:send', {
        to: data.email,
        template: 'email-verified',
        data: { name: data.name },
      });
    }

    // Send notification
    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Email Verified',
      content: 'Your email has been verified successfully.',
    });

    emitToUser(data.userId, 'user:email-verified', {
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error('Error handling email verified event:', error);
  }
});

// Phone verified
eventEmitter.on(EVENTS.USER.PHONE_VERIFIED, async (data) => {
  try {
    logger.info(`Phone verified: ${data.userId}`);

    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'Phone Verified',
      content: 'Your phone number has been verified successfully.',
    });

    emitToUser(data.userId, 'user:phone-verified', {
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error('Error handling phone verified event:', error);
  }
});

// KYC submitted
eventEmitter.on(EVENTS.USER.KYC_SUBMITTED, async (data) => {
  try {
    logger.info(`KYC submitted: ${data.userId}`);

    // Send confirmation
    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'KYC Submitted',
      content: 'Your KYC documents have been submitted for verification.',
    });

    // Notify admins
    emitToAdmins('kyc:submitted', {
      userId: data.userId,
      documents: data.documents,
      timestamp: new Date(),
    });

    // Schedule reminder for admin review
    await processJob('kyc:review-reminder', {
      userId: data.userId,
      scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
    });
  } catch (error) {
    logger.error('Error handling KYC submitted event:', error);
  }
});

// KYC approved
eventEmitter.on(EVENTS.USER.KYC_APPROVED, async (data) => {
  try {
    logger.info(`KYC approved: ${data.userId}`);

    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'KYC Approved',
      content: 'Your KYC has been approved. You can now rent products!',
    });

    // Send email
    await processJob('email:send', {
      to: data.email,
      template: 'kyc-approved',
      data: { name: data.name },
    });

    emitToUser(data.userId, 'kyc:approved', {
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error('Error handling KYC approved event:', error);
  }
});

// KYC rejected
eventEmitter.on(EVENTS.USER.KYC_REJECTED, async (data) => {
  try {
    logger.info(`KYC rejected: ${data.userId}`);

    await createNotification({
      userId: data.userId,
      type: 'in_app',
      title: 'KYC Rejected',
      content: `Your KYC was rejected. Reason: ${data.reason}`,
      data: { reason: data.reason, comments: data.comments },
    });

    // Send email with details
    await processJob('email:send', {
      to: data.email,
      template: 'kyc-rejected',
      data: {
        name: data.name,
        reason: data.reason,
        comments: data.comments,
      },
    });

    emitToUser(data.userId, 'kyc:rejected', {
      reason: data.reason,
      comments: data.comments,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error('Error handling KYC rejected event:', error);
  }
});

// Account blocked
eventEmitter.on(EVENTS.USER.ACCOUNT_BLOCKED, async (data) => {
  try {
    logger.warn(`Account blocked: ${data.userId} - Reason: ${data.reason}`);

    await createNotification({
      userId: data.userId,
      type: 'email',
      title: 'Account Blocked',
      content: `Your account has been blocked. Reason: ${data.reason}`,
      data: { reason: data.reason, blockedBy: data.blockedBy },
    });

    // Notify admins
    emitToAdmins('user:blocked', {
      userId: data.userId,
      reason: data.reason,
      blockedBy: data.blockedBy,
      timestamp: new Date(),
    });

    // Force logout all sessions
    emitToUser(data.userId, 'user:force-logout', {
      reason: data.reason,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error('Error handling account blocked event:', error);
  }
});

// Account unblocked
eventEmitter.on(EVENTS.USER.ACCOUNT_UNBLOCKED, async (data) => {
  try {
    logger.info(`Account unblocked: ${data.userId}`);

    await createNotification({
      userId: data.userId,
      type: 'email',
      title: 'Account Unblocked',
      content: 'Your account has been unblocked. You can now login.',
    });

    emitToUser(data.userId, 'user:unblocked', {
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error('Error handling account unblocked event:', error);
  }
});