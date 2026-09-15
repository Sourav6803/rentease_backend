const {
  Payment,
  Rental,
  User,
  Vendor,
  Product,
  SystemSettings,
  WebhookEvent,
  // Needed by the RazorpayX payout webhook handlers.
  Payout,
  VendorLedger,
} = require('../models');
const  AppError  = require('../utils/AppError');
const { addJob } = require('../jobs');
const { eventEmitter, EVENTS } = require('../events');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');
// Single source of truth for money rounding. feeCalculator is dependency-free,
// so importing it here cannot create a require cycle.
const { roundMoney, calculatePaymentFees } = require('../utils/feeCalculator');
// settlement.service does not require this file, so there is no cycle. It owns
// the ledger and payout rules; this service only tells it what happened.
const settlement = require('./settlement.service');
const Razorpay = require('razorpay');
const Stripe = require('stripe');
const crypto = require('crypto');
const encryption = require('../utils/encryption');

/** The shape `encryption.encryptToString` writes into a String field. */
const ENCRYPTED_ENVELOPE = /^\s*\{\s*"encrypted"\s*:/;

/**
 * A gateway secret read back from the settings collection.
 *
 * The settings screen persists secrets with `encryption.encryptToString`, so the
 * stored value is normally an envelope. A value written before that change — or by
 * an install with no ENCRYPTION_KEY, where `encryptToString` returns plaintext — is
 * still readable, so plaintext passes straight through.
 */
function decryptStoredSecret(stored) {
  if (!stored) return '';
  const value = String(stored);
  if (!ENCRYPTED_ENVELOPE.test(value)) return value;

  try {
    return String(encryption.decryptFromString(value) || '');
  } catch (error) {
    logger.warn(`Could not decrypt a stored gateway secret: ${error.message}`);
    return '';
  }
}

class PaymentService {
  constructor() {
    this.redisClient = getRedisClient();
    this.defaultTTL = 1800; // 30 minutes

    // Gateway clients are built LAZILY from `getGatewayCredentials()` rather than
    // here from `process.env`. Creating them eagerly from the env alone is exactly
    // why a key saved in the admin settings had no effect: the client, the payment
    // signature check and the payout reconciliation all read the env value no
    // matter what the settings screen said.
    this._gatewayClients = { razorpay: null, stripe: null, payout: null };
    this._gatewayClientKeys = { razorpay: null, stripe: null, payout: null };
  }

  /**
   * RazorpayX credentials for PAYOUTS.
   *
   * RazorpayX is a separate product, but it is NOT a separate key pair. Razorpay's
   * own docs are explicit: "If you are an existing Razorpay merchant, you can use
   * your existing API key with RazorpayX" — the merchant gets ONE key pair and it
   * authenticates both the payment gateway and the payouts API. (Verified against a
   * real account: the RazorpayX Developer Controls page and the Payments API-keys
   * page list the same `key_id`.)
   *
   * WHY THE FALLBACK MATTERS: the payout key secret is unrecoverable from the
   * Razorpay dashboard — the secret is shown only at generation time, and the
   * dashboard offers no reveal/download control (only "Regenerate Key"). So an
   * install that has a working payment gateway but no payout-specific key could
   * only proceed by REGENERATING the merchant key, which invalidates the key the
   * gateway is already using. Falling back to the gateway credentials — which this
   * codebase already stores and can decrypt — avoids that trap entirely.
   *
   * Resolution order: payout settings, then RAZORPAYX_* env, then the gateway's
   * Razorpay key pair. `source` records which one each value came from.
   */
  async getPayoutCredentials() {
    const env = {
      keyId: process.env.RAZORPAYX_KEY_ID,
      keySecret: process.env.RAZORPAYX_KEY_SECRET,
    };

    let stored = {};
    try {
      const settings = await SystemSettings.getInstance();
      const config = settings?.payment?.payout || {};
      stored = {
        keyId: decryptStoredSecret(config.keyId),
        keySecret: decryptStoredSecret(config.keySecret),
      };
    } catch (error) {
      logger.warn(`Could not read payout credentials from settings: ${error.message}`);
    }

    const resolve = (fromSettings, fromEnv) => {
      const value = typeof fromSettings === 'string' ? fromSettings.trim() : '';
      return value || (fromEnv ? String(fromEnv).trim() : '') || null;
    };

    let keyId = resolve(stored.keyId, env.keyId);
    let keySecret = resolve(stored.keySecret, env.keySecret);
    const source = {
      keyId: stored.keyId ? 'settings' : 'env',
      keySecret: stored.keySecret ? 'settings' : 'env',
    };

    /**
     * Last resort: the gateway's own Razorpay key pair (see the note above — it is
     * the same merchant key). Consulted only when the payout-specific sources came
     * up short, and field by field, so a half-configured payout block still gets
     * completed instead of being rejected.
     */
    if (!keyId || !keySecret) {
      const gateway = await this.getGatewayCredentials('razorpay');
      if (!keyId && gateway.keyId) {
        keyId = gateway.keyId;
        source.keyId = 'gateway';
      }
      if (!keySecret && gateway.keySecret) {
        keySecret = gateway.keySecret;
        source.keySecret = 'gateway';
      }
    }

    return { keyId, keySecret, source };
  }

  /** RazorpayX client for payouts, built from the resolved payout credentials. */
  async getPayoutClient() {
    const { keyId, keySecret } = await this.getPayoutCredentials();
    if (!keyId || !keySecret) return null;

    const fingerprint = `${keyId}:${keySecret}`;
    if (this._gatewayClients.payout && this._gatewayClientKeys.payout === fingerprint) {
      return this._gatewayClients.payout;
    }

    this._gatewayClients.payout = new Razorpay({ key_id: keyId, key_secret: keySecret });
    this._gatewayClientKeys.payout = fingerprint;
    return this._gatewayClients.payout;
  }

  /**
   * The credentials to use for a gateway: admin settings first, environment second.
   *
   * Stored values are decrypted on the way out. An empty settings value falls
   * straight through to the env var, so an install that has only ever used `.env`
   * behaves exactly as it did before this existed.
   */
  async getGatewayCredentials(gateway) {
    const env =
      gateway === 'stripe'
        ? {
            keyId: process.env.STRIPE_PUBLISHABLE_KEY,
            keySecret: process.env.STRIPE_SECRET_KEY,
            webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
          }
        : {
            keyId: process.env.RAZORPAY_KEY_ID,
            keySecret: process.env.RAZORPAY_KEY_SECRET,
            webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
          };

    let stored = {};
    try {
      const settings = await SystemSettings.getInstance();
      const config = settings?.payment?.[gateway] || {};
      stored = {
        keyId: decryptStoredSecret(config.keyId),
        // Stripe calls it `secretKey`, Razorpay calls it `keySecret`.
        keySecret: decryptStoredSecret(
          gateway === 'stripe' ? config.secretKey : config.keySecret,
        ),
        webhookSecret: decryptStoredSecret(config.webhookSecret),
      };
    } catch (error) {
      logger.warn(`Could not read ${gateway} credentials from settings: ${error.message}`);
    }

    const resolve = (fromSettings, fromEnv) => {
      const value = typeof fromSettings === 'string' ? fromSettings.trim() : '';
      return value || (fromEnv ? String(fromEnv).trim() : '') || null;
    };

    return {
      keyId: resolve(stored.keyId, env.keyId),
      keySecret: resolve(stored.keySecret, env.keySecret),
      webhookSecret: resolve(stored.webhookSecret, env.webhookSecret),
      // Where each value came from — logged, and asserted by the tests.
      source: {
        keyId: stored.keyId ? 'settings' : 'env',
        keySecret: stored.keySecret ? 'settings' : 'env',
        webhookSecret: stored.webhookSecret ? 'settings' : 'env',
      },
    };
  }

  /**
   * Which environment a payment's money came from: 'test', 'live', or null when it
   * cannot be determined.
   *
   * Derived from the key prefix of the credentials in use, because that — not any
   * stored flag — is what decides the environment at Razorpay. Recorded on the
   * payment at success time, and used later to stop a LIVE payout from sending real
   * money against earnings that were only ever test.
   */
  async resolvePaymentGatewayMode(payment) {
    const gateway = payment?.paymentDetails?.gateway;
    if (!gateway) return null;

    try {
      const { keyId } = await this.getGatewayCredentials(gateway);
      if (!keyId) return null;
      return /_live_/i.test(String(keyId)) ? 'live' : 'test';
    } catch (error) {
      logger.warn(`Could not resolve the gateway mode: ${error.message}`);
      return null;
    }
  }

  /** The Razorpay client for the resolved credentials, rebuilt if they change. */
  async getRazorpayClient() {
    const { keyId, keySecret } = await this.getGatewayCredentials('razorpay');
    if (!keyId || !keySecret) return null;

    const fingerprint = `${keyId}:${keySecret}`;
    if (
      this._gatewayClients.razorpay &&
      this._gatewayClientKeys.razorpay === fingerprint
    ) {
      return this._gatewayClients.razorpay;
    }

    // Cached by credential fingerprint so a key edited in the settings screen takes
    // effect without a restart.
    this._gatewayClients.razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    this._gatewayClientKeys.razorpay = fingerprint;
    return this._gatewayClients.razorpay;
  }

  /** The Stripe client for the resolved credentials, rebuilt if they change. */
  async getStripeClient() {
    const { keySecret } = await this.getGatewayCredentials('stripe');
    if (!keySecret) return null;

    if (this._gatewayClients.stripe && this._gatewayClientKeys.stripe === keySecret) {
      return this._gatewayClients.stripe;
    }

    this._gatewayClients.stripe = new Stripe(keySecret);
    this._gatewayClientKeys.stripe = keySecret;
    return this._gatewayClients.stripe;
  }

  /**
   * Generate unique payment number
   */
  generatePaymentNumber() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, "0");
    return `PAY${timestamp}${random}`;
  }

  /**
   * Calculate payment breakdown
   */
  calculatePaymentBreakdown(rental, paymentType, amount = null, options = {}) {
    const baseAmount = roundMoney(amount ?? rental?.rentalDetails?.totalAmount ?? 0);
    const paymentSettings = options.paymentSettings || null;

    const result = calculatePaymentFees({
      baseAmount,
      paymentType,
      tenureMonths: rental?.rentalDetails?.tenureMonths,
      categoryId: options.categoryId || null,
      rentalCount: options.vendorRentalCount,
      vendorCommission: options.vendor?.commission,
      settingsCommission: paymentSettings?.commission,
      monthCommissionBefore: options.monthCommissionBefore,
      yearCommissionBefore: options.yearCommissionBefore,
      tax: {
        // The database setting is authoritative. The env flag survives only as a
        // fallback for a deployment that has no settings document yet — before
        // this change the env flag was the only control and the admin UI's
        // taxEnabled/taxRate had no effect at all.
        enabled: paymentSettings
          ? paymentSettings.taxEnabled === true
          : process.env.ENABLE_TAX === "true",
        rate: paymentSettings?.taxRate ?? 18,
      },
      convenienceFee: {
        enabled: paymentSettings
          ? paymentSettings.convenienceFeeEnabled === true
          : process.env.ENABLE_CONVENIENCE_FEE === "true",
        rate: paymentSettings?.convenienceFeeRate ?? 2,
        cap: paymentSettings?.convenienceFeeCap ?? 100,
      },
      discount: { longTenureMonths: 6, longTenureRate: 5 },
    });

    // Same field names as before, plus the ones that were missing entirely.
    // commission / platformFee / taxableAmount / vendorNet are what the vendor
    // ledger and the payout engine read.
    return {
      rentalId: rental?._id,
      rentalNumber: rental?.rentalNumber,
      paymentType,
      baseAmount: result.baseAmount,
      discount: result.discount,
      taxableAmount: result.taxableAmount,
      commission: result.commission,
      commissionRate: result.commissionRate,
      commissionType: result.commissionType,
      commissionSource: result.commissionSource,
      platformFee: result.platformFee,
      platformFeeType: result.platformFeeType,
      tax: result.tax,
      taxRate: result.taxRate,
      convenienceFee: result.convenienceFee,
      total: result.total,
      vendorNet: result.vendorNet,
      platformNet: result.platformNet,
    };
  }

  /**
   * Create Razorpay order
   */
  async createRazorpayOrder(amount, currency = "INR", receipt = null) {
    try {
      const razorpay = await this.getRazorpayClient();
      if (!razorpay) {
        throw new AppError("Razorpay not configured", 500);
      }

      const options = {
        amount: Math.round(amount * 100), // Convert to paise
        currency,
        receipt: receipt || `receipt_${Date.now()}`,
        payment_capture: 1,
      };

      const order = await razorpay.orders.create(options);

      return {
        id: order.id,
        amount: order.amount / 100,
        currency: order.currency,
        receipt: order.receipt,
      };
    } catch (error) {
      logger.error("Error creating Razorpay order:", error);
      throw new AppError("Failed to create payment order", 500);
    }
  }

  /**
   * Verify Razorpay payment
   */
  async verifyRazorpayPayment(orderId, paymentId, signature) {
    try {
      // The secret has to be resolved (settings first) rather than read straight
      // from the env, or a key entered in the admin UI would still fail every
      // customer payment verification.
      const { keySecret } = await this.getGatewayCredentials("razorpay");
      if (!keySecret) {
        logger.warn("Razorpay key secret is not configured; cannot verify a payment");
        return false;
      }

      const body = orderId + "|" + paymentId;
      const expectedSignature = crypto
        .createHmac("sha256", keySecret)
        .update(body.toString())
        .digest("hex");

      // Constant-time compare: `===` on a signature leaks its prefix by timing.
      const expected = Buffer.from(expectedSignature, "utf8");
      const provided = Buffer.from(String(signature || ""), "utf8");
      if (expected.length !== provided.length) return false;
      return crypto.timingSafeEqual(expected, provided);
    } catch (error) {
      logger.error("Error verifying Razorpay payment:", error);
      return false;
    }
  }

  /**
   * Create Stripe payment intent
   */
  async createStripePaymentIntent(amount, currency = "inr", metadata = {}) {
    try {
      const stripe = await this.getStripeClient();
      if (!stripe) {
        throw new AppError("Stripe not configured", 500);
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents/paise
        currency,
        metadata,
        automatic_payment_methods: {
          enabled: true,
        },
      });

      return {
        clientSecret: paymentIntent.client_secret,
        id: paymentIntent.id,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency,
      };
    } catch (error) {
      logger.error("Error creating Stripe payment intent:", error);
      throw new AppError("Failed to create payment intent", 500);
    }
  }

  /**
   * Verify Stripe webhook signature
   */
  async verifyStripeWebhook(payload, signature) {
    // Kept for callers that want just the event. Reads the secret from the admin
    // settings (falling back to the env var) and requires the RAW body.
    const result = await this.verifyWebhookSignature("stripe", this.toRawBody(payload), signature);
    if (!result.valid) logger.warn(`Stripe webhook verification failed: ${result.reason}`);
    return result.valid ? result.event : null;
  }

  /**
   * Initiate payment
   */
  async initiatePayment(userId, paymentData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        rentalId,
        amount,
        paymentType,
        paymentMethod,
        gateway = "razorpay",
      } = paymentData;

      // Get rental details
      const rental = await Rental.findOne({
        _id: rentalId,
        user: userId,
      }).session(session);

      if (!rental) {
        throw new AppError("Rental not found", 404);
      }

      // Validate payment amount
      const validAmounts = this.validatePaymentAmount(
        rental,
        amount,
        paymentType,
      );
      if (!validAmounts.valid) {
        throw new AppError(validAmounts.message, 400);
      }

      // Load the platform fee policy and this vendor's commission config so the
      // breakdown reflects configured rates. The rental count feeds the settings
      // tier rules, so it is counted before the breakdown is built.
      const [settingsDoc, vendorDoc, vendorRentalCount] = await Promise.all([
        SystemSettings.getInstance(),
        Vendor.findById(rental.vendor).select("commission").lean(),
        Rental.countDocuments({ vendor: rental.vendor }),
      ]);

      // Calculate payment breakdown
      const breakdown = this.calculatePaymentBreakdown(
        rental,
        paymentType,
        amount,
        {
          paymentSettings: settingsDoc?.payment || null,
          vendor: vendorDoc,
          vendorRentalCount,
          categoryId: paymentData.categoryId || null,
        },
      );

      // Create payment record
      const paymentNumber = this.generatePaymentNumber();
      const payment = await Payment.create(
        [
          {
            paymentNumber,
            user: userId,
            rental: rentalId,
            vendor: rental.vendor,
            amount: breakdown.total,
            type: paymentType,
            method: paymentMethod,
            status: "pending",
            paymentDetails: {
              gateway,
              breakdown,
            },
            metadata: {
              createdBy: userId,
              ipAddress: paymentData.ipAddress,
              userAgent: paymentData.userAgent,
            },
          },
        ],
        { session },
      );

      // Create gateway order
      let gatewayOrder = null;
      if (gateway === "razorpay") {
        gatewayOrder = await this.createRazorpayOrder(
          breakdown.total,
          "INR",
          payment[0].paymentNumber,
        );
      } else if (gateway === "stripe") {
        gatewayOrder = await this.createStripePaymentIntent(
          breakdown.total,
          "inr",
          { paymentId: payment[0]._id.toString() },
        );
      }

      await session.commitTransaction();

      return {
        payment: payment[0],
        gatewayOrder,
        breakdown,
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error in initiatePayment:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }


  async verifyPayment(paymentId, verificationData) {
    // NOTE: this method used to console.log the whole verificationData payload,
    // which includes the gateway signature. Anything that can log a signature can
    // log a replayable credential, so the request body is no longer printed.

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      throw new AppError("Payment not found", 404);
    }

    // Idempotent: a customer whose browser retried the success callback must not
    // be failed, and must not be charged twice.
    if (payment.status === "success") {
      return payment;
    }
    if (payment.status !== "pending") {
      throw new AppError(
        `Payment cannot be verified from status "${payment.status}"`,
        400,
      );
    }

    const {
      gateway,
      orderId,
      paymentId: gatewayPaymentId,
      signature,
      paymentIntentId,
    } = verificationData;

    // Verify based on gateway
    let isValid = false;
    if (gateway === "razorpay") {
      isValid = await this.verifyRazorpayPayment(orderId, gatewayPaymentId, signature);
    } else if (gateway === "stripe") {
      const stripe = paymentIntentId ? await this.getStripeClient() : null;
      if (!stripe) {
        isValid = false;
      } else {
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
        const expectedId = payment._id.toString();
        isValid =
          intent.status === "succeeded" &&
          intent.metadata?.paymentId === expectedId;
      }
    }

    if (!isValid) {
      payment.status = "failed";
      payment.timestamps.failed = new Date();
      await payment.save();
      logger.warn(`Payment ${payment.paymentNumber} failed signature verification`);
      // Persisted before throwing so the attempt is durable and a retry is a fresh
      // attempt rather than a silent no-op.
      throw new AppError("Payment verification failed", 400);
    }

    // ATOMIC CLAIM — pending -> processing.
    //
    // The previous guard was a read inside the transaction, which two concurrent
    // verifications could both pass; the rental's paidAmount would then be
    // incremented twice for a single payment. This conditional update makes
    // exactly one caller the owner and the loser backs off. It is also what keeps
    // a client verification and a gateway capture webhook from both applying the
    // same payment.
    const claimed = await Payment.findOneAndUpdate(
      { _id: payment._id, status: "pending" },
      { $set: { status: "processing", "timestamps.processed": new Date() } },
      { new: true },
    );

    if (!claimed) {
      const current = await Payment.findById(payment._id).lean();
      if (current?.status === "success") return current;
      throw new AppError(
        "This payment is already being processed. Please refresh.",
        409,
      );
    }

    return this.applySuccessfulPayment(claimed, {
      gatewayPaymentId: gateway === "stripe" ? paymentIntentId : gatewayPaymentId,
      gatewayOrderId: orderId,
      via: "client",
    });
  }

  /**
   * Apply a confirmed payment: mark it successful, move the rental's paid and due
   * amounts, update the vendor counters and write the settlement ledger.
   *
   * This is the ONLY implementation of "a payment succeeded". The client
   * verification path and the gateway capture webhook both finish here, so the two
   * cannot drift apart — previously the webhook handlers were empty stubs, which
   * meant a payment captured without a browser return was never applied at all.
   *
   * The caller is expected to have claimed the payment (pending -> processing).
   * The function is itself idempotent, so a replay is a no-op rather than a double
   * credit.
   */
  async applySuccessfulPayment(payment, options = {}) {
    const { gatewayPaymentId = null, gatewayOrderId = null, via = "unknown" } = options;

    const existing = await Payment.findById(payment._id).select("status").lean();
    if (!existing) {
      throw new AppError("Payment not found", 404);
    }
    if (existing.status === "success") {
      logger.info(
        `Payment ${payment.paymentNumber} was already applied (via ${via}); nothing to do`,
      );
      return Payment.findById(payment._id);
    }

    // Resolved BEFORE the transaction opens. This reads the settings collection, and
    // a read that is not part of the session has no business running while the
    // payment and rental documents are locked.
    const gatewayMode = await this.resolvePaymentGatewayMode(payment);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Update payment status
      payment.status = "success";
      if (gatewayMode) {
        // Which environment this money actually came from, so a later LIVE payout
        // can refuse to send real money against earnings that were only ever test.
        // The ledger cannot tell the difference on its own.
        payment.paymentDetails.gatewayMode = gatewayMode;
      }
      // Whatever identifies the charge at the gateway. Supplied by the caller, so
      // this works for both the client path (holds the payment id) and the webhook
      // path (holds the captured entity id).
      if (gatewayPaymentId) {
        payment.paymentDetails.transactionId = gatewayPaymentId;
      }
      if (gatewayOrderId) {
        payment.paymentDetails.razorpayOrderId =
          payment.paymentDetails.razorpayOrderId || gatewayOrderId;
      }
      payment.timestamps.completed = new Date();
      await payment.save({ session });

      // ─── FIX: Update rental payment status correctly ───
      const rental = await Rental.findById(payment.rental).session(session);

      if (!rental) {
        throw new AppError("Rental not found", 404);
      }

      const prod = await Product.findById(rental.product).session(session);
      if (!prod) {
        throw new AppError("Product not found", 404);
      }

      prod.inventory.rentedQuantity += 1;
      await prod.save({ session });

      // Calculate new paid amount
      const previousPaidAmount = rental.payment?.paidAmount || 0;
      const newPaidAmount = previousPaidAmount + payment.amount;
      const totalAmount = rental.rentalDetails?.totalAmount || 0;

      // Calculate due amount correctly (this was missing!)
      const newDueAmount = Math.max(0, totalAmount - newPaidAmount);

      // Determine payment status
      let paymentStatus = "partial";
      if (newDueAmount <= 0) {
        paymentStatus = "completed";
      } else if (newPaidAmount <= 0) {
        paymentStatus = "pending";
      }

      // Update rental payment object with all fields
      rental.payment = {
        ...rental.payment,
        status: paymentStatus,
        paidAmount: newPaidAmount,
        dueAmount: newDueAmount, // ← CRITICAL: Update due amount
        paymentHistory: [
          ...(rental.payment?.paymentHistory || []),
          payment._id,
        ],
      };

      // Update next due date
      if (payment.type === "rent") {
        // Calculate months paid based on monthly rent
        const monthlyRent = rental.rentalDetails?.monthlyRent || 0;
        const monthsPaid = Math.floor(newPaidAmount / monthlyRent);

        const nextDueDate = new Date(
          rental.rentalDetails?.startDate || rental.createdAt,
        );
        nextDueDate.setMonth(nextDueDate.getMonth() + monthsPaid + 1);
        rental.payment.nextDueDate = nextDueDate;
      }

      // Update rental status if payment is complete.
      // IMPORTANT: A 'pending' rental must NOT be activated by payment alone —
      // the vendor has to confirm it first (see confirmRental). Only rentals that
      // are already past that gate (confirmed / active / overdue) get activated,
      // which also keeps monthly-payment recovery for active/overdue rentals intact.
      if (paymentStatus === "completed" && rental.status !== "pending") {
        rental.status = "active"; // e.g. 'confirmed'/'overdue' → 'active'

        // Add to timeline if not already there
        const hasActiveTimeline = rental.timeline?.some(
          (t) => t.status === "active",
        );
        if (!hasActiveTimeline) {
          rental.timeline = rental.timeline || [];
          rental.timeline.push({
            status: "active",
            timestamp: new Date(),
            note: "Payment completed, rental activated",
            updatedBy: payment.user,
          });
        }
      }

      await rental.save({ session });

      // Update vendor payment info.
      // `rental.vendor` holds the VENDOR DOCUMENT id (Product.vendor is written as
      // vendor._id, and Rental.vendor copies it), so this must match on _id. The
      // previous `{ user: rental.vendor }` compared a Vendor id against the User
      // field, matched nothing, and silently left these counters at zero forever.
      await Vendor.findOneAndUpdate(
        { _id: rental.vendor },
        {
          $inc: {
            "payments.pending": -payment.amount,
            "payments.paid": payment.amount,
          },
        },
        { session },
      );

      // Record what the platform owes this vendor and what was deducted. This is
      // the only place a payment becomes real, so without it the vendor has no
      // payable balance and the payout engine has nothing to settle. Skipped when
      // the payment predates the fee engine and carries no breakdown.
      const storedBreakdown = payment.paymentDetails?.breakdown;
      if (storedBreakdown) {
        await settlement.recordPaymentEntries({
          payment,
          rental,
          breakdown: storedBreakdown,
          session,
        });
      } else {
        logger.warn(
          `Payment ${payment.paymentNumber} has no fee breakdown, so no ledger entries were recorded`,
        );
      }

      await session.commitTransaction();

      logger.info("Payment verified successfully", {
        paymentId: String(payment._id),
        rentalId: String(rental._id),
        paidAmount: newPaidAmount,
        dueAmount: newDueAmount,
        status: paymentStatus,
      });

      // Emitted AFTER the commit so a listener can never observe an uncommitted
      // payment, and wrapped so a failing listener cannot fail the payment itself.
      try {
        eventEmitter.emit(EVENTS.PAYMENT.SUCCESS, {
          // Both keys are deliberate: the socket handler in events/index.js reads
          // `paymentId`, while the invoice job in the same file reads `_id`.
          // Emitting only one would silently break the other.
          _id: payment._id,
          paymentId: payment._id,
          paymentNumber: payment.paymentNumber,
          userId: payment.user,
          vendorId: payment.vendor,
          rentalId: rental._id,
          amount: payment.amount,
          type: payment.type,
        });
      } catch (eventError) {
        logger.error("Failed to emit PAYMENT.SUCCESS", eventError);
      }

      return payment;
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error in verifyPayment:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Validate payment amount
   */
  validatePaymentAmount(rental, amount, paymentType) {
    const dueAmount =
      rental.rentalDetails.totalAmount - rental.payment.paidAmount;

    switch (paymentType) {
      case "security_deposit":
        if (amount !== rental.rentalDetails.securityDeposit) {
          return { valid: false, message: "Invalid security deposit amount" };
        }
        break;

      case "rent":
        const expectedRent = rental.rentalDetails.monthlyRent;
        if (amount < expectedRent || amount > dueAmount) {
          return { valid: false, message: "Invalid rent amount" };
        }
        break;

      case "delivery":
        if (amount !== rental.rentalDetails.deliveryCharges) {
          return { valid: false, message: "Invalid delivery charges amount" };
        }
        break;

      case "full":
        if (amount !== dueAmount) {
          return { valid: false, message: "Invalid full payment amount" };
        }
        break;

      default:
        if (amount > dueAmount) {
          return { valid: false, message: "Payment amount exceeds due amount" };
        }
    }

    return { valid: true };
  }

  /**
   * Get payment by ID
   */
  async getPayment(paymentId, userId, userRole = "user") {
    try {
      const cacheKey = `payment:${paymentId}`;

      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const payment = await Payment.findById(paymentId)
        .populate("user", "profile.firstName profile.lastName email phone")
        .populate("vendor", "business.name")
        .populate({
          path: "rental",
          select: "rentalNumber rentalDetails payment.status",
        })
        .lean();

      if (!payment) {
        throw new AppError("Payment not found", 404);
      }

      // Check authorization
      if (
        userRole === "user" &&
        payment.user._id.toString() !== userId.toString()
      ) {
        throw new AppError("Unauthorized to view this payment", 403);
      }

      if (
        userRole === "vendor" &&
        payment.vendor._id.toString() !== userId.toString()
      ) {
        throw new AppError("Unauthorized to view this payment", 403);
      }

      // Cache the result
      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, 300, JSON.stringify(payment));
      }

      return payment;
    } catch (error) {
      logger.error("Error in getPayment:", error);
      throw error;
    }
  }

  /**
   * Get user payments
   */
  async getUserPayments(userId, page = 1, limit = 10, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = { user: userId };

      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.type) {
        query.type = filters.type;
      }

      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate)
          query.createdAt.$gte = new Date(filters.startDate);
        if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
      }

      const [payments, total] = await Promise.all([
        Payment.find(query)
          .populate("rental", "rentalNumber")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Payment.countDocuments(query),
      ]);

      // Get summary statistics
      const summary = await Payment.aggregate([
        { $match: { user: userId, status: "success" } },
        {
          $group: {
            _id: null,
            totalSpent: { $sum: "$amount" },
            totalPayments: { $sum: 1 },
            averageAmount: { $avg: "$amount" },
            byType: {
              $push: {
                type: "$type",
                amount: "$amount",
              },
            },
          },
        },
      ]);

      const byType = {};
      if (summary[0]?.byType) {
        summary[0].byType.forEach((item) => {
          byType[item.type] = (byType[item.type] || 0) + item.amount;
        });
      }

      return {
        payments,
        summary: {
          totalSpent: summary[0]?.totalSpent || 0,
          totalPayments: summary[0]?.totalPayments || 0,
          averageAmount: summary[0]?.averageAmount || 0,
          byType,
        },
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Error in getUserPayments:", error);
      throw error;
    }
  }

  /**
   * Get vendor payments
   */
  async getVendorPayments(vendorId, page = 1, limit = 10, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = { vendor: vendorId };

      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate)
          query.createdAt.$gte = new Date(filters.startDate);
        if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
      }

      const [payments, total] = await Promise.all([
        Payment.find(query)
          .populate("user", "profile.firstName profile.lastName email")
          .populate("rental", "rentalNumber")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Payment.countDocuments(query),
      ]);

      // Calculate totals
      const totals = await Payment.aggregate([
        { $match: { vendor: vendorId, status: "success" } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$amount" },
            totalPayments: { $sum: 1 },
            pendingPayout: {
              $sum: {
                $cond: [{ $eq: ["$payoutStatus", "pending"] }, "$amount", 0],
              },
            },
          },
        },
      ]);

      return {
        payments,
        totals: totals[0] || {
          totalRevenue: 0,
          totalPayments: 0,
          pendingPayout: 0,
        },
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Error in getVendorPayments:", error);
      throw error;
    }
  }

  /**
   * List every payment in the platform (admin view).
   *
   * Replaces the previous approach where the controller called
   * `getVendorPayments(null, ...)`, which built the query `{ vendor: null }` and
   * therefore returned only payments with NO vendor instead of all of them.
   *
   * @returns {{ payments: Array, totals: object, pagination: object }}
   */
  async getAllPayments(page = 1, limit = 10, filters = {}) {
    try {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
      const skip = (pageNum - 1) * limitNum;

      const query = {};

      if (filters.status) query.status = filters.status;
      if (filters.method) query.method = filters.method;
      if (filters.type) query.type = filters.type;
      if (filters.gateway) query['paymentDetails.gateway'] = filters.gateway;

      // ObjectId filters are validated rather than passed straight through: an
      // invalid id in a `find` silently matches nothing, which would look like
      // "no results" instead of a bad request.
      if (filters.vendor) {
        if (!mongoose.Types.ObjectId.isValid(filters.vendor)) {
          throw new AppError('Invalid vendor id', 400);
        }
        query.vendor = filters.vendor;
      }
      if (filters.user) {
        if (!mongoose.Types.ObjectId.isValid(filters.user)) {
          throw new AppError('Invalid user id', 400);
        }
        query.user = filters.user;
      }
      if (filters.rental) {
        if (!mongoose.Types.ObjectId.isValid(filters.rental)) {
          throw new AppError('Invalid rental id', 400);
        }
        query.rental = filters.rental;
      }

      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
        if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
      }

      if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
        query.amount = {};
        if (filters.minAmount !== undefined) query.amount.$gte = Number(filters.minAmount);
        if (filters.maxAmount !== undefined) query.amount.$lte = Number(filters.maxAmount);
      }

      // "refunded" on the payments screen means "has any refund recorded", which
      // covers a partial refund that left the payment in `success`.
      if (filters.refunded === true || filters.refunded === 'true') {
        query.$or = [
          { status: 'refunded' },
          { refundDetails: { $ne: null, $exists: true } },
          { 'refundDetails.amount': { $gt: 0 } },
        ];
      }

      if (filters.search) {
        // Escape the term so user input cannot inject regex operators.
        const term = String(filters.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (term) {
          const rx = new RegExp(term, 'i');
          query.$and = [
            ...(query.$and || []),
            {
              $or: [
                { paymentNumber: rx },
                { 'paymentDetails.transactionId': rx },
                { 'paymentDetails.razorpayPaymentId': rx },
                { 'paymentDetails.razorpayOrderId': rx },
                { 'paymentDetails.referenceNumber': rx },
              ],
            },
          ];
        }
      }

      const [payments, total] = await Promise.all([
        Payment.find(query)
          .populate('user', 'profile.firstName profile.lastName email phone')
          .populate('rental', 'rentalNumber startDate endDate')
          .populate('vendor', 'business.name vendorId')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        Payment.countDocuments(query),
      ]);

      // Status buckets for the KPI row, computed over the SAME filter set so the
      // cards always agree with the table below them.
      const statusGroups = await Payment.aggregate([
        { $match: query },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            amount: { $sum: '$amount' },
          },
        },
      ]);

      const byStatus = statusGroups.reduce((acc, row) => {
        acc[row._id] = { count: row.count, amount: roundMoney(row.amount) };
        return acc;
      }, {});

      const sumFor = (statuses) =>
        statuses.reduce(
          (acc, status) => ({
            count: acc.count + (byStatus[status]?.count || 0),
            amount: roundMoney(acc.amount + (byStatus[status]?.amount || 0)),
          }),
          { count: 0, amount: 0 },
        );

      const successful = sumFor(['success']);
      const refundedBucket = sumFor(['refunded', 'cancelled']);

      return {
        payments,
        totals: {
          totalCollected: successful.amount,
          successfulPayments: successful.count,
          pending: sumFor(['pending', 'processing']),
          failed: sumFor(['failed']),
          refunded: refundedBucket,
          averageTicket: successful.count > 0 ? roundMoney(successful.amount / successful.count) : 0,
          grandTotal: roundMoney(statusGroups.reduce((sum, row) => sum + row.amount, 0)),
          byStatus,
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.max(1, Math.ceil(total / limitNum)),
        },
      };
    } catch (error) {
      logger.error('Error in getAllPayments:', error);
      throw error;
    }
  }

  /**
   * List payments that carry a refund (full or partial).
   */
  async getRefunds(page = 1, limit = 10, filters = {}) {
    try {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
      const skip = (pageNum - 1) * limitNum;

      const query = {
        $or: [
          { status: 'refunded' },
          { 'refundDetails.amount': { $gt: 0 } },
        ],
      };

      if (filters.vendor) {
        if (!mongoose.Types.ObjectId.isValid(filters.vendor)) {
          throw new AppError('Invalid vendor id', 400);
        }
        query.vendor = filters.vendor;
      }

      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
        if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
      }

      if (filters.search) {
        const term = String(filters.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (term) {
          const rx = new RegExp(term, 'i');
          query.$and = [{ $or: [{ paymentNumber: rx }, { 'refundDetails.transactionId': rx }] }];
        }
      }

      const [refunds, total] = await Promise.all([
        Payment.find(query)
          .populate('user', 'profile.firstName profile.lastName email phone')
          .populate('rental', 'rentalNumber')
          .populate('vendor', 'business.name vendorId')
          .sort({ 'refundDetails.processedAt': -1, updatedAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        Payment.countDocuments(query),
      ]);

      // Refund metrics come from the payments themselves, so a partial refund is
      // counted at its real value instead of assuming the full amount went back.
      const metrics = await Payment.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            refundedAmount: {
              $sum: {
                $cond: [
                  { $gt: [{ $ifNull: ['$refundDetails.amount', 0] }, 0] },
                  '$refundDetails.amount',
                  { $cond: [{ $eq: ['$status', 'refunded'] }, '$amount', 0] },
                ],
              },
            },
            originalAmount: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]);

      const totals = metrics[0] || { refundedAmount: 0, originalAmount: 0, count: 0 };
      const platformRefunded = await Payment.aggregate([
        { $match: { status: 'success' } },
        { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]);
      const platformTotal = platformRefunded[0] || { amount: 0, count: 0 };

      return {
        refunds,
        totals: {
          refundedAmount: roundMoney(totals.refundedAmount),
          originalAmount: roundMoney(totals.originalAmount),
          refundCount: totals.count,
          // Refund rate is measured against everything ever successfully charged,
          // which is the number a finance reviewer actually cares about.
          refundRate:
            platformTotal.amount > 0
              ? roundMoney((totals.refundedAmount / platformTotal.amount) * 100)
              : 0,
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.max(1, Math.ceil(total / limitNum)),
        },
      };
    } catch (error) {
      logger.error('Error in getRefunds:', error);
      throw error;
    }
  }

  /**
   * Tax / commission / platform-fee summary for a period.
   *
   * Reads the stored fee breakdown so the reported tax is what was ACTUALLY
   * charged at the time. Payments created before the fee engine existed have no
   * breakdown; those are counted separately (`paymentsWithoutBreakdown`) rather
   * than being silently treated as zero-tax, which would understate the filing.
   */
  async getTaxSummary(startDate, endDate) {
    try {
      const match = { status: { $in: ['success', 'refunded'] } };
      if (startDate || endDate) {
        match.createdAt = {};
        if (startDate) match.createdAt.$gte = new Date(startDate);
        if (endDate) match.createdAt.$lte = new Date(endDate);
      }

      const [summaryRows, monthlyRows] = await Promise.all([
        Payment.aggregate([
          { $match: match },
          {
            $group: {
              _id: null,
              taxableBase: { $sum: { $ifNull: ['$paymentDetails.breakdown.taxableAmount', 0] } },
              tax: { $sum: { $ifNull: ['$paymentDetails.breakdown.tax', 0] } },
              commission: { $sum: { $ifNull: ['$paymentDetails.breakdown.commission', 0] } },
              platformFee: { $sum: { $ifNull: ['$paymentDetails.breakdown.platformFee', 0] } },
              convenienceFee: { $sum: { $ifNull: ['$paymentDetails.breakdown.convenienceFee', 0] } },
              discount: { $sum: { $ifNull: ['$paymentDetails.breakdown.discount', 0] } },
              grossCollected: { $sum: '$amount' },
              transactions: { $sum: 1 },
              paymentsWithBreakdown: {
                $sum: { $cond: [{ $ifNull: ['$paymentDetails.breakdown', false] }, 1, 0] },
              },
            },
          },
        ]),
        Payment.aggregate([
          { $match: match },
          {
            $group: {
              _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
              taxableBase: { $sum: { $ifNull: ['$paymentDetails.breakdown.taxableAmount', 0] } },
              tax: { $sum: { $ifNull: ['$paymentDetails.breakdown.tax', 0] } },
              commission: { $sum: { $ifNull: ['$paymentDetails.breakdown.commission', 0] } },
              platformFee: { $sum: { $ifNull: ['$paymentDetails.breakdown.platformFee', 0] } },
              grossCollected: { $sum: '$amount' },
              transactions: { $sum: 1 },
            },
          },
          { $sort: { '_id.year': 1, '_id.month': 1 } },
        ]),
      ]);

      const row = summaryRows[0] || {};
      const transactions = row.transactions || 0;
      const withBreakdown = row.paymentsWithBreakdown || 0;

      return {
        summary: {
          taxableBase: roundMoney(row.taxableBase),
          tax: roundMoney(row.tax),
          commission: roundMoney(row.commission),
          platformFee: roundMoney(row.platformFee),
          convenienceFee: roundMoney(row.convenienceFee),
          discount: roundMoney(row.discount),
          grossCollected: roundMoney(row.grossCollected),
          transactions,
          // Honesty flags: the UI must be able to say "this period includes
          // legacy payments with no recorded tax" instead of implying accuracy.
          paymentsWithBreakdown: withBreakdown,
          paymentsWithoutBreakdown: transactions - withBreakdown,
          effectiveTaxRate:
            row.taxableBase > 0 ? roundMoney((row.tax / row.taxableBase) * 100) : 0,
        },
        monthly: monthlyRows.map((month) => ({
          year: month._id.year,
          month: month._id.month,
          label: `${month._id.year}-${String(month._id.month).padStart(2, '0')}`,
          taxableBase: roundMoney(month.taxableBase),
          tax: roundMoney(month.tax),
          commission: roundMoney(month.commission),
          platformFee: roundMoney(month.platformFee),
          grossCollected: roundMoney(month.grossCollected),
          transactions: month.transactions,
        })),
      };
    } catch (error) {
      logger.error('Error in getTaxSummary:', error);
      throw error;
    }
  }

  /**
   * Process refund
   */
  async processRefund(paymentId, adminId, refundData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { amount, reason } = refundData;

      const payment = await Payment.findById(paymentId).session(session);

      if (!payment) {
        throw new AppError("Payment not found", 404);
      }

      if (payment.status !== "success") {
        throw new AppError("Cannot refund unsuccessful payment", 400);
      }

      if (payment.type === "refund") {
        throw new AppError("Payment already refunded", 400);
      }

      const refundAmount = amount || payment.amount;

      // Process refund based on gateway. Clients are resolved rather than read off
      // `this`, so credentials edited in the settings screen are honoured.
      const refundGateway = payment.paymentDetails.gateway;
      const razorpayClient =
        refundGateway === "razorpay" ? await this.getRazorpayClient() : null;
      const stripeClient = refundGateway === "stripe" ? await this.getStripeClient() : null;

      if (refundGateway === "razorpay" && razorpayClient) {
        try {
          const refund = await razorpayClient.payments.refund(
            payment.paymentDetails.transactionId,
            {
              amount: Math.round(refundAmount * 100),
              notes: { reason },
            },
          );

          payment.refundDetails = {
            amount: refundAmount,
            reason,
            transactionId: refund.id,
            processedBy: adminId,
            processedAt: new Date(),
          };
        } catch (error) {
          throw new AppError("Refund failed at gateway", 500);
        }
      } else if (refundGateway === "stripe" && stripeClient) {
        try {
          const refund = await stripeClient.refunds.create({
            payment_intent: payment.paymentDetails.transactionId,
            amount: Math.round(refundAmount * 100),
          });

          payment.refundDetails = {
            amount: refundAmount,
            reason,
            transactionId: refund.id,
            processedBy: adminId,
            processedAt: new Date(),
          };
        } catch (error) {
          throw new AppError("Refund failed at gateway", 500);
        }
      }

      payment.status = "refunded";
      payment.timestamps.refunded = new Date();
      await payment.save({ session });

      // Update rental payment status
      const rental = await Rental.findById(payment.rental).session(session);
      rental.payment.paidAmount -= refundAmount;
      rental.payment.refundAmount =
        (rental.payment.refundAmount || 0) + refundAmount;

      if (rental.payment.paidAmount <= 0) {
        rental.payment.status = "pending";
      }

      await rental.save({ session });

      await session.commitTransaction();

      // Emit event
      eventEmitter.emit(EVENTS.PAYMENT.REFUNDED, {
        paymentId: payment._id,
        paymentNumber: payment.paymentNumber,
        userId: payment.user,
        amount: refundAmount,
        reason,
      });

      return payment;
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error in processRefund:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get payment statistics
   */
  async getPaymentStats(userId, role = "user", period = "month") {
    try {
      const match = role === "user" ? { user: userId } : { vendor: userId };
      match.status = "success";

      const dateFilter = {};
      if (period === "month") {
        dateFilter.createdAt = {
          $gte: new Date(new Date().setDate(1)),
          $lte: new Date(),
        };
      } else if (period === "quarter") {
        // The caller offers a "Quarter" option but there was no branch for it, so
        // `dateFilter` stayed empty and "quarter" silently meant "all time".
        // Three months back is what the label promises.
        const quarterStart = new Date();
        quarterStart.setHours(0, 0, 0, 0);
        quarterStart.setMonth(quarterStart.getMonth() - 3);
        dateFilter.createdAt = { $gte: quarterStart, $lte: new Date() };
      } else if (period === "year") {
        dateFilter.createdAt = {
          $gte: new Date(new Date().getFullYear(), 0, 1),
          $lte: new Date(),
        };
      }

      const stats = await Payment.aggregate([
        { $match: { ...match, ...dateFilter } },
        {
          $facet: {
            overview: [
              {
                $group: {
                  _id: null,
                  totalAmount: { $sum: "$amount" },
                  totalCount: { $sum: 1 },
                  averageAmount: { $avg: "$amount" },
                  minAmount: { $min: "$amount" },
                  maxAmount: { $max: "$amount" },
                },
              },
            ],
            byType: [
              {
                $group: {
                  _id: "$type",
                  count: { $sum: 1 },
                  amount: { $sum: "$amount" },
                },
              },
            ],
            byMethod: [
              {
                $group: {
                  _id: "$method",
                  count: { $sum: 1 },
                  amount: { $sum: "$amount" },
                },
              },
            ],
            dailyTrend: [
              {
                $group: {
                  _id: {
                    year: { $year: "$createdAt" },
                    month: { $month: "$createdAt" },
                    day: { $dayOfMonth: "$createdAt" },
                  },
                  count: { $sum: 1 },
                  amount: { $sum: "$amount" },
                },
              },
              { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
            ],
          },
        },
      ]);

      // `period` narrows the aggregation above, but the overview cards ALSO show
      // this month vs last month and what is still owed in pending payouts. None of
      // that was ever computed — the client hardcoded `growth: 12.5` and zeros — so
      // compute it here over its own window rather than reusing the filtered facets.
      const now = new Date();
      const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

      const baseMatch = role === "user" ? { user: userId } : { vendor: userId };
      baseMatch.status = "success";

      const monthly = await Payment.aggregate([
        {
          $match: {
            ...baseMatch,
            createdAt: { $gte: startOfLastMonth, $lte: now },
          },
        },
        {
          $group: {
            _id: { $cond: [{ $gte: ["$createdAt", startOfThisMonth] }, "this", "last"] },
            amount: { $sum: "$amount" },
          },
        },
      ]);

      const amountFor = (key) =>
        Number(monthly.find((row) => row._id === key)?.amount || 0);
      const thisMonthRevenue = amountFor("this");
      const lastMonthRevenue = amountFor("last");
      // null (not 0, and definitely not a made-up number) when there is no previous
      // month to compare against — the UI renders that as "no comparison yet".
      const growth =
        lastMonthRevenue > 0
          ? Number(
              (((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100).toFixed(1)
            )
          : null;

      // Money earned but not yet transferred to this vendor.
      let pendingPayout = 0;
      if (role === "vendor") {
        const Payout = require("../models/Payout.model");
        const pending = await Payout.aggregate([
          {
            $match: {
              vendor: userId,
              status: { $in: ["pending", "processing"] },
            },
          },
          { $group: { _id: null, amount: { $sum: "$amount" } } },
        ]);
        pendingPayout = Number(pending?.[0]?.amount || 0);
      }

      // Real success rate. The overview card displayed a hardcoded "98.5%" that had
      // nothing to do with the account's payments.
      const statusCounts = await Payment.aggregate([
        { $match: role === "user" ? { user: userId } : { vendor: userId } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]);
      const allPayments = statusCounts.reduce((sum, row) => sum + row.count, 0);
      const succeeded = statusCounts.find((row) => row._id === "success")?.count || 0;
      const successRate =
        allPayments > 0
          ? Number(((succeeded / allPayments) * 100).toFixed(1))
          : null;

      const result =
        stats[0] || {
          overview: [{ totalAmount: 0, totalCount: 0, averageAmount: 0 }],
          byType: [],
          byMethod: [],
          dailyTrend: [],
        };

      return {
        ...result,
        thisMonthRevenue,
        lastMonthRevenue,
        growth,
        pendingPayout,
        successRate,
      };
    } catch (error) {
      logger.error("Error in getPaymentStats:", error);
      throw error;
    }
  }

  /**
   * Generate payment receipt
   */
  async generateReceipt(paymentId) {
    try {
      const payment = await Payment.findById(paymentId)
        .populate("user", "profile.firstName profile.lastName email phone")
        .populate("vendor", "business.name business.gstin")
        .populate({
          path: "rental",
          populate: {
            path: "product",
            select: "basicInfo.name",
          },
        })
        .lean();

      if (!payment) {
        throw new AppError("Payment not found", 404);
      }

      const receipt = {
        receiptNumber: `RCT-${payment.paymentNumber}`,
        date: payment.createdAt,
        payment: {
          number: payment.paymentNumber,
          type: payment.type,
          method: payment.method,
          status: payment.status,
          transactionId: payment.paymentDetails?.transactionId,
        },
        customer: {
          name: `${payment.user.profile.firstName} ${payment.user.profile.lastName}`,
          email: payment.user.email,
          phone: payment.user.phone,
        },
        vendor: {
          name: payment.vendor.business.name,
          gstin: payment.vendor.business.gstin,
        },
        rental: {
          number: payment.rental.rentalNumber,
          product: payment.rental.product.basicInfo.name,
        },
        breakdown: payment.paymentDetails?.breakdown || {
          baseAmount: payment.amount,
          tax: 0,
          convenienceFee: 0,
          discount: 0,
          total: payment.amount,
        },
        amount: payment.amount,
        amountInWords: this.numberToWords(payment.amount),
      };

      return receipt;
    } catch (error) {
      logger.error("Error in generateReceipt:", error);
      throw error;
    }
  }

  /**
   * Convert number to words (for receipts)
   */
  numberToWords(num) {
    const ones = [
      "",
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
      "Six",
      "Seven",
      "Eight",
      "Nine",
      "Ten",
      "Eleven",
      "Twelve",
      "Thirteen",
      "Fourteen",
      "Fifteen",
      "Sixteen",
      "Seventeen",
      "Eighteen",
      "Nineteen",
    ];
    const tens = [
      "",
      "",
      "Twenty",
      "Thirty",
      "Forty",
      "Fifty",
      "Sixty",
      "Seventy",
      "Eighty",
      "Ninety",
    ];

    const numToWords = (n) => {
      if (n < 20) return ones[n];
      if (n < 100)
        return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
      if (n < 1000)
        return (
          ones[Math.floor(n / 100)] +
          " Hundred" +
          (n % 100 ? " " + numToWords(n % 100) : "")
        );
      if (n < 100000)
        return (
          numToWords(Math.floor(n / 1000)) +
          " Thousand" +
          (n % 1000 ? " " + numToWords(n % 1000) : "")
        );
      if (n < 10000000)
        return (
          numToWords(Math.floor(n / 100000)) +
          " Lakh" +
          (n % 100000 ? " " + numToWords(n % 100000) : "")
        );
      return (
        numToWords(Math.floor(n / 10000000)) +
        " Crore" +
        (n % 10000000 ? " " + numToWords(n % 10000000) : "")
      );
    };

    const rupees = Math.floor(num);
    const paise = Math.round((num - rupees) * 100);

    let words = numToWords(rupees) + " Rupees";
    if (paise > 0) {
      words += " and " + numToWords(paise) + " Paise";
    }
    words += " Only";

    return words;
  }

  /**
   * Process automatic monthly payments
   */
  async processMonthlyPayments() {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const activeRentals = await Rental.find({
        status: "active",
        "payment.nextDueDate": { $lte: new Date() },
        "payment.status": { $ne: "completed" },
      }).session(session);

      const results = {
        processed: 0,
        failed: 0,
        skipped: 0,
      };

      for (const rental of activeRentals) {
        try {
          // Check if user has default payment method
          const user = await User.findById(rental.user).session(session);

          if (!user.paymentMethods?.default) {
            // Send reminder to add payment method
            await addJob("notification", "create", {
              userId: rental.user,
              type: "in_app",
              title: "Payment Method Required",
              content: `Please add a payment method for automatic rent deduction.`,
              data: { rentalId: rental._id },
            });
            results.skipped++;
            continue;
          }

          // Create payment
          const paymentNumber = this.generatePaymentNumber();
          const payment = await Payment.create(
            [
              {
                paymentNumber,
                user: rental.user,
                rental: rental._id,
                vendor: rental.vendor,
                amount: rental.rentalDetails.monthlyRent,
                type: "rent",
                method: "auto_debit",
                status: "processing",
                metadata: {
                  autoGenerated: true,
                  dueDate: rental.payment.nextDueDate,
                },
              },
            ],
            { session },
          );

          // Process payment (simplified - would integrate with payment gateway)
          payment.status = "success";
          payment.timestamps.completed = new Date();
          await payment.save({ session });

          // Update rental
          rental.payment.paidAmount += payment.amount;
          rental.payment.paymentHistory.push(payment._id);

          // Set next due date
          const nextDueDate = new Date(rental.payment.nextDueDate);
          nextDueDate.setMonth(nextDueDate.getMonth() + 1);
          rental.payment.nextDueDate = nextDueDate;

          await rental.save({ session });

          results.processed++;
        } catch (error) {
          logger.error(
            `Failed to process monthly payment for rental ${rental._id}:`,
            error,
          );
          results.failed++;
        }
      }

      await session.commitTransaction();

      logger.info(
        `Monthly payments processed: ${results.processed} successful, ${results.failed} failed, ${results.skipped} skipped`,
      );

      return results;
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error in processMonthlyPayments:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Handle payment webhook
   */
  /**
   * Normalise the request body to the exact bytes the gateway signed.
   *
   * Only a Buffer (or a string) is usable — `app.js` captures it via the
   * `express.json({ verify })` hook. An already-parsed object is deliberately
   * rejected rather than stringified: `JSON.stringify` does not reproduce the
   * gateway's byte sequence, so verifying against it would fail every time and
   * look like a signature problem instead of a plumbing problem.
   */
  toRawBody(payload) {
    if (Buffer.isBuffer(payload)) return payload;
    if (typeof payload === "string" && payload.length > 0) return Buffer.from(payload, "utf8");
    return null;
  }

  /**
   * The webhook secret configured in the admin settings, falling back to the
   * environment. The settings screen persists the secret to
   * `SystemSettings.payment.<gateway>.webhookSecret`, so reading only the env var
   * meant a secret entered in the UI had no effect.
   */
  async getWebhookSecret(gateway) {
    // Delegates to the single credential resolver so the webhook secret is read,
    // decrypted and fall back to the env in exactly one place.
    const { webhookSecret } = await this.getGatewayCredentials(gateway);
    return webhookSecret;
  }

  /** Constant-time compare so a signature cannot be brute-forced byte by byte. */
  safeCompare(expected, received) {
    if (!expected || !received) return false;
    const a = Buffer.from(String(expected), "utf8");
    const b = Buffer.from(String(received), "utf8");
    if (a.length !== b.length) return false;
    try {
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /**
   * Verify a webhook signature over the raw bytes.
   * Returns `{ valid, reason, event }` — never throws, so the caller decides.
   */
  async verifyWebhookSignature(gateway, rawBody, signature) {
    const secret = await this.getWebhookSecret(gateway);
    if (!secret) {
      return { valid: false, reason: `no ${gateway} webhook secret is configured` };
    }
    if (!signature) {
      return { valid: false, reason: "the signature header is missing" };
    }

    if (gateway === "stripe") {
      const stripe = await this.getStripeClient();
      if (!stripe) {
        return { valid: false, reason: "the Stripe client is not configured" };
      }
      try {
        const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
        return { valid: true, event };
      } catch (error) {
        return { valid: false, reason: error.message };
      }
    }

    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const valid = this.safeCompare(expected, signature);
    return valid ? { valid: true } : { valid: false, reason: "signature mismatch" };
  }

  /**
   * A stable id for a delivery, so a gateway retry can be recognised.
   * Prefers the header the gateway sends; falls back to the entity id, and
   * finally to the payload hash so an identical retry still dedupes.
   */
  extractWebhookEventId(gateway, event, meta = {}) {
    if (meta.eventId) return String(meta.eventId);

    if (gateway === "stripe") {
      return event?.id ? String(event.id) : null;
    }

    const entity =
      event?.payload?.payment?.entity ||
      event?.payload?.refund?.entity ||
      event?.payload?.order?.entity ||
      null;
    const entityId = entity?.id || entity?.payment_id || null;

    if (event?.event && entityId) return `${event.event}:${entityId}`;
    if (entityId) return String(entityId);
    return null;
  }

  /**
   * Claim a delivery. The unique index on { gateway, eventId } is the lock: the
   * insert either wins (first delivery) or fails (a retry), which is what makes
   * webhook processing idempotent. Razorpay and Stripe both retry until they get
   * a 2xx, so without this the same event would be applied repeatedly.
   */
  async claimWebhookEvent({ gateway, eventId, eventType, payloadHash }) {
    try {
      const doc = await WebhookEvent.create({
        gateway,
        eventId,
        eventType,
        payloadHash,
        status: "processing",
      });
      return { claimed: true, id: doc._id };
    } catch (error) {
      if (error?.code === 11000) {
        const existing = await WebhookEvent.findOneAndUpdate(
          { gateway, eventId },
          { $inc: { attempts: 1 } },
          { new: true },
        ).lean();

        // A different payload reusing a claimed id means either a bug at the
        // gateway or a replayed signature — worth surfacing.
        if (existing?.payloadHash && payloadHash && existing.payloadHash !== payloadHash) {
          logger.warn("Webhook event id reused with a different payload", {
            gateway,
            eventId,
            firstSeenStatus: existing.status,
          });
        }
        return { claimed: false, existing };
      }
      throw error;
    }
  }

  /** Close out a claimed delivery. */
  async markWebhookEvent(id, status, extra = {}) {
    if (!id) return;
    try {
      await WebhookEvent.updateOne(
        { _id: id },
        { $set: { status, ...extra, ...(status === "processing" ? {} : { processedAt: new Date() }) } },
      );
    } catch (error) {
      logger.warn(`Could not update webhook event ${id}: ${error.message}`);
    }
  }

  /**
   * Handle payment webhook
   *
   * Order matters: the signature is checked BEFORE the delivery is claimed, so an
   * unauthenticated caller cannot write a WebhookEvent row and thereby suppress
   * the real delivery of that event id.
   */
  async handleWebhook(gateway, payload, signature, meta = {}) {
    try {
      const rawBody = this.toRawBody(payload);
      if (!rawBody) {
        throw new AppError(
          "Raw request body is unavailable, so the webhook signature cannot be verified",
          400,
        );
      }

      const verification = await this.verifyWebhookSignature(gateway, rawBody, signature);
      if (!verification.valid) {
        logger.warn(`Rejected ${gateway} webhook: ${verification.reason}`);
        throw new AppError("Invalid webhook signature", 400);
      }

      const event = verification.event || JSON.parse(rawBody.toString("utf8"));
      const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");
      const eventId =
        this.extractWebhookEventId(gateway, event, meta) || `payload:${payloadHash}`;

      const claim = await this.claimWebhookEvent({
        gateway,
        eventId,
        eventType: gateway === "stripe" ? event?.type : event?.event,
        payloadHash,
      });

      if (!claim.claimed) {
        // Already handled. Return 2xx so the gateway stops retrying.
        logger.info(`${gateway} webhook ${eventId} already processed; skipping`);
        return { received: true, duplicate: true };
      }

      try {
        if (gateway === "stripe") {
          switch (event.type) {
            case "payment_intent.succeeded":
              await this.handleStripePaymentSuccess(event.data.object);
              break;
            case "payment_intent.payment_failed":
              await this.handleStripePaymentFailure(event.data.object);
              break;
            case "charge.refunded":
              await this.handleStripeRefund(event.data.object);
              break;
            default:
              await this.markWebhookEvent(claim.id, "ignored", {
                error: `unhandled Stripe event type: ${event.type}`,
              });
              return { received: true, ignored: true };
          }
        } else if (gateway === "razorpay") {
          switch (event.event) {
            case "payment.captured":
              await this.handleRazorpayPaymentSuccess(event.payload.payment.entity);
              break;
            case "payment.failed":
              await this.handleRazorpayPaymentFailure(event.payload.payment.entity);
              break;
            case "refund.processed":
              await this.handleRazorpayRefund(event.payload.refund.entity);
              break;

            // ── RazorpayX payout lifecycle ────────────────────────────────────
            // A gateway payout is asynchronous: `payouts.create` returns `queued`
            // and the real outcome arrives here. Without these the payout would sit
            // in `processing` for ever and its ledger entries would stay reserved.
            case "payout.processed":
              await this.handleRazorpayPayoutProcessed(event.payload.payout.entity);
              break;
            case "payout.failed":
            case "payout.rejected":
              await this.handleRazorpayPayoutFailed(event.payload.payout.entity);
              break;
            case "payout.reversed":
              await this.handleRazorpayPayoutReversed(event.payload.payout.entity);
              break;
            case "payout.queued":
            case "payout.initiated":
            case "payout.pending":
              // Not a terminal state. Recorded so the sequence is visible, and the
              // payout stays `processing` until a terminal event arrives.
              await this.markWebhookEvent(claim.id, "processed", {
                error: `payout still in flight: ${event.event}`,
              });
              return { received: true, inFlight: true };
            default:
              await this.markWebhookEvent(claim.id, "ignored", {
                error: `unhandled Razorpay event type: ${event.event}`,
              });
              return { received: true, ignored: true };
          }
        } else {
          await this.markWebhookEvent(claim.id, "ignored", { error: `unknown gateway: ${gateway}` });
          throw new AppError(`Unsupported webhook gateway: ${gateway}`, 400);
        }

        await this.markWebhookEvent(claim.id, "processed");
        return { received: true };
      } catch (handlerError) {
        // Recorded as failed so the delivery can be replayed deliberately. The
        // gateway will retry, and the retry is deduped — so an operator can flip
        // this row back to `processing` to force a re-run.
        await this.markWebhookEvent(claim.id, "failed", { error: handlerError.message });
        throw handlerError;
      }
    } catch (error) {
      logger.error(`Error handling ${gateway} webhook: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle Stripe payment success
   */
  async handleStripePaymentSuccess(paymentIntent) {
    const paymentId = paymentIntent.metadata.paymentId;
    if (!paymentId) return;

    await Payment.findByIdAndUpdate(paymentId, {
      status: "success",
      "paymentDetails.transactionId": paymentIntent.id,
      "timestamps.completed": new Date(),
    });
  }

  /**
   * Handle Stripe payment failure
   */
  async handleStripePaymentFailure(paymentIntent) {
    const paymentId = paymentIntent.metadata.paymentId;
    if (!paymentId) return;

    await Payment.findByIdAndUpdate(paymentId, {
      status: "failed",
      "timestamps.failed": new Date(),
    });
  }

  /**
   * Handle Stripe refund
   */
  async handleStripeRefund(charge) {
    // Find payment by transaction ID and update refund status
    await Payment.findOneAndUpdate(
      { "paymentDetails.transactionId": charge.payment_intent },
      {
        status: "refunded",
        refundDetails: {
          amount: charge.amount_refunded / 100,
          transactionId: charge.id,
          processedAt: new Date(),
        },
      },
    );
  }

  /**
   * Handle Razorpay payment success (`payment.captured`).
   *
   * This is the safety net for the case the whole webhook exists for: the
   * customer's money was captured but their browser never came back, so
   * `verifyPayment` never ran. Without this the payment stayed `pending` forever
   * and the rental looked unpaid even though the gateway had taken the money.
   *
   * The payment is claimed with a conditional update on `status: 'pending'`, which
   * is what keeps this from racing a concurrent client-side verification: only
   * one of the two can win the claim, and the loser does nothing.
   */
  /** Locate the local Payout behind a RazorpayX payout entity. */
  async findPayoutFromGatewayEntity(entity) {
    const gatewayPayoutId = entity?.id;
    const referenceId = entity?.reference_id;

    if (gatewayPayoutId) {
      const byId = await Payout.findOne({ "gateway.payoutId": gatewayPayoutId });
      if (byId) return byId;
    }

    // `reference_id` is the payoutNumber we send, so it still finds the payout when
    // the create response never made it back into the database.
    if (referenceId) {
      return Payout.findOne({ payoutNumber: referenceId });
    }
    return null;
  }

  /** The environment recorded when the payout was sent, for the audit trail. */
  payoutMode(payout, entity) {
    const fromEntity = entity?.notes?.environment;
    if (fromEntity === "test" || fromEntity === "live") return fromEntity;
    return payout?.gateway?.mode || null;
  }

  /**
   * RazorpayX finished a payout: mark it paid and settle the ledger.
   *
   * Idempotent — a retried `payout.processed` finds the payout already paid and does
   * nothing, on top of the WebhookEvent dedupe that runs before this.
   */
  async handleRazorpayPayoutProcessed(entity) {
    const payout = await this.findPayoutFromGatewayEntity(entity);
    if (!payout) {
      logger.warn(
        `Razorpay payout.processed for an unknown payout: ${entity?.id} / ${entity?.reference_id}`,
      );
      return { applied: false, reason: "unknown payout" };
    }

    if (payout.status === "paid") {
      return { applied: false, alreadyApplied: true, payoutNumber: payout.payoutNumber };
    }

    const settlementService = require("./settlement.service");
    const updated = await settlementService.finalisePaid(payout._id, {
      utr: entity?.utr || entity?.id,
      payoutId: entity?.id,
      requiresManualTransfer: false,
      mode: this.payoutMode(payout, entity),
    });

    logger.info(`Gateway payout ${payout.payoutNumber} confirmed by webhook`);
    return { applied: true, payoutNumber: updated?.payoutNumber, status: updated?.status };
  }

  /**
   * A gateway payout failed or was rejected. No money moved, so the entries it
   * reserved must go straight back into the payable pool — otherwise the vendor's
   * money is stuck behind a payout that will never complete.
   */
  async handleRazorpayPayoutFailed(entity) {
    const payout = await this.findPayoutFromGatewayEntity(entity);
    if (!payout) {
      logger.warn(
        `Razorpay payout failure for an unknown payout: ${entity?.id} / ${entity?.reference_id}`,
      );
      return { applied: false, reason: "unknown payout" };
    }

    if (payout.status === "paid") {
      // A failure notice cannot un-pay a paid payout. Money that must come back does
      // so as a separate `payout.reversed` event.
      logger.warn(`Ignoring a failure event for the already-paid payout ${payout.payoutNumber}`);
      return { applied: false, reason: "payout already paid" };
    }

    const reason =
      entity?.failure_reason ||
      entity?.status_details?.description ||
      "the gateway reported a failure";

    // Released by the `payout` stamp on the entries — the authoritative record of
    // what this payout reserved — rather than by the payout's own `entryIds` array.
    // A missing or stale array would otherwise strand the vendor's money behind a
    // payout that can never complete. Matching on the stamp is also what cancelPayout
    // does, and status 'available' keeps a settled entry out of reach.
    const released = await VendorLedger.updateMany(
      { payout: payout._id, status: "available" },
      { $set: { payout: null } },
    );

    const updated = await Payout.findByIdAndUpdate(
      payout._id,
      {
        $set: {
          status: "failed",
          "gateway.failureReason": reason,
          "gateway.mode": this.payoutMode(payout, entity),
        },
      },
      { new: true },
    );

    logger.error(
      `Gateway payout ${payout.payoutNumber} failed: ${reason}. Released ${released.modifiedCount} ledger entries back to available.`,
    );

    return {
      applied: true,
      payoutNumber: updated?.payoutNumber,
      releasedEntries: released.modifiedCount,
      reason,
    };
  }

  /** A paid payout came back from the bank. Claw the money back in the ledger. */
  async handleRazorpayPayoutReversed(entity) {
    const payout = await this.findPayoutFromGatewayEntity(entity);
    if (!payout) {
      logger.warn(
        `Razorpay payout.reversed for an unknown payout: ${entity?.id} / ${entity?.reference_id}`,
      );
      return { applied: false, reason: "unknown payout" };
    }

    const settlementService = require("./settlement.service");
    const result = await settlementService.reversePayoutInLedger(payout, {
      reason:
        entity?.failure_reason ||
        "the gateway reversed the payout after it was sent",
    });

    logger.error(
      `Gateway payout ${payout.payoutNumber} was reversed: ${result.reversed} earnings, amount ${result.amount}`,
    );
    return { applied: true, payoutNumber: payout.payoutNumber, ...result };
  }

  async handleRazorpayPaymentSuccess(entity) {
    const orderId = entity?.order_id;
    const gatewayPaymentId = entity?.id;

    const payment =
      (orderId && (await Payment.findOne({ "paymentDetails.razorpayOrderId": orderId }))) ||
      (entity?.notes?.paymentId && (await Payment.findById(entity.notes.paymentId))) ||
      null;

    if (!payment) {
      logger.warn(
        `Razorpay capture webhook could not be matched to a payment (order ${orderId || "unknown"})`,
      );
      return { applied: false, reason: "no matching payment" };
    }

    if (payment.status === "success") {
      return { applied: false, alreadyApplied: true, paymentId: String(payment._id) };
    }

    const claimed = await Payment.findOneAndUpdate(
      { _id: payment._id, status: "pending" },
      { $set: { status: "processing", "timestamps.processed": new Date() } },
      { new: true },
    );

    if (!claimed) {
      // Either a client-side verification is mid-flight, or the payment is in a
      // terminal state. Either way, another actor owns it — do not touch it.
      const current = await Payment.findById(payment._id).select("status").lean();
      logger.info(
        `Razorpay capture webhook skipped for ${payment.paymentNumber}: status is ${current?.status}`,
      );
      return { applied: false, reason: `payment is ${current?.status}`, concurrent: current?.status === "processing" };
    }

    const applied = await this.applySuccessfulPayment(claimed, {
      gatewayPaymentId,
      gatewayOrderId: orderId,
      via: "webhook",
    });

    return { applied: true, paymentId: String(payment._id), status: applied.status };
  }

  /**
   * Handle Razorpay payment failure (`payment.failed`).
   * Only moves a payment that has not succeeded — a late failure event must never
   * undo a captured payment.
   */
  async handleRazorpayPaymentFailure(entity) {
    const orderId = entity?.order_id;
    const reason = entity?.error_description || entity?.error_reason || "Gateway reported a failure";

    const query = orderId
      ? { "paymentDetails.razorpayOrderId": orderId, status: "pending" }
      : entity?.notes?.paymentId
        ? { _id: entity.notes.paymentId, status: "pending" }
        : null;

    if (!query) {
      return { applied: false, reason: "the event carried no order or payment reference" };
    }

    const updated = await Payment.findOneAndUpdate(
      query,
      {
        $set: {
          status: "failed",
          failureReason: reason,
          "timestamps.failed": new Date(),
          "paymentDetails.razorpayPaymentId": entity?.id,
        },
      },
      { new: true },
    );

    if (!updated) {
      // Already success/failed/cancelled — leave it alone.
      return { applied: false, reason: "no pending payment matched" };
    }

    logger.info(`Razorpay failure webhook marked ${updated.paymentNumber} as failed`);
    return { applied: true, paymentId: String(updated._id) };
  }

  /**
   * Handle Razorpay refund (`refund.processed`).
   *
   * Records the refund and reverses the ledger so the vendor's share is given
   * back. Deliberately does NOT flip the payment to fully `refunded` unless the
   * refunded total covers the amount charged — a partial refund must not make the
   * payment look fully reversed.
   */
  async handleRazorpayRefund(entity) {
    const gatewayPaymentId = entity?.payment_id;
    const refundAmount = Number(entity?.amount) / 100; // paise -> rupees

    const payment = gatewayPaymentId
      ? await Payment.findOne({ "paymentDetails.razorpayPaymentId": gatewayPaymentId })
      : null;

    if (!payment) {
      logger.warn(
        `Razorpay refund webhook could not be matched to a payment (payment ${gatewayPaymentId || "unknown"})`,
      );
      return { applied: false, reason: "no matching payment" };
    }

    const alreadyRefunded = Number(payment.refundDetails?.amount) || 0;
    const newRefundedTotal = roundMoney(alreadyRefunded + refundAmount);
    const fullyRefunded = newRefundedTotal >= roundMoney(payment.amount);

    payment.refundDetails = {
      ...(payment.refundDetails || {}),
      amount: newRefundedTotal,
      reason: entity?.notes?.reason || payment.refundDetails?.reason || "Refunded via gateway",
      transactionId: entity?.id,
      processedAt: new Date(),
    };
    if (fullyRefunded) {
      payment.status = "refunded";
      payment.timestamps.refunded = new Date();
    }
    await payment.save();

    // Same reversal the admin refund endpoint performs, keyed on the gateway
    // refund id so a replayed webhook cannot reverse twice.
    const reversal = await settlement.reverseEntriesForRefund({
      payment,
      refundAmount,
      idempotencyKey: entity?.id ? `razorpay:${entity.id}` : undefined,
      reason: "Gateway refund",
    });

    logger.info(`Razorpay refund webhook recorded ${refundAmount} on ${payment.paymentNumber}`);
    return { applied: true, paymentId: String(payment._id), fullyRefunded, ...reversal };
  }

  /**
   * Verify Razorpay webhook
   */
  async verifyRazorpayWebhook(payload, signature) {
    // Delegates to verifyWebhookSignature, which reads the secret from the admin
    // settings (the env var is only a fallback) and compares in constant time.
    // The previous implementation used `===`, which leaks timing, and required
    // `process.env.RAZORPAY_WEBHOOK_SECRET`, so a secret saved through the admin
    // UI was ignored entirely.
    const result = await this.verifyWebhookSignature(
      "razorpay",
      this.toRawBody(payload),
      signature,
    );
    if (!result.valid) logger.warn(`Razorpay webhook verification failed: ${result.reason}`);
    return result.valid;
  }

  /**
   * Invalidate payment cache
   */
  async invalidatePaymentCache(paymentId) {
    try {
      if (this.redisClient) {
        const patterns = [
          `payment:${paymentId}`,
          `payment:${paymentId}:*`,
          "payments:user:*",
          "payments:vendor:*",
        ];

        for (const pattern of patterns) {
          const keys = await this.redisClient.keys(pattern);
          if (keys.length > 0) {
            await this.redisClient.del(keys);
          }
        }
      }
    } catch (error) {
      logger.error("Error invalidating payment cache:", error);
    }
  }
}

module.exports = new PaymentService();