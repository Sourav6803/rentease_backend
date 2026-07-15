const nodemailer = require("nodemailer");
const hbs = require("nodemailer-express-handlebars");
const path = require("path");
const logger = require("../config/logger");
const AppError = require("../utils/AppError");
const { addJob } = require("../jobs");

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
    this.defaultFrom = process.env.EMAIL_FROM || "noreply@rentease.com";
    this.defaultFromName = process.env.EMAIL_FROM_NAME || "RentEase";
  }

  /**
   * Initialize email transporter
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Create transporter based on environment
      if (process.env.NODE_ENV === "production") {
        // Production: Use SMTP or sendgrid
        this.transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT) || 587,
          secure: process.env.SMTP_SECURE === "true",
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
          pool: true, // Use pooled connections
          maxConnections: 5,
          maxMessages: 100,
          rateDelta: 1000, // Rate limiting
          rateLimit: 5, // 5 emails per second
        });
      } else {
        // Development: Use ethereal.email for testing
        const testAccount = await nodemailer.createTestAccount();
        this.transporter = nodemailer.createTransport({
          host: "smtp.ethereal.email",
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        });
        logger.info("📧 Using ethereal.email for testing");
        logger.info(`📧 Preview URL: https://ethereal.email/messages`);
      }
      
      const handlebarOptions = {
        viewEngine: {
          extName: ".hbs", // Change to .hbs
          partialsDir: path.join(__dirname, "../templates/emails/partials"),
          layoutsDir: path.join(__dirname, "../templates/emails/layouts"),
          defaultLayout: "layout",
          helpers: {
            // Equality helper used by templates (e.g. priority badges)
            eq: (a, b) => a === b,
          },
        },
        viewPath: path.join(__dirname, "../templates/emails"),
        extName: ".hbs", // Change to .hbs
      };

      this.transporter.use("compile", hbs(handlebarOptions));

      // Verify connection
      await this.transporter.verify();
      this.initialized = true;
      logger.info("✅ Email service initialized successfully");
    } catch (error) {
      console.error("Email service initialization error:", error);
      logger.error("❌ Email service initialization failed:", error);
      // Don't throw - service can work without email
      this.initialized = false;
    }
  }

  /**
   * Send email
   */
  async sendEmail(options) {
    console.log("from send email function-->", options);
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const {
        to,
        subject,
        html,
        text,
        template,
        data,
        attachments = [],
        from = this.defaultFrom,
        fromName = this.defaultFromName,
        cc,
        bcc,
        replyTo,
      } = options;

      const mailOptions = {
        from: `"${fromName}" <${from}>`,
        to: Array.isArray(to) ? to.join(", ") : to,
        subject,
        attachments,
      };

      const finalText = text || (html ? stripHtml(html) : "");

      if (template) {
        mailOptions.template = template;
        mailOptions.context = data || {};
      } else {
        if (html) mailOptions.html = html;
      }

      if (finalText) mailOptions.text = finalText;

      if (cc) mailOptions.cc = Array.isArray(cc) ? cc.join(", ") : cc;
      if (bcc) mailOptions.bcc = Array.isArray(bcc) ? bcc.join(", ") : bcc;
      if (replyTo) mailOptions.replyTo = replyTo;

      const info = await this.transporter.sendMail(mailOptions);

      logger.info(`📧 Email sent: ${info.messageId} to: ${to}`);

      // For development, log the preview URL
      if (process.env.NODE_ENV !== "production") {
        logger.info(`📧 Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
      }

      return {
        success: true,
        messageId: info.messageId,
        previewUrl:
          process.env.NODE_ENV !== "production"
            ? nodemailer.getTestMessageUrl(info)
            : null,
      };
    } catch (error) {
      logger.error("❌ Error sending email:", error);
      throw new AppError("Failed to send email", 500);
    }
  }

  /**
   * Send welcome email
   */
  async sendWelcomeEmail(user) {
    const data = {
      name: user.profile?.firstName || "User",
      email: user.email,
      loginUrl: `${process.env.CLIENT_URL}/login`,
      exploreUrl: `${process.env.CLIENT_URL}/products`,
      year: new Date().getFullYear(),
    };

    return this.sendEmail({
      to: user.email,
      subject: "Welcome to RentEase! 🎉",
      template: "welcome",
      data,
    });
  }

  /**
   * Send email verification
   */
  async sendVerificationEmail(user, token) {
    const verificationUrl = `${process.env.CLIENT_URL}/verify-email?token=${token}`;

    const data = {
      name: user.profile?.firstName || "User",
      email: user.email,
      verificationUrl,
      expiryTime: "24 hours",
      year: new Date().getFullYear(),
    };

    return this.sendEmail({
      to: user.email,
      subject: "Verify Your Email - RentEase",
      template: "email-verification",
      data,
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(user, token) {
    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${token}`;

    const data = {
      name: user.profile?.firstName || "User",
      email: user.email,
      resetUrl,
      expiryTime: "10 minutes",
      year: new Date().getFullYear(),
    };

    return this.sendEmail({
      to: user.email,
      subject: "Reset Your Password - RentEase",
      template: "password-reset",
      data,
    });
  }

  /**
   * Send password changed confirmation
   */
  async sendPasswordChangedEmail(user) {
    const data = {
      name: user.profile?.firstName || "User",
      email: user.email,
      loginUrl: `${process.env.CLIENT_URL}/login`,
      supportEmail: process.env.SUPPORT_EMAIL || "support@rentease.com",
      year: new Date().getFullYear(),
    };

    return this.sendEmail({
      to: user.email,
      subject: "Password Changed Successfully - RentEase",
      template: "password-changed",
      data,
    });
  }

  /**
   * Send rental confirmation
   */
  async sendRentalConfirmationEmail(user, rental) {
    const data = {
      name: user.profile?.firstName || "User",
      email: user.email,
      rentalNumber: rental.rentalNumber,
      productName: rental.product?.basicInfo?.name || "Product",
      startDate: new Date(rental.rentalDetails.startDate).toLocaleDateString(),
      endDate: new Date(rental.rentalDetails.endDate).toLocaleDateString(),
      monthlyRent: rental.rentalDetails.monthlyRent,
      securityDeposit: rental.rentalDetails.securityDeposit,
      totalAmount: rental.rentalDetails.totalAmount,
      deliveryAddress: rental.address,
      trackUrl: `${process.env.CLIENT_URL}/rentals/${rental._id}/track`,
      year: new Date().getFullYear(),
    };

    return this.sendEmail({
      to: user.email,
      subject: `Rental Confirmed #${rental.rentalNumber} - RentEase`,
      template: "rental-confirmation",
      data,
    });
  }

  /**
   * Send payment receipt
   */
  async sendPaymentReceiptEmail(user, payment, rental) {
    const data = {
      name: user.profile?.firstName || "User",
      email: user.email,
      paymentNumber: payment.paymentNumber,
      rentalNumber: rental.rentalNumber,
      amount: payment.amount,
      paymentMethod: payment.method,
      paymentDate: new Date(payment.createdAt).toLocaleString(),
      paymentType: payment.type,
      invoiceUrl: `${process.env.API_URL}/api/v1/payments/${payment._id}/invoice`,
      year: new Date().getFullYear(),
    };

    // Generate PDF invoice
    const invoicePdf = await this.generateInvoicePDF(payment, rental, user);

    return this.sendEmail({
      to: user.email,
      subject: `Payment Receipt #${payment.paymentNumber} - RentEase`,
      template: "payment-receipt",
      data,
      attachments: [
        {
          filename: `invoice-${payment.paymentNumber}.pdf`,
          content: invoicePdf,
          contentType: "application/pdf",
        },
      ],
    });
  }

  /**
   * Send delivery notification
   */
  async sendDeliveryNotificationEmail(user, delivery) {
    const data = {
      name: user.profile?.firstName || "User",
      email: user.email,
      deliveryNumber: delivery.deliveryNumber,
      rentalNumber: delivery.rental?.rentalNumber,
      deliveryDate: new Date(delivery.schedule.scheduledDate).toLocaleString(),
      deliverySlot: delivery.schedule.scheduledSlot,
      address: delivery.address,
      trackingUrl: `${process.env.CLIENT_URL}/deliveries/${delivery._id}/track`,
      year: new Date().getFullYear(),
    };

    return this.sendEmail({
      to: user.email,
      subject: `Delivery Scheduled #${delivery.deliveryNumber} - RentEase`,
      template: "delivery-notification",
      data,
    });
  }

  /**
   * Send maintenance request confirmation
   */
  async sendMaintenanceConfirmationEmail(user, maintenance) {
    const data = {
      name: user.profile?.firstName || "User",
      email: user.email,
      requestNumber: maintenance.requestNumber,
      issueType: maintenance.issueType,
      description: maintenance.description,
      priority: maintenance.priority,
      requestedDate: new Date(maintenance.createdAt).toLocaleString(),
      trackUrl: `${process.env.CLIENT_URL}/maintenance/${maintenance._id}/track`,
      year: new Date().getFullYear(),
    };

    return this.sendEmail({
      to: user.email,
      subject: `Maintenance Request #${maintenance.requestNumber} - RentEase`,
      template: "maintenance-confirmation",
      data,
    });
  }

  /**
   * Send vendor approval email
   */
  async sendVendorApprovalEmail(vendor) {
    const data = {
      name: vendor.user?.profile?.firstName || "Vendor",
      businessName: vendor.business.name,
      email: vendor.user?.email,
      dashboardUrl: `${process.env.CLIENT_URL}/vendor/dashboard`,
      year: new Date().getFullYear(),
    };

    return this.sendEmail({
      to: vendor.user?.email,
      subject: "Vendor Account Approved - RentEase",
      template: "vendor-approval",
      data,
    });
  }

  /**
   * Send vendor rejection email
   */
  async sendVendorRejectionEmail(vendor, reason) {
    const data = {
      name: vendor.user?.profile?.firstName || "Vendor",
      businessName: vendor.business.name,
      email: vendor.user?.email,
      reason: reason,
      supportEmail: process.env.SUPPORT_EMAIL || "support@rentease.com",
      year: new Date().getFullYear(),
    };

    return this.sendEmail({
      to: vendor.user?.email,
      subject: "Vendor Application Update - RentEase",
      template: "vendor-rejection",
      data,
    });
  }

  /**
   * Send invoice email
   */
  async sendInvoiceEmail(user, invoice) {
    const data = {
      name: user.profile?.firstName || "User",
      email: user.email,
      invoiceNumber: invoice.invoiceNumber,
      items: invoice.items,
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total: invoice.total,
      dueDate: new Date(invoice.dueDate).toLocaleDateString(),
      paymentUrl: `${process.env.CLIENT_URL}/payments/${invoice._id}`,
      year: new Date().getFullYear(),
    };

    // Attach PDF invoice
    const invoicePdf = await this.generateInvoicePDF(invoice);

    return this.sendEmail({
      to: user.email,
      subject: `Invoice #${invoice.invoiceNumber} - RentEase`,
      template: "invoice",
      data,
      attachments: [
        {
          filename: `invoice-${invoice.invoiceNumber}.pdf`,
          content: invoicePdf,
          contentType: "application/pdf",
        },
      ],
    });
  }

  /**
   * Send bulk email (for marketing/newsletters)
   */
  async sendBulkEmail(recipients, subject, template, data, options = {}) {
    const batchSize = 50; // Send in batches to avoid rate limiting
    const batches = [];

    for (let i = 0; i < recipients.length; i += batchSize) {
      batches.push(recipients.slice(i, i + batchSize));
    }

    const results = {
      total: recipients.length,
      sent: 0,
      failed: 0,
      errors: [],
    };

    for (const batch of batches) {
      const promises = batch.map((recipient) =>
        this.sendEmail({
          to: recipient.email,
          subject,
          template,
          data: { ...data, ...recipient.data },
          ...options,
        }).catch((error) => {
          results.failed++;
          results.errors.push({
            recipient: recipient.email,
            error: error.message,
          });
        }),
      );

      const sentResults = await Promise.allSettled(promises);
      results.sent += sentResults.filter(
        (r) => r.status === "fulfilled",
      ).length;

      // Wait between batches
      if (batches.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    logger.info(
      `📧 Bulk email sent: ${results.sent} successful, ${results.failed} failed`,
    );
    return results;
  }

  /**
   * Generate invoice PDF (placeholder - implement with pdfkit)
   */
  async generateInvoicePDF(invoice, rental, user) {
    // TODO: Implement PDF generation using pdfkit
    // This is a placeholder
    return Buffer.from("PDF content placeholder");
  }

  /**
   * Test email configuration
   */
  async testConnection() {
    try {
      await this.initialize();
      return { success: true, message: "Email service is working" };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Get email statistics
   */
  getStats() {
    return {
      initialized: this.initialized,
      transporter: this.transporter ? "Connected" : "Disconnected",
      defaultFrom: this.defaultFrom,
    };
  }
}

// Create and export singleton instance
const emailService = new EmailService();

// Initialize on module load
emailService.initialize().catch(console.error);

module.exports = emailService;
module.exports.stripHtml = stripHtml;

// const nodemailer = require('nodemailer');
// const hbs = require('nodemailer-express-handlebars');
// const path = require('path');
// const logger = require('../config/logger');
// const AppError = require('../utils/AppError');

// class EmailService {
//   constructor() {
//     this.transporter = null;
//     this.initialized = false;
//     this.defaultFrom = process.env.EMAIL_FROM || 'noreply@rentease.com';
//     this.defaultFromName = process.env.EMAIL_FROM_NAME || 'RentEase';
//   }

//   /**
//    * Initialize email transporter
//    */
//   async initialize() {
//     if (this.initialized) return;

//     console.log("process.env.NODE_ENV->", process.env.NODE_ENV)

//     try {
//       // For development, use ethereal.email
//       if (process.env.NODE_ENV !== 'production') {
//         console.log("Initializing email service in development mode")
//         // const testAccount = await nodemailer.createTestAccount();
//         this.transporter = nodemailer.createTransport({
//           host: process.env.SMTP_HOST,
//           port: parseInt(process.env.SMTP_PORT) || 587,
//           secure: process.env.SMTP_SECURE === 'true',
//           auth: {
//             user: process.env.SMTP_USER,
//             pass: process.env.SMTP_PASS,
//           },
//         });
//         logger.info('📧 Using ethereal.email for testing');
//         // logger.info(`📧 Test account: ${testAccount.user}`);
//       } else {
//         // Production: Use your SMTP settings
//         this.transporter = nodemailer.createTransport({
//           host: process.env.SMTP_HOST,
//           port: parseInt(process.env.SMTP_PORT) || 587,
//           secure: process.env.SMTP_SECURE === 'true',
//           auth: {
//             user: process.env.SMTP_USER,
//             pass: process.env.SMTP_PASS,
//           },
//         });
//       }

//       // Configure handlebars options
//       const handlebarOptions = {
//         viewEngine: {
//           extName: '.hbs',
//           partialsDir: path.join(__dirname, '../templates/emails/partials'),
//           layoutsDir: path.join(__dirname, '../templates/emails/layouts'),
//           defaultLayout: false, // Change this to false if you don't have a layout
//         },
//         viewPath: path.join(__dirname, '../templates/emails'),
//         extName: '.hbs',
//       };

//       // Use the transporter with handlebars
//       this.transporter.use('compile', hbs(handlebarOptions));

//       // Verify connection
//       await this.transporter.verify();
//       this.initialized = true;
//       logger.info('✅ Email service initialized successfully');
//     } catch (error) {
//       logger.error('❌ Email service initialization failed:', error);
//       // Don't throw - service can work without email in development
//       if (process.env.NODE_ENV === 'production') {
//         throw error;
//       }
//     }
//   }

//   /**
//    * Send email
//    */
//   async sendEmail(options) {
//     console.log("hiiiiiiiiii")
//     // For development without email, just log and return success
//     if (process.env.NODE_ENV !== 'production' && !this.initialized) {
//         console.log("lllllll")
//       logger.info('📧 [DEV MODE] Email would be sent:', {
//         to: options.to,
//         subject: options.subject,
//         template: options.template,
//         data: options.data,
//       });

//       // Generate ethereal URL if available
//       if (this.transporter) {
//         console.log("pppppp")
//         try {
//           const testAccount = await nodemailer.createTestAccount();
//           const testTransporter = nodemailer.createTransport({
//             host: 'smtp.ethereal.email',
//             port: 587,
//             secure: false,
//             auth: {
//               user: testAccount.user,
//               pass: testAccount.pass,
//             },
//           });

//           const info = await testTransporter.sendMail({
//             from: `"${this.defaultFromName}" <${this.defaultFrom}>`,
//             to: options.to,
//             subject: options.subject,
//             html: `<h1>Test Email</h1><p>This is a test email for template: ${options.template}</p>`,
//           });

//           logger.info(`📧 Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
//           return { success: true, previewUrl: nodemailer.getTestMessageUrl(info) };
//         } catch (e) {
//           logger.info('📧 Could not create test email preview');
//         }
//       }

//       return { success: true, devMode: true };
//     }

//     if (!this.initialized) {
//       await this.initialize();
//     }

//     try {
//       const {
//         to,
//         subject,
//         html,
//         text,
//         template,
//         data,
//         attachments = [],
//         from = this.defaultFrom,
//         fromName = this.defaultFromName,
//         cc,
//         bcc,
//         replyTo,
//       } = options;

//       const mailOptions = {
//         from: `"${fromName}" <${from}>`,
//         to: Array.isArray(to) ? to.join(', ') : to,
//         subject,
//         attachments,
//       };

//       // Handle template or html/text
//       if (template) {
//         mailOptions.template = template;
//         mailOptions.context = data || {};
//       } else if (html) {
//         mailOptions.html = html;
//       } else if (text) {
//         mailOptions.text = text;
//       }

//       if (cc) mailOptions.cc = Array.isArray(cc) ? cc.join(', ') : cc;
//       if (bcc) mailOptions.bcc = Array.isArray(bcc) ? bcc.join(', ') : bcc;
//       if (replyTo) mailOptions.replyTo = replyTo;

//       const info = await this.transporter.sendMail(mailOptions);

//       logger.info(`📧 Email sent: ${info.messageId} to: ${to}`);

//       // For development, log the preview URL
//       if (process.env.NODE_ENV !== 'production') {
//         logger.info(`📧 Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
//       }

//       return {
//         success: true,
//         messageId: info.messageId,
//         previewUrl: process.env.NODE_ENV !== 'production' ? nodemailer.getTestMessageUrl(info) : null,
//       };
//     } catch (error) {
//       logger.error('❌ Error sending email:', error);

//       // In development, don't throw error
//       if (process.env.NODE_ENV !== 'production') {
//         logger.info('📧 [DEV MODE] Email failed but continuing...');
//         return { success: false, devMode: true, error: error.message };
//       }

//       throw new AppError('Failed to send email', 500);
//     }
//   }

//   /**
//    * Send verification email
//    */
//   async sendVerificationEmail(user, token) {
//     const verificationUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/verify-email?token=${token}`;

//     console.log("verificationUrl-->", verificationUrl)

//     const data = {
//       name: user.profile?.firstName || 'User',
//       email: user.email,
//       verificationUrl,
//       expiryTime: '24 hours',
//       year: new Date().getFullYear(),
//     };

//     logger.info('📧 Sending verification email with data:', data);

//     return this.sendEmail({
//       to: user.email,
//       subject: 'Verify Your Email - RentEase',
//       template: 'email-verification',
//       data,
//     });
//   }

//   // ... other methods (sendWelcomeEmail, sendPasswordResetEmail, etc.)
// }

// // Create and export singleton instance
// const emailService = new EmailService();

// // Initialize on module load (don't await)
// emailService.initialize().catch(err => {
//   logger.warn('⚠️ Email service initialization failed, continuing without email:', err.message);
// });

// module.exports = emailService;
