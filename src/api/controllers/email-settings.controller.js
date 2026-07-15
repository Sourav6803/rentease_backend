const SystemSettings = require('../../models/SystemSettings.model');
const { addJob } = require('../../jobs');
const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');

class EmailSettingsController {
  getEmailSettings = catchAsync(async (req, res) => {
    let settings = await SystemSettings.findOne({}).lean();
    if (!settings) {
      settings = await SystemSettings.create({});
    }

    const smtp = settings.email?.smtp || {};
    const templates = settings.email?.templates || [];

    const safeSmtp = {
      ...smtp,
      password: smtp.password ? '***' : ''
    };

    return ApiResponse.success(res, 200, 'Email settings retrieved successfully', {
      smtp: safeSmtp,
      templates
    });
  });

  updateSmtpSettings = catchAsync(async (req, res) => {
    const smtpData = req.body;

    const updated = await SystemSettings.findOneAndUpdate(
      {},
      { $set: { 'email.smtp': smtpData } },
      { new: true, upsert: true }
    );

    const smtp = updated.email?.smtp || {};
    const safeSmtp = {
      ...smtp,
      password: smtp.password ? '***' : ''
    };

    return ApiResponse.success(res, 200, 'SMTP settings updated successfully', {
      smtp: safeSmtp
    });
  });

  testEmail = catchAsync(async (req, res) => {
    const { to, subject, template } = req.body;

    if (!to) {
      throw new AppError('Recipient email is required', 400);
    }

    const jobData = {
      to,
      subject: subject || 'Test Email from RentEase',
      html: template || '<h1>Test Email</h1><p>This is a test email to verify your email configuration.</p>'
    };

    await addJob('email', 'send', jobData);

    return ApiResponse.success(res, 200, 'Test email queued successfully', {
      previewUrl: null
    });
  });

  updateTemplate = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { subject, template, name, variables, isActive } = req.body;

    if (!id) {
      throw new AppError('Template id is required', 400);
    }

    const settings = await SystemSettings.findOne({});

    if (!settings) {
      throw new AppError('Template not found', 404);
    }

    const targetTemplate = settings.email?.templates?.find(t => t.id === id);
    if (!targetTemplate) {
      throw new AppError('Template not found', 404);
    }

    if (subject !== undefined) targetTemplate.subject = subject;
    if (template !== undefined) targetTemplate.html = template;
    if (name !== undefined) targetTemplate.name = name;
    if (variables !== undefined) targetTemplate.variables = variables;
    if (isActive !== undefined) targetTemplate.isActive = isActive;

    await settings.save();

    return ApiResponse.success(res, 200, 'Template updated successfully', {
      template: targetTemplate
    });
  });
}

module.exports = new EmailSettingsController();
