// controllers/sms-settings.controller.js
const smsService = require('../../services/sms.service');
const { SystemSettings } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');

class SmsSettingsController {
  maskAccountSid(sid) {
    if (!sid || sid.length <= 4) return sid || '';
    return '****' + sid.slice(-4);
  }

  getSmsSettings = catchAsync(async (req, res) => {
    let settings = await SystemSettings.findOne().lean();

    if (!settings) {
      settings = {
        sms: {
          twilio: {
            accountSid: '',
            authToken: '',
            messagingServiceSid: '',
            fromNumber: '',
            statusCallbackUrl: '',
            testMode: false
          },
          templates: [],
          usage: {
            totalSent: 0,
            totalSegments: 0,
            totalCost: 0,
            dailyStats: []
          }
        }
      };
    }

    const twilioConfig = settings.sms?.twilio || {};
    const usage = settings.sms?.usage || { totalSent: 0, totalSegments: 0, totalCost: 0, dailyStats: [] };

    const defaultTemplates = [
      { id: 'otp-verification', name: 'OTP Verification', body: 'Your OTP is {{otp}}. Valid for 10 minutes.', variables: ['otp'], isActive: true },
      { id: 'rental-confirmation', name: 'Rental Confirmation', body: 'Your rental #{{rentalId}} has been confirmed.', variables: ['rentalId'], isActive: true },
      { id: 'delivery-update', name: 'Delivery Update', body: 'Your delivery status: {{status}}', variables: ['status'], isActive: true },
      { id: 'payment-receipt', name: 'Payment Receipt', body: 'Payment of ₹{{amount}} received. Receipt: {{receiptId}}', variables: ['amount', 'receiptId'], isActive: true },
      { id: 'overdue-rental', name: 'Overdue Rental', body: 'Your rental #{{rentalId}} is overdue. Please return immediately.', variables: ['rentalId'], isActive: true },
      { id: 'maintenance-scheduled', name: 'Maintenance Scheduled', body: 'Maintenance scheduled for {{date}} at {{time}}.', variables: ['date', 'time'], isActive: true },
      { id: 'promo-offer', name: 'Promo Offer', body: 'Use code {{code}} for {{discount}}% off!', variables: ['code', 'discount'], isActive: true },
      { id: 'welcome-sms', name: 'Welcome SMS', body: 'Welcome to RentEase! Your account has been created.', variables: [], isActive: true }
    ];

    const templates = settings.sms?.templates?.length > 0
      ? settings.sms.templates
      : defaultTemplates;

    return ApiResponse.success(res, 200, 'SMS settings retrieved successfully', {
      twilio: {
        accountSid: this.maskAccountSid(twilioConfig.accountSid),
        authToken: twilioConfig.authToken ? '***' : '',
        messagingServiceSid: twilioConfig.messagingServiceSid || '',
        fromNumber: twilioConfig.fromNumber || '',
        statusCallbackUrl: twilioConfig.statusCallbackUrl || '',
        testMode: twilioConfig.testMode || false
      },
      usage: {
        totalSent: usage.totalSent || 0,
        totalSegments: usage.totalSegments || 0,
        totalCost: usage.totalCost || 0,
        successRate: usage.totalSent > 0 ? 100 : 0,
        dailyStats: usage.dailyStats || []
      },
      templates
    });
  });

  updateTwilioSettings = catchAsync(async (req, res) => {
    const twilioFields = req.body;

    const allowedFields = ['accountSid', 'authToken', 'messagingServiceSid', 'fromNumber', 'statusCallbackUrl', 'testMode'];
    const updateData = {};

    allowedFields.forEach(field => {
      if (twilioFields[field] !== undefined) {
        updateData[`sms.twilio.${field}`] = twilioFields[field];
      }
    });

    const settings = await SystemSettings.findOneAndUpdate(
      {},
      { $set: updateData },
      { new: true, upsert: true }
    );

    return ApiResponse.success(res, 200, 'Twilio settings updated successfully', { twilio: settings.sms?.twilio });
  });

  testSms = catchAsync(async (req, res) => {
    const { to, template, body, variables } = req.body;

    let messageBody = body || '';

    if (template && !body) {
      const templateMap = {
        'otp-verification': 'Your OTP is {{otp}}. Valid for 10 minutes.',
        'rental-confirmation': 'Your rental #{{rentalId}} has been confirmed.',
        'delivery-update': 'Your delivery status: {{status}}',
        'payment-receipt': 'Payment of ₹{{amount}} received.',
        'overdue-rental': 'Your rental #{{rentalId}} is overdue.',
        'maintenance-scheduled': 'Maintenance scheduled for {{date}} at {{time}}.',
        'promo-offer': 'Use code {{code}} for {{discount}}% off!',
        'welcome-sms': 'Welcome to RentEase!'
      };
      messageBody = templateMap[template] || template;

      if (variables) {
        Object.keys(variables).forEach(key => {
          messageBody = messageBody.replace(new RegExp(`{{${key}}}`, 'g'), variables[key]);
        });
      }
    }

    if (!to) {
      throw new AppError('Recipient phone number is required', 400);
    }

    const result = await smsService.sendMessage(to, messageBody);

    return ApiResponse.success(res, 200, 'Test SMS sent successfully', result);
  });

  updateTemplate = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { body, name, variables, isActive } = req.body;

    if (!body) {
      throw new AppError('Template body is required', 400);
    }

    let settings = await SystemSettings.findOne();

    if (!settings) {
      settings = new SystemSettings({
        sms: {
          templates: [{ id, body, name: name || id, variables: variables || [], isActive: isActive !== undefined ? isActive : true }]
        }
      });
    } else {
      const template = settings.sms.templates.find(t => t.id === id);
      if (template) {
        template.body = body;
        if (name !== undefined) template.name = name;
        if (variables !== undefined) template.variables = variables;
        if (isActive !== undefined) template.isActive = isActive;
      } else {
        settings.sms.templates.push({ id, body, name: name || id, variables: variables || [], isActive: isActive !== undefined ? isActive : true });
      }
    }

    await settings.save();

    const updatedTemplate = settings.sms.templates.find(t => t.id === id);

    return ApiResponse.success(res, 200, 'Template updated successfully', { template: updatedTemplate });
  });

  getSmsBalance = catchAsync(async (req, res) => {
    try {
      const result = await smsService.getBalance();
      return ApiResponse.success(res, 200, 'Balance retrieved successfully', result);
    } catch (error) {
      logger.error?.('Error in getSmsBalance:', error);
      return ApiResponse.success(res, 200, 'Balance retrieved (mock)', {
        balance: 0,
        currency: 'USD',
        mock: true
      });
    }
  });
}

module.exports = new SmsSettingsController();
