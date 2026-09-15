const nodemailer = require("nodemailer");
const hbs = require("nodemailer-express-handlebars");
const path = require("path");
const PDFDocument = require("pdfkit");
const logger = require("../config/logger");
const AppError = require("../utils/AppError");

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
    /**
     * Why the last initialize() failed, if it did. Surfaced by sendEmail() so the
     * reason reaches the notification record instead of being swallowed.
     */
    this.lastInitError = null;
    this.defaultFrom = process.env.EMAIL_FROM || "noreply@rentease.com";
    this.defaultFromName = process.env.EMAIL_FROM_NAME || "RentEase";
  }

  /**
   * Initialize email transporter
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Use real SMTP whenever configured; fall back to ethereal only if not
      if (process.env.NODE_ENV === "production" || process.env.SMTP_HOST) {
        // Fail loudly and specifically. Previously, a deployment with SMTP_HOST
        // unset still built a transport against `host: undefined` (which silently
        // means localhost), verify() failed, and the error was swallowed at the
        // bottom of this method — so a complete email outage looked exactly like
        // "no email arrived", with nothing actionable anywhere in the logs.
        const missing = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"].filter(
          (key) => !process.env[key],
        );

        if (missing.length > 0) {
          this.lastInitError =
            `SMTP mode selected (NODE_ENV=${process.env.NODE_ENV || "unset"}) but ` +
            `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set.`;

          logger.error(`❌ Email service not configured: ${this.lastInitError}`);
          this.initialized = false;
          return;
        }

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
      this.lastInitError = null;
      logger.info("✅ Email service initialized successfully");
    } catch (error) {
      console.error("Email service initialization error:", error);
      logger.error("❌ Email service initialization failed:", error);
      this.lastInitError = error?.message || String(error);
      // Don't throw - service can work without email
      this.initialized = false;
    }
  }

  /**
   * Send email
   */
  async sendEmail(options) {
    if (!this.initialized) {
      await this.initialize();
    }

    // Fail fast, and say WHY. Without this the send went ahead on a transporter
    // that had already failed verification, so the caller saw a generic SMTP error
    // and the actual cause (missing configuration) was lost.
    if (!this.transporter) {
      throw new Error(
        `Email transport is not available: ${this.lastInitError || "not configured"}`,
      );
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
        // Merge shared template context (logo, links, year) with caller data so
        // every template automatically gets the RentEase logo/links without each
        // call site having to pass them. Caller data wins on collisions.
        mailOptions.context = {
          logoUrl:
            process.env.LOGO_URL ||
            `${process.env.API_URL || 'http://localhost:5000'}/public/logo.png`,
          supportUrl: `${process.env.CLIENT_URL || ''}/support`,
          privacyUrl: `${process.env.CLIENT_URL || ''}/privacy`,
          termsUrl: `${process.env.CLIENT_URL || ''}/terms`,
          year: new Date().getFullYear(),
          email: to,
          ...(data || {}),
        };
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
  /**
   * Send the vendor payout (settlement) receipt.
   *
   * The `vendor-payout` template is also rendered by the `email/send` job that
   * NotificationService.sendVendorPayoutNotification enqueues, so the payload is
   * built once by NotificationService.buildVendorPayoutPayload and reused here.
   * One builder means the template and the data cannot drift apart.
   */
  async sendVendorPayoutEmail(user, payout, vendor) {
    const notificationService = require("./notification.service");
    const data = notificationService.buildVendorPayoutPayload(payout, vendor, user);

    return this.sendEmail({
      to: user.email,
      subject: `Payout Settled ${payout.payoutNumber} - RentEase`,
      template: "vendor-payout",
      data,
    });
  }

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
   * Generate a real, valid invoice PDF and return it as a Buffer for email
   * attachments. Handles both call shapes — the payment-receipt path passes
   * `(payment, rental, user)` while the invoice path passes `(invoice)` — so
   * every field is read defensively. Replaces the old fixed
   * `Buffer.from("PDF content placeholder")` (a 27-byte fake file sent to
   * customers).
   */
  async generateInvoicePDF(invoice, rental, user) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
        info: { Title: "RentEase Invoice", Author: "RentEase" },
      });

      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const fmtMoney = (n) => {
        if (n === undefined || n === null || Number.isNaN(Number(n))) return "—";
        return new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: "INR",
        }).format(Number(n));
      };
      const fmtDate = (d) =>
        d
          ? new Date(d).toLocaleDateString("en-IN", {
              year: "numeric",
              month: "short",
              day: "2-digit",
            })
          : "—";

      // ---- Header ----
      doc.fontSize(18).font("Helvetica-Bold").fillColor("#4f46e5").text("RentEase", { align: "center" });
      doc.fontSize(10).font("Helvetica").fillColor("#6b7280").text("Furniture & Appliance Rentals", { align: "center" }).moveDown(1.2);

      const invoiceNumber = invoice.invoiceNumber || invoice.paymentNumber || "N/A";
      const items = Array.isArray(invoice.items) ? invoice.items : [];
      const subtotal = invoice.subtotal ?? invoice.amount;
      const tax = invoice.tax ?? 0;
      const total = invoice.total ?? subtotal;
      const date = invoice.date || invoice.createdAt || invoice.paymentDate || new Date();

      doc.fontSize(13).font("Helvetica-Bold").fillColor("#000000").text("TAX INVOICE / RECEIPT", { align: "center" });
      doc.fontSize(9).font("Helvetica").fillColor("#6b7280")
        .text(`Invoice No: ${invoiceNumber}`, { align: "center" })
        .text(`Date: ${fmtDate(date)}`, { align: "center" })
        .moveDown();

      // ---- Billing party ----
      const customerName = user?.profile?.firstName || user?.name || invoice.customer?.name;
      if (customerName || user?.email) {
        doc.fontSize(10).font("Helvetica-Bold").fillColor("#000000").text("Billed To");
        doc.font("Helvetica").fillColor("#374151");
        if (customerName) doc.text(customerName);
        if (user?.email) doc.text(user.email);
        if (rental?.rentalNumber) doc.text(`Rental #${rental.rentalNumber}`);
        doc.moveDown();
      }

      // ---- Items table ----
      if (items.length > 0) {
        doc.fontSize(10).font("Helvetica-Bold").text("Items");
        const tableTop = doc.y;
        const line = { left: 50, right: 545 };
        doc.moveTo(line.left, tableTop).lineTo(line.right, tableTop).strokeColor("#e5e7eb").stroke();
        let y = tableTop + 6;
        items.forEach((item) => {
          const label = item.name || item.description || item.label || "Item";
          const amount = item.price ?? item.amount ?? item.rent ?? 0;
          doc.fontSize(9).font("Helvetica").fillColor("#374151").text(label, line.left, y, { width: 320 });
          doc.text(fmtMoney(amount), line.right, y, { align: "right" });
          y += 18;
        });
        doc.moveTo(line.left, y).lineTo(line.right, y).strokeColor("#e5e7eb").stroke();
        doc.moveDown(0.5);
      }

      // ---- Totals ----
      doc.fontSize(9);
      const totals = [];
      if (subtotal !== undefined && subtotal !== null) totals.push(["Subtotal", fmtMoney(subtotal)]);
      if (tax) totals.push(["Tax (GST)", fmtMoney(tax)]);
      totals.push(["Total", fmtMoney(total)]);
      let totalsY = doc.y;
      totals.forEach(([label, value]) => {
        doc.font("Helvetica").fillColor("#6b7280").text(`${label}:`, 350, totalsY, { width: 145 });
        doc.font("Helvetica-Bold").fillColor("#000000").text(value, 495, totalsY, { width: 50, align: "right" });
        totalsY += 16;
      });
      doc.y = totalsY;

      // ---- Footer ----
      const footerY = Math.max(doc.y + 24, doc.page.height - 60);
      doc.fontSize(8).font("Helvetica").fillColor("#9ca3af")
        .text("This is a computer-generated invoice and does not require a physical signature.", 50, footerY, { align: "center" })
        .text("For any queries, please contact support@rentease.com", 50, footerY + 12, { align: "center" });

      doc.end();
    });
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
