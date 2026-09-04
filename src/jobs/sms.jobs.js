// jobs/sms.jobs.js
const logger = require('../config/logger');
const smsService = require('../services/sms.service');

const process = async (type, data) => {
  logger.info(`Processing SMS job: ${type}`);

  try {
    switch (type) {
      case 'send':
        return await smsService.sendMessage(data.to, data.message, data.options);

      case 'login-otp':
        return await smsService.sendLoginOTP(data.phoneNumber);

      case 'delivery-otp':
        return await smsService.sendDeliveryOTP(data.phoneNumber, data.deliveryId);

      case 'password-reset':
        return await smsService.sendPasswordResetOTP(data.phoneNumber);

      case 'notification':
        return await smsService.sendMessage(data.to, data.message);

      default:
        logger.warn(`Unknown SMS job type: ${type}`);
        return { success: false, error: `Unknown SMS job type: ${type}` };
    }
  } catch (error) {
    logger.error(`Error processing SMS job ${type}:`, error);
    throw error;
  }
};

module.exports = { process };
