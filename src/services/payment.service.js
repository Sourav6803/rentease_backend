const { Payment, Rental, User, Vendor, Product } = require('../models');
const  AppError  = require('../utils/AppError');
const { addJob } = require('../jobs');
const { eventEmitter, EVENTS } = require('../events');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const Stripe = require('stripe');
const crypto = require('crypto');

class PaymentService {
  constructor() {
    this.redisClient = getRedisClient();
    this.defaultTTL = 1800; // 30 minutes

    // Initialize Razorpay
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      this.razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });
    }

    // Initialize Stripe
    if (process.env.STRIPE_SECRET_KEY) {
      this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    }
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
  calculatePaymentBreakdown(rental, paymentType, amount = null) {
    const breakdown = {
      rentalId: rental._id,
      rentalNumber: rental.rentalNumber,
      paymentType,
      baseAmount: amount || rental.rentalDetails.totalAmount,
      tax: 0,
      convenienceFee: 0,
      discount: 0,
      total: amount || rental.rentalDetails.totalAmount,
    };

    // Calculate tax (if applicable)
    if (process.env.ENABLE_TAX === "true") {
      breakdown.tax = breakdown.baseAmount * 0.18; // 18% GST
      breakdown.total += breakdown.tax;
    }

    // Calculate convenience fee
    if (process.env.ENABLE_CONVENIENCE_FEE === "true") {
      breakdown.convenienceFee = Math.min(breakdown.baseAmount * 0.02, 100); // 2% capped at ₹100
      breakdown.total += breakdown.convenienceFee;
    }

    // Apply discount based on payment type
    if (paymentType === "rent" && rental.rentalDetails.tenureMonths >= 6) {
      breakdown.discount = breakdown.baseAmount * 0.05; // 5% discount for 6+ months
      breakdown.total -= breakdown.discount;
    }

    return breakdown;
  }

  /**
   * Create Razorpay order
   */
  async createRazorpayOrder(amount, currency = "INR", receipt = null) {
    try {
      if (!this.razorpay) {
        throw new AppError("Razorpay not configured", 500);
      }

      const options = {
        amount: Math.round(amount * 100), // Convert to paise
        currency,
        receipt: receipt || `receipt_${Date.now()}`,
        payment_capture: 1,
      };

      const order = await this.razorpay.orders.create(options);

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
  verifyRazorpayPayment(orderId, paymentId, signature) {
    try {
      const body = orderId + "|" + paymentId;
      const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest("hex");

      return expectedSignature === signature;
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
      if (!this.stripe) {
        throw new AppError("Stripe not configured", 500);
      }

      const paymentIntent = await this.stripe.paymentIntents.create({
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
  verifyStripeWebhook(payload, signature) {
    try {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret,
      );
      return event;
    } catch (error) {
      logger.error("Error verifying Stripe webhook:", error);
      return null;
    }
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

      // Calculate payment breakdown
      const breakdown = this.calculatePaymentBreakdown(
        rental,
        paymentType,
        amount,
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
    const session = await mongoose.startSession();
    session.startTransaction();

    console.log("verificationData", verificationData);

    try {
      const payment = await Payment.findById(paymentId).session(session);

      if (!payment) {
        throw new AppError("Payment not found", 404);
      }

      if (payment.status !== "pending") {
        throw new AppError("Payment already processed", 400);
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
        isValid = this.verifyRazorpayPayment(
          orderId,
          gatewayPaymentId,
          signature,
        );
        console.log("isValid", isValid);
      } else if (gateway === "stripe") {
        if (!this.stripe || !paymentIntentId) {
          isValid = false;
        } else {
          const intent =
            await this.stripe.paymentIntents.retrieve(paymentIntentId);
          const expectedId = payment._id.toString();
          isValid =
            intent.status === "succeeded" &&
            intent.metadata?.paymentId === expectedId;
        }
      }

      console.log("isValid", isValid);
      if (!isValid) {
        payment.status = "failed";
        payment.timestamps.failed = new Date();
        await payment.save({ session });
        await session.commitTransaction();
        console.log("Payment verification failed");
        throw new AppError("Payment verification failed", 400);
      }

      // Update payment status
      payment.status = "success";
      payment.paymentDetails.transactionId =
        gateway === "stripe" ? paymentIntentId : gatewayPaymentId;
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

      // Update rental status if payment is complete
      if (paymentStatus === "completed") {
        rental.status = "active"; // Change from 'pending_payment' to 'active'

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

      // Update vendor payment info
      await Vendor.findOneAndUpdate(
        { user: rental.vendor },
        {
          $inc: {
            "payments.pending": -payment.amount,
            "payments.paid": payment.amount,
          },
        },
        { session },
      );

      await session.commitTransaction();

      console.log("Payment verified successfully:", {
        paymentId: payment._id,
        rentalId: rental._id,
        paidAmount: newPaidAmount,
        dueAmount: newDueAmount,
        status: paymentStatus,
      });

      // Emit event (uncomment if you have eventEmitter configured)
      // eventEmitter.emit(EVENTS.PAYMENT.SUCCESS, {
      //   paymentId: payment._id,
      //   paymentNumber: payment.paymentNumber,
      //   userId: payment.user,
      //   vendorId: payment.vendor,
      //   rentalId: rental._id,
      //   amount: payment.amount,
      //   type: payment.type
      // });

      // Queue receipt email (uncomment if you have job queue configured)
      // addJob('email', 'payment-receipt', {
      //   paymentId: payment._id,
      //   userId: payment.user
      // }).catch((err) => {
      //   logger.error('Failed to enqueue payment receipt email:', err);
      // });

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

      // Process refund based on gateway
      if (payment.paymentDetails.gateway === "razorpay" && this.razorpay) {
        try {
          const refund = await this.razorpay.payments.refund(
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
      } else if (payment.paymentDetails.gateway === "stripe" && this.stripe) {
        try {
          const refund = await this.stripe.refunds.create({
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

      return (
        stats[0] || {
          overview: [{ totalAmount: 0, totalCount: 0, averageAmount: 0 }],
          byType: [],
          byMethod: [],
          dailyTrend: [],
        }
      );
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
  async handleWebhook(gateway, payload, signature) {
    try {
      let event;

      if (gateway === "stripe") {
        event = this.verifyStripeWebhook(payload, signature);
        if (!event) {
          throw new AppError("Invalid webhook signature", 400);
        }

        // Handle different event types
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
        }
      } else if (gateway === "razorpay") {
        // Razorpay webhook handling
        const isValid = this.verifyRazorpayWebhook(payload, signature);
        if (!isValid) {
          throw new AppError("Invalid webhook signature", 400);
        }

        const eventData = JSON.parse(payload);

        switch (eventData.event) {
          case "payment.captured":
            await this.handleRazorpayPaymentSuccess(
              eventData.payload.payment.entity,
            );
            break;
          case "payment.failed":
            await this.handleRazorpayPaymentFailure(
              eventData.payload.payment.entity,
            );
            break;
          case "refund.processed":
            await this.handleRazorpayRefund(eventData.payload.refund.entity);
            break;
        }
      }

      return { received: true };
    } catch (error) {
      logger.error("Error handling webhook:", error);
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
   * Handle Razorpay payment success
   */
  async handleRazorpayPaymentSuccess(payment) {
    // Find payment by order ID and update
    // Implementation depends on your order tracking
  }

  /**
   * Handle Razorpay payment failure
   */
  async handleRazorpayPaymentFailure(payment) {
    // Handle failed payment
  }

  /**
   * Handle Razorpay refund
   */
  async handleRazorpayRefund(refund) {
    // Handle refund
  }

  /**
   * Verify Razorpay webhook
   */
  verifyRazorpayWebhook(payload, signature) {
    try {
      const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(payload)
        .digest("hex");

      return expectedSignature === signature;
    } catch (error) {
      logger.error("Error verifying Razorpay webhook:", error);
      return false;
    }
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