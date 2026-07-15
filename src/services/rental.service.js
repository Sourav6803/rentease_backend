
const { Rental, User, Vendor, Product, Inventory, Payment, Delivery, Maintenance, Review, Cart } = require('../models');
const  AppError  = require('../utils/AppError');
const { addJob } = require('../jobs');
const { eventEmitter, EVENTS } = require('../events');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const moment = require('moment');
const Address = require('../models/Address.model');
const DiscountService = require('./discount.service');
// const Cart = require('../models/Cart.model');

class RentalService {
  constructor() {
    this.redisClient = getRedisClient();
    this.defaultTTL = 1800; // 30 minutes
  }

  /**
   * Calculate late fee
   */
  calculateLateFee(rental, returnDate) {
    const dueDate = new Date(rental.rentalDetails.endDate);
    const actualReturn = new Date(returnDate);

    if (actualReturn <= dueDate) {
      return 0;
    }

    const daysLate = Math.ceil(
      (actualReturn - dueDate) / (1000 * 60 * 60 * 24),
    );
    const dailyRate = rental.rentalDetails.monthlyRent / 30;
    const lateFee = daysLate * dailyRate;

    // Apply maximum late fee cap if configured
    const maxLateFee = rental.rentalDetails.monthlyRent * 2; // Max 2 months rent
    return Math.min(lateFee, maxLateFee);
  }

  /**
   * Check product availability for dates
   */
  async checkProductAvailability(
    productId,
    startDate,
    endDate,
    excludeRentalId = null,
  ) {
    try {
      const query = {
        product: productId,
        status: { $in: ["confirmed", "active", "delivered"] },
        $or: [
          {
            "rentalDetails.startDate": { $lte: endDate },
            "rentalDetails.endDate": { $gte: startDate },
          },
        ],
      };

      if (excludeRentalId) {
        query._id = { $ne: excludeRentalId };
      }

      const conflictingRentals = await Rental.countDocuments(query);

      if (conflictingRentals > 0) {
        return { available: false, conflictingRentals };
      }

      // Check inventory availability
      const product = await Product.findById(productId);
      if (!product) {
        return { available: false, reason: "Product not found" };
      }

      const availableInventory = product.inventory.availableQuantity;

      if (availableInventory < 1) {
        return { available: false, reason: "No inventory available" };
      }

      return {
        available: true,
        availableQuantity: availableInventory,
      };
    } catch (error) {
      logger.error("Error checking availability:", error);
      throw error;
    }
  }

  /**
   * Generate unique rental number
   */
  generateRentalNumber() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, "0");
    return `RNT${timestamp}${random}`;
  }

  /**
   * Calculate rental price for single product
   */
  calculateRentalPrice(product, tenureMonths, couponCode = null) {
    const monthlyRent = product.pricing.monthlyRent;
    const securityDeposit = product.pricing.securityDeposit;
    const deliveryCharges = product.pricing.deliveryCharges || 0;

    // Find applicable discount based on tenure
    const rentalOption = product.pricing.rentalOptions?.find(
      (opt) => opt.months === tenureMonths,
    );

    const subtotal = monthlyRent * tenureMonths;
    const tenureDiscount = rentalOption
      ? (subtotal * rentalOption.discount) / 100
      : 0;

    // Apply coupon discount if provided (would be validated separately)
    let couponDiscount = 0;
    let appliedCoupon = null;

    const totalAmount =
      subtotal +
      securityDeposit +
      deliveryCharges -
      tenureDiscount -
      couponDiscount;

    return {
      monthlyRent,
      securityDeposit,
      deliveryCharges,
      tenureMonths,
      subtotal,
      tenureDiscount,
      couponDiscount,
      totalAmount,
      appliedCoupon,
    };
  }

  /**
   * Calculate total price for multiple cart items
   */
  calculateCartTotal(cartItems, products) {
    let totals = {
      subtotal: 0,
      securityDeposit: 0,
      deliveryCharges: 0,
      tenureDiscount: 0,
      couponDiscount: 0,
      totalAmount: 0,
      items: [],
    };

    for (const cartItem of cartItems) {
      const product = products.find(
        (p) => p._id.toString() === cartItem.product.toString(),
      );
      if (!product) continue;

      const pricing = this.calculateRentalPrice(
        product,
        cartItem.rentalMonths,
        cartItem.appliedCoupon,
      );

      const itemTotal = {
        productId: product._id,
        productName: product.basicInfo.name,
        quantity: cartItem.quantity,
        rentalMonths: cartItem.rentalMonths,
        monthlyRent: pricing.monthlyRent,
        subtotal: pricing.subtotal * cartItem.quantity,
        securityDeposit: pricing.securityDeposit * cartItem.quantity,
        deliveryCharges: pricing.deliveryCharges * cartItem.quantity,
        discount: pricing.tenureDiscount * cartItem.quantity,
        totalAmount: pricing.totalAmount * cartItem.quantity,
      };

      totals.items.push(itemTotal);
      totals.subtotal += itemTotal.subtotal;
      totals.securityDeposit += itemTotal.securityDeposit;
      totals.deliveryCharges += itemTotal.deliveryCharges;
      totals.tenureDiscount += itemTotal.discount;
      totals.totalAmount += itemTotal.totalAmount;
    }

    return totals;
  }

  // services/rental.service.js - Update the address lookup in createRentalFromCart

  // async createRentalFromCart(userId, cartId, addressId, options = {}) {
  //   const session = await mongoose.startSession();
  //   session.startTransaction();

  //   try {
  //     // Get cart with populated items
  //     const cart = await Cart.findOne({
  //       _id: cartId,
  //       user: userId
  //     }).populate('items.product');

  //     if (!cart) {
  //       throw new AppError('Cart not found', 404);
  //     }

  //     if (cart.items.length === 0) {
  //       throw new AppError('Cannot create rental from empty cart', 400);
  //     }

  //     // Check if cart is reserved and not expired
  //     let needsReservation = false;

  //     if (!cart.reserved) {
  //       needsReservation = true;
  //     } else if (cart.reservedUntil && new Date() > cart.reservedUntil) {
  //       needsReservation = true;
  //       cart.reserved = false;
  //       cart.reservationToken = null;
  //       await cart.save({ session });
  //     }

  //     if (needsReservation) {
  //       const reservedUntil = new Date();
  //       reservedUntil.setMinutes(reservedUntil.getMinutes() + 30);

  //       cart.reserved = true;
  //       cart.reservedUntil = reservedUntil;
  //       cart.reservationToken = require('crypto').randomBytes(32).toString('hex');
  //       await cart.save({ session });
  //     }

  //     // Validate all products are still available
  //     const products = [];
  //     const inventoryItems = [];
  //     const productAvailability = [];

  //     for (const item of cart.items) {
  //       const product = await Product.findById(item.product._id).session(session);

  //       if (!product) {
  //         throw new AppError(`Product not found for cart item`, 404);
  //       }

  //       if (!product.status.isActive) {
  //         throw new AppError(`Product "${product.basicInfo.name}" is no longer available`, 400);
  //       }

  //       const availableInventory = product.inventory.availableQuantity;
  //       if (availableInventory < item.quantity) {
  //         throw new AppError(
  //           `Only ${availableInventory} unit(s) available for "${product.basicInfo.name}"`,
  //           400
  //         );
  //       }

  //       const availableItems = await Inventory.find({
  //         product: product._id,
  //         status: 'available'
  //       }).limit(item.quantity).session(session);

  //       if (availableItems.length < item.quantity) {
  //         throw new AppError(
  //           `Insufficient inventory for product "${product.basicInfo.name}"`,
  //           400
  //         );
  //       }

  //       products.push(product);
  //       inventoryItems.push(...availableItems);
  //       productAvailability.push({
  //         product,
  //         inventory: availableItems,
  //         quantity: item.quantity,
  //         rentalMonths: item.rentalMonths,
  //         cartItem: item
  //       });
  //     }

  //     // Calculate total pricing
  //     const subtotal = cart.summary.grandTotal || 0;
  //     const securityDeposit = cart.summary.securityDepositTotal || 0;
  //     const deliveryCharges = cart.summary.deliveryChargesTotal || 0;
  //     const tax = subtotal * 0.18; // 18% GST
  //     const totalAmount = subtotal + securityDeposit + deliveryCharges + tax;

  //     // Get address from Address model directly

  //     const address = await Address.findOne({
  //       _id: addressId,
  //       user: userId
  //     }).session(session);

  //     if (!address) {
  //       throw new AppError('Address not found', 404);
  //     }

  //     // Create rental record
  //     const rentalNumber = this.generateRentalNumber();
  //     const startDate = new Date(options.deliverySlot ? options.deliverySlot.split('|')[0] : new Date());
  //     const endDate = moment(startDate).add(cart.items[0].rentalMonths, 'months').toDate();

  //     // Prepare cart items for storage
  //     const cartItemsData = cart.items.map(item => ({
  //       product: item.product._id,
  //       quantity: item.quantity,
  //       rentalMonths: item.rentalMonths,
  //       pricing: item.pricing,
  //       totals: item.totals
  //     }));

  //     // Prepare multi-item details
  //     const multiItemDetails = cart.items.map(item => ({
  //       productId: item.product._id,
  //       productName: item.product.basicInfo.name,
  //       quantity: item.quantity,
  //       rentalMonths: item.rentalMonths,
  //       monthlyRent: item.product.pricing.monthlyRent,
  //       totalAmount: item.totals.lineTotal
  //     }));

  //     const rental = await Rental.create([{
  //       rentalNumber,
  //       user: userId,
  //       vendor: products[0].vendor,
  //       product: products[0]._id,
  //       cart: cartId,
  //       cartItems: cartItemsData,
  //       inventory: inventoryItems.map(i => i._id),
  //       address: addressId,
  //       addressDetails: {
  //         addressLine1: address.addressLine1,
  //         addressLine2: address.addressLine2,
  //         city: address.city,
  //         state: address.state,
  //         pincode: address.pincode,
  //         country: address.country || 'India',
  //         type: address.addressType || address.type,
  //         contactName: address.contactDetails?.name,
  //         contactPhone: address.contactDetails?.phone
  //       },
  //       rentalDetails: {
  //         startDate,
  //         endDate,
  //         tenureMonths: cart.items[0].rentalMonths,
  //         monthlyRent: products[0].pricing.monthlyRent,
  //         securityDeposit: securityDeposit,
  //         deliveryCharges: deliveryCharges,
  //         subtotal: subtotal,
  //         tax: tax,
  //         totalAmount: totalAmount
  //         // discount field omitted since no discount applied
  //       },
  //       multiItemDetails: multiItemDetails,
  //       payment: {
  //         dueAmount: totalAmount,
  //         paidAmount: 0,
  //         status: 'pending'
  //       },
  //       specialRequests: options.specialRequests || '',
  //       status: 'pending',
  //       timeline: [{
  //         status: 'pending',
  //         timestamp: new Date(),
  //         note: 'Rental request created from cart',
  //         updatedBy: userId
  //       }],
  //       metadata: {
  //         createdBy: userId,
  //         source: 'web'
  //       }
  //     }], { session });

  //     // Reserve inventory items
  //     for (let i = 0; i < inventoryItems.length; i++) {
  //       inventoryItems[i].status = 'reserved';
  //       inventoryItems[i].currentRental = rental[0]._id;
  //       await inventoryItems[i].save({ session });
  //     }

  //     // Update product availability
  //     for (const item of productAvailability) {
  //       await Product.findByIdAndUpdate(
  //         item.product._id,
  //         { $inc: { 'inventory.availableQuantity': -item.quantity } },
  //         { session }
  //       );
  //     }

  //     // Clear cart after successful rental creation
  //     cart.items = [];
  //     cart.reserved = false;
  //     cart.reservationToken = null;
  //     cart.coupon = null;
  //     cart.summary = {
  //       itemsCount: 0,
  //       totalQuantity: 0,
  //       monthlyRentTotal: 0,
  //       securityDepositTotal: 0,
  //       deliveryChargesTotal: 0,
  //       grandTotal: 0
  //     };
  //     await cart.save({ session });

  //     await session.commitTransaction();

  //     // Populate the rental with related data before returning
  //     const populatedRental = await Rental.findById(rental[0]._id)
  //       .populate('user', 'profile.firstName profile.lastName email phone')
  //       .populate('vendor', 'business.name')
  //       .populate('product', 'basicInfo.name media.images')
  //       .populate('address');

  //     return populatedRental;
  //   } catch (error) {
  //     await session.abortTransaction();
  //     logger.error('Error in createRentalFromCart:', error);
  //     throw error;
  //   } finally {
  //     session.endSession();
  //   }
  // }

/**
 * Calculate delivery priority based on rental dates
 */
calculatePriority(rental, type) {
  const now = moment();
  const startDate = moment(rental.rentalDetails?.startDate);
  const endDate = moment(rental.rentalDetails?.endDate);
  
  if (type === 'pickup') {
    // High priority if rental ends within 1 day
    if (endDate.diff(now, 'days') <= 1) {
      return 'high';
    }
    // Medium priority if ends within 3 days
    if (endDate.diff(now, 'days') <= 3) {
      return 'medium';
    }
    return 'low';
  } else {
    // Delivery priority based on start date
    if (startDate.diff(now, 'days') <= 1) {
      return 'high';
    }
    if (startDate.diff(now, 'days') <= 3) {
      return 'medium';
    }
    return 'low';
  }
}

/**
 * Create rental from cart (supports multiple items)
 */
async createRentalFromCart(userId, cartId, addressId, options = {}) {
  const session = await mongoose.startSession();
  let committed = false;
  let createdRental = null;
  let inventoryItems = [];
  let productAvailability = [];
  let deliveryItems = [];
  let startDate = new Date();
  let deliverySlot = options.deliverySlot || null;
  let vendorId = null;
  let cartItemsData = [];
  let totalAmount = 0;
  
  try {
    session.startTransaction();

    // Get cart with populated items
    const cart = await Cart.findOne({
      _id: cartId,
      user: userId,
    }).populate("items.product");

    if (!cart) {
      throw new AppError("Cart not found", 404);
    }

    if (cart.items.length === 0) {
      throw new AppError("Cannot create rental from empty cart", 400);
    }

    // Check if cart is reserved and not expired
    let needsReservation = false;

    if (!cart.reserved) {
      needsReservation = true;
    } else if (cart.reservedUntil && new Date() > cart.reservedUntil) {
      needsReservation = true;
      cart.reserved = false;
      cart.reservationToken = null;
      await cart.save({ session });
    }

    if (needsReservation) {
      const reservedUntil = new Date();
      reservedUntil.setMinutes(reservedUntil.getMinutes() + 30);
      cart.reserved = true;
      cart.reservedUntil = reservedUntil;
      cart.reservationToken = require("crypto").randomBytes(32).toString("hex");
      await cart.save({ session });
    }

    // Validate all products are still available
    const products = [];

    for (const item of cart.items) {
      const product = await Product.findById(item.product._id).session(session);

      if (!product) {
        throw new AppError(`Product not found for cart item`, 404);
      }

      if (!product.status.isActive) {
        throw new AppError(
          `Product "${product.basicInfo.name}" is no longer available`,
          400,
        );
      }

      const availableInventory = product.inventory.availableQuantity;
      if (availableInventory < item.quantity) {
        throw new AppError(
          `Only ${availableInventory} unit(s) available for "${product.basicInfo.name}"`,
          400,
        );
      }

      const availableItems = await Inventory.find({
        product: product._id,
        status: "available",
      })
        .limit(item.quantity)
        .session(session);

      if (availableItems.length < item.quantity) {
        throw new AppError(
          `Insufficient inventory for product "${product.basicInfo.name}"`,
          400,
        );
      }

      products.push(product);
      inventoryItems.push(...availableItems);

      // Track delivery items
      for (const invItem of availableItems) {
        deliveryItems.push({
          product: product._id,
          inventory: invItem._id,
          name: product.basicInfo.name,
          sku: product.basicInfo.sku,
          quantity: 1,
          notes: `Item from cart order`,
        });
      }

      productAvailability.push({
        product,
        inventory: availableItems,
        quantity: item.quantity,
        rentalMonths: item.rentalMonths,
        cartItem: item,
      });
    }

    // Calculate total pricing.
    // NOTE: cart.summary.grandTotal is ALREADY net of any coupon discount
    // (recalculateSummary subtracts it), so we do NOT subtract it again here —
    // the discount is captured separately only for record-keeping/usage tracking.
    const subtotal = cart.summary.grandTotal || 0;
    const securityDeposit = cart.summary.securityDepositTotal || 0;
    const deliveryCharges = cart.summary.deliveryChargesTotal || 0;
    const tax = subtotal * 0.18;
    totalAmount = subtotal + securityDeposit + deliveryCharges + tax;

    // Coupon / discount carried from the cart (unified Discount system)
    const cartCoupon = cart.coupon && cart.coupon.isValid ? cart.coupon : null;
    const discountAmount = cartCoupon
      ? (cart.summary.discountAmount || cartCoupon.discountAmount || 0)
      : 0;

    // Get address
    const address = await Address.findOne({
      _id: addressId,
      user: userId,
    }).session(session);

    if (!address) {
      throw new AppError("Address not found", 404);
    }

    // Parse delivery slot
    let scheduledSlotObj = null;
    let scheduledDate = new Date();

    if (deliverySlot) {
      const slotParts = deliverySlot.split("|");
      scheduledDate = new Date(slotParts[0]);
      const slotString = slotParts[1] || null;
      
      if (slotString) {
        let startTime = "";
        let endTime = "";
        const parenMatch = slotString.match(/\(([^)]+)\)/);
        if (parenMatch) {
          const times = parenMatch[1].split("-");
          startTime = times[0].trim();
          endTime = times[1].trim();
        } else if (slotString.includes("–") || slotString.includes("-")) {
          const separator = slotString.includes("–") ? "–" : "-";
          const timeParts = slotString.split(separator);
          startTime = timeParts[0].trim();
          endTime = timeParts[1].trim();
        }
        scheduledSlotObj = { start: startTime, end: endTime, label: slotString };
      }
    }

    startDate = scheduledDate;
    const endDate = moment(startDate).add(cart.items[0].rentalMonths, "months").toDate();

    // Prepare cart items
    cartItemsData = cart.items.map((item) => ({
      product: item.product._id,
      quantity: item.quantity,
      rentalMonths: item.rentalMonths,
      pricing: item.pricing,
      totals: item.totals,
    }));

    const multiItemDetails = cart.items.map((item) => ({
      productId: item.product._id,
      productName: item.product.basicInfo.name,
      quantity: item.quantity,
      rentalMonths: item.rentalMonths,
      monthlyRent: item.product.pricing.monthlyRent,
      totalAmount: item.totals.lineTotal,
    }));

    vendorId = products[0].vendor;

    // Create rental
    const rentalNumber = this.generateRentalNumber();
    const rental = await Rental.create([{
      rentalNumber,
      user: userId,
      vendor: vendorId,
      product: products[0]._id,
      cart: cartId,
      cartItems: cartItemsData,
      inventory: inventoryItems.map((i) => i._id),
      address: addressId,
      addressDetails: {
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        country: address.country || "India",
        type: address.addressType || address.type,
        contactName: address.contactDetails?.name,
        contactPhone: address.contactDetails?.phone,
      },
      rentalDetails: {
        startDate,
        endDate,
        tenureMonths: cart.items[0].rentalMonths,
        monthlyRent: products[0].pricing.monthlyRent,
        securityDeposit: securityDeposit,
        deliveryCharges: deliveryCharges,
        discount: cartCoupon
          ? {
              type: cartCoupon.type === 'percentage' ? 'percentage' : 'fixed',
              value: cartCoupon.value,
              amount: discountAmount,
              couponCode: cartCoupon.code,
            }
          : undefined,
        subtotal: subtotal,
        tax: tax,
        totalAmount: totalAmount,
      },
      multiItemDetails: multiItemDetails,
      payment: { dueAmount: totalAmount, paidAmount: 0, status: "pending" },
      specialRequests: options.specialRequests || "",
      status: "pending",
      timeline: [{
        status: "pending",
        timestamp: new Date(),
        note: "Rental request created from cart",
        updatedBy: userId,
      }],
      metadata: { createdBy: userId, source: "web" },
    }], { session });

    createdRental = rental[0];

    // Reserve inventory
    for (let i = 0; i < inventoryItems.length; i++) {
      inventoryItems[i].status = "reserved";
      inventoryItems[i].currentRental = createdRental._id;
      await inventoryItems[i].save({ session });
    }

    // Update product availability
    for (const item of productAvailability) {
      await Product.findByIdAndUpdate(
        item.product._id,
        { $inc: { "inventory.availableQuantity": -item.quantity } },
        { session }
      );
    }

    // Create delivery record
    if (deliverySlot || options.createDelivery !== false) {
      const deliveryNumber = `DLV${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`;
      await Delivery.create([{
        deliveryNumber,
        rental: createdRental._id,
        type: "delivery",
        status: "scheduled",
        priority: this.calculatePriority(createdRental, "delivery"),
        schedule: {
          requestedDate: startDate,
          scheduledDate: startDate,
          scheduledSlot: scheduledSlotObj,
          deadline: moment(startDate).add(3, "days").toDate(),
        },
        address: addressId,
        contact: {
          name: address.contactDetails?.name || "Customer",
          phone: address.contactDetails?.phone || "",
          email: address.contactDetails?.email || "",
        },
        items: deliveryItems,
        route: null,
        metadata: {
          createdBy: userId,
          source: "web",
          notes: options.deliveryNotes || "Delivery from cart order",
          tags: ["cart-order", "multi-item"],
        },
      }], { session });
    }

    // Record coupon redemption inside the same transaction so it commits
    // atomically with the rental (increments usageCount + usageHistory).
    if (cartCoupon && cartCoupon.discountId) {
      try {
        await DiscountService.recordUsage(
          cartCoupon.discountId,
          {
            userId,
            rentalId: createdRental._id,
            discountAmount,
            orderValue: subtotal,
          },
          session,
        );
      } catch (usageErr) {
        // Do not fail the whole order if usage bookkeeping fails; log for review.
        logger.error('Failed to record discount usage for rental', {
          rentalId: createdRental._id,
          couponCode: cartCoupon.code,
          error: usageErr.message,
        });
      }
    }

    // Clear cart
    cart.items = [];
    cart.reserved = false;
    cart.reservationToken = null;
    cart.coupon = null;
    cart.summary = {
      itemsCount: 0,
      totalQuantity: 0,
      monthlyRentTotal: 0,
      securityDepositTotal: 0,
      deliveryChargesTotal: 0,
      grandTotal: 0,
    };
    await cart.save({ session });

    // COMMIT TRANSACTION - THIS MUST BE THE LAST DATABASE OPERATION
    await session.commitTransaction();
    committed = true;

    // --- ALL NON-CRITICAL OPERATIONS GO HERE (AFTER COMMIT) ---
    console.log("Inventory items reserved:", inventoryItems.length);
    console.log("Rental created with ID:", createdRental._id);

    // Populate rental (this is a read operation, safe after commit)
    const populatedRental = await Rental.findById(createdRental._id)
      .populate("user", "profile.firstName profile.lastName email phone")
      .populate("vendor", "business.name")
      .populate("product", "basicInfo.name media.images")
      .populate("address")
      // .populate("cartItems.product", "basicInfo.name pricing.monthlyRent")
      .lean();

    return populatedRental;
    
  } catch (error) {
    // Only abort if transaction was started but not committed
    if (session && session.inTransaction() && !committed) {
      await session.abortTransaction();
    }
    logger.error("Error in createRentalFromCart:", error);
    throw error;
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

  /**
   * Create new rental (legacy method - keep for backward compatibility)
   */
  async createRental(userId, rentalData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        productId,
        addressId,
        startDate,
        tenureMonths,
        deliverySlot,
        couponCode,
        specialRequests,
      } = rentalData;
      console.log("deliverySlot-->", deliverySlot);

      // Get product details
      const product = await Product.findById(productId)
        .populate("vendor")
        .session(session);

      if (!product) {
        throw new AppError("Product not found", 404);
      }

      // Check if product is active
      if (!product.status.isActive) {
        throw new AppError("Product is not available for rent", 400);
      }

      // Calculate end date
      const endDate = moment(startDate).add(tenureMonths, "months").toDate();

      // Check availability
      const availability = await this.checkProductAvailability(
        productId,
        new Date(startDate),
        endDate,
      );

      if (!availability.available) {
        throw new AppError("Product is not available for selected dates", 400);
      }

      // Calculate pricing
      const pricing = this.calculateRentalPrice(
        product,
        tenureMonths,
        couponCode,
      );

      // Find available inventory item
      const inventoryItem = await Inventory.findOne({
        product: productId,
        status: "available",
      }).session(session);

      if (!inventoryItem) {
        throw new AppError("No inventory available for this product", 400);
      }

      // Validate address
      const address = await User.findOne(
        { _id: userId, "addresses._id": addressId },
        { "addresses.$": 1 },
      ).session(session);

      if (!address || !address.addresses || address.addresses.length === 0) {
        throw new AppError("Address not found", 404);
      }

      const selectedAddress = address.addresses[0];

      // Create rental
      const rentalNumber = this.generateRentalNumber();

      const rental = await Rental.create(
        [
          {
            rentalNumber,
            user: userId,
            vendor: product.vendor._id,
            product: productId,
            inventory: inventoryItem._id,
            address: addressId,
            addressDetails: selectedAddress,
            rentalDetails: {
              startDate: new Date(startDate),
              endDate,
              tenureMonths,
              monthlyRent: pricing.monthlyRent,
              securityDeposit: pricing.securityDeposit,
              deliveryCharges: pricing.deliveryCharges,
              subtotal: pricing.subtotal,
              discount: pricing.tenureDiscount,
              totalAmount: pricing.totalAmount,
            },
            payment: {
              dueAmount: pricing.totalAmount,
            },
            specialRequests,
            status: "pending",
            timeline: [
              {
                status: "pending",
                timestamp: new Date(),
                note: "Rental request created",
              },
            ],
          },
        ],
        { session },
      );

      // Reserve inventory
      inventoryItem.status = "reserved";
      inventoryItem.currentRental = rental[0]._id;
      await inventoryItem.save({ session });

      // Update product availability
      product.inventory.availableQuantity -= 1;
      await product.save({ session });

      // Create delivery record
      if (deliverySlot) {
        await Delivery.create(
          [
            {
              rental: rental[0]._id,
              type: "delivery",
              status: "scheduled",
              schedule: {
                requestedDate: new Date(startDate),
                scheduledDate: new Date(startDate),
                scheduledSlot: deliverySlot,
              },
              address: addressId,
              items: [
                {
                  product: productId,
                  inventory: inventoryItem._id,
                  quantity: 1,
                },
              ],
            },
          ],
          { session },
        );
      }

      await session.commitTransaction();

      // Emit event
      eventEmitter.emit(EVENTS.RENTAL.CREATED, {
        rentalId: rental[0]._id,
        rentalNumber: rental[0].rentalNumber,
        userId,
        vendorId: product.vendor._id,
        productId,
        amount: pricing.totalAmount,
      });

      // Schedule confirmation reminder
      await addJob("rental", "confirmation-reminder", {
        rentalId: rental[0]._id,
        vendorId: product.vendor._id,
        scheduledAt: moment().add(24, "hours").toDate(),
      });

      return rental[0];
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error in createRental:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get rental by ID
   */
  async getRental(rentalId, userId, userRole = "user") {
    try {
      const cacheKey = `rental:${rentalId}`;

      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const rental = await Rental.findById(rentalId)
        .populate("user", "profile.firstName profile.lastName email phone")
        .populate("vendor", "business.name business.description")
        .populate({
          path: "product",
          populate: {
            path: "category",
            select: "name",
          },
        })
        .populate("address")
        .populate("inventory")
        // .populate({
        //   path: 'payments',
        //   options: { sort: { createdAt: -1 } }
        // })
        .populate("payment.paymentHistory")
        .populate({
          path: "delivery",
          options: { sort: { createdAt: -1 } },
        })
        .populate({
          path: "maintenance",
          options: { sort: { createdAt: -1 }, limit: 5 },
        })
        .populate("reviews")
        .lean();

      if (!rental) {
        throw new AppError("Rental not found", 404);
      }

      // Check authorization
      if (
        userRole === "user" &&
        rental.user._id.toString() !== userId.toString()
      ) {
        throw new AppError("Unauthorized to view this rental", 403);
      }

      if (
        userRole === "vendor" &&
        rental.vendor._id.toString() !== userId.toString()
      ) {
        throw new AppError("Unauthorized to view this rental", 403);
      }

      // Calculate late fee if overdue
      if (
        rental.status === "active" &&
        new Date() > new Date(rental.rentalDetails.endDate)
      ) {
        rental.lateFee = this.calculateLateFee(rental, new Date());
      }

      // Get timeline
      const timeline = await this.getRentalTimeline(rentalId);

      const result = {
        ...rental,
        timeline,
      };

      // Cache the result (shorter TTL for rentals)
      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, 300, JSON.stringify(result));
      }

      return result;
    } catch (error) {
      logger.error("Error in getRental:", error);
      throw error;
    }
  }

  /**
   * Get user rentals
   */
  async getUserRentals(userId, page = 1, limit = 10, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = { user: userId };

      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate)
          query.createdAt.$gte = new Date(filters.startDate);
        if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
      }

      const [rentals, total] = await Promise.all([
        Rental.find(query)
          .populate(
            "product",
            "basicInfo.name basicInfo.slug media.images pricing.monthlyRent",
          )
          .populate("vendor", "business.name")
          .populate("address")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Rental.countDocuments(query),
      ]);

      // Get counts by status
      const statusCounts = await Rental.aggregate([
        { $match: { user: userId } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]);

      const counts = {
        total,
        ...statusCounts.reduce((acc, curr) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {}),
      };

      return {
        rentals,
        counts,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Error in getUserRentals:", error);
      throw error;
    }
  }

  /**
   * Get vendor rentals
   */
  async getVendorRentals(vendorId, page = 1, limit = 10, filters = {}) {
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

      const [rentals, total] = await Promise.all([
        Rental.find(query)
          .populate("user", "profile.firstName profile.lastName email phone")
          .populate("product", "basicInfo.name basicInfo.sku")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Rental.countDocuments(query),
      ]);

      // Get summary statistics
      const summary = await Rental.aggregate([
        { $match: { vendor: vendorId } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$rentalDetails.totalAmount" },
            averageValue: { $avg: "$rentalDetails.totalAmount" },
            pendingCount: {
              $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
            },
            activeCount: {
              $sum: {
                $cond: [
                  { $in: ["$status", ["confirmed", "active", "delivered"]] },
                  1,
                  0,
                ],
              },
            },
            completedCount: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
          },
        },
      ]);

      return {
        rentals,
        summary: summary[0] || {
          totalRevenue: 0,
          averageValue: 0,
          pendingCount: 0,
          activeCount: 0,
          completedCount: 0,
        },
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Error in getVendorRentals:", error);
      throw error;
    }
  }

  /**
   * Confirm rental (vendor action)
   */
  async confirmRental(rentalId, vendorId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const rental = await Rental.findOne({
        _id: rentalId,
        vendor: vendorId,
        status: "pending",
      }).session(session);

      if (!rental) {
        throw new AppError("Rental not found or cannot be confirmed", 404);
      }

      rental.status = "confirmed";
      rental.timeline.push({
        status: "confirmed",
        timestamp: new Date(),
        note: "Rental confirmed by vendor",
      });

      await rental.save({ session });

      // Update inventory status
      await Inventory.findByIdAndUpdate(
        rental.inventory,
        { status: "reserved" },
        { session },
      );

      await session.commitTransaction();

      // Emit event
      eventEmitter.emit(EVENTS.RENTAL.CONFIRMED, {
        rentalId: rental._id,
        rentalNumber: rental.rentalNumber,
        userId: rental.user,
        vendorId,
      });

      // Schedule delivery preparation
      await addJob("delivery", "prepare", {
        rentalId: rental._id,
        scheduledAt: moment(rental.rentalDetails.startDate)
          .subtract(24, "hours")
          .toDate(),
      });

      return rental;
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error in confirmRental:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Cancel rental
   */
  async cancelRental(rentalId, userId, userRole, reason) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const query = { _id: rentalId };

      if (userRole === "user") {
        query.user = userId;
      } else if (userRole === "vendor") {
        query.vendor = userId;
      }

      const rental = await Rental.findOne(query)
        .populate("user")
        .populate("vendor")
        .session(session);

      if (!rental) {
        throw new AppError("Rental not found", 404);
      }

      // Check if rental can be cancelled
      const cancellableStatuses = ["pending", "confirmed"];
      if (!cancellableStatuses.includes(rental.status)) {
        throw new AppError("Rental cannot be cancelled at this stage", 400);
      }

      // Calculate cancellation charges
      let cancellationCharge = 0;
      let refundAmount = 0;

      const daysUntilStart = moment(rental.rentalDetails.startDate).diff(
        moment(),
        "days",
      );

      if (userRole === "user") {
        // User cancellation policy
        if (daysUntilStart < 2) {
          cancellationCharge = rental.rentalDetails.totalAmount * 0.5; // 50% charge
        } else if (daysUntilStart < 7) {
          cancellationCharge = rental.rentalDetails.totalAmount * 0.25; // 25% charge
        }

        refundAmount = rental.payment.paidAmount - cancellationCharge;
      }

      rental.status = "cancelled";
      rental.cancellation = {
        requestedBy: userId,
        requestedAt: new Date(),
        reason,
        cancellationCharge,
        refundAmount,
        status: userRole === "user" ? "pending" : "approved",
      };

      rental.timeline.push({
        status: "cancelled",
        timestamp: new Date(),
        note: `Rental cancelled by ${userRole}. Reason: ${reason}`,
      });

      await rental.save({ session });

      // Release inventory
      await Inventory.findByIdAndUpdate(
        rental.inventory,
        {
          status: "available",
          currentRental: null,
        },
        { session },
      );

      // Update product availability
      await Product.findByIdAndUpdate(
        rental.product,
        { $inc: { "inventory.availableQuantity": 1 } },
        { session },
      );

      await session.commitTransaction();

      // Process refund if applicable
      if (refundAmount > 0) {
        await addJob("payment", "refund", {
          rentalId: rental._id,
          userId: rental.user._id,
          amount: refundAmount,
          reason: "Rental cancellation",
        });
      }

      // Emit event
      eventEmitter.emit(EVENTS.RENTAL.CANCELLED, {
        rentalId: rental._id,
        rentalNumber: rental.rentalNumber,
        userId: rental.user._id,
        vendorId: rental.vendor._id,
        reason,
        cancelledBy: userId,
        refundAmount,
      });

      return rental;
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error in cancelRental:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Extend rental
   */
  async extendRental(rentalId, userId, extensionMonths) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const rental = await Rental.findOne({
        _id: rentalId,
        user: userId,
        status: { $in: ["active"] },
      }).session(session);

      if (!rental) {
        throw new AppError("Active rental not found", 404);
      }

      // Check if product is available for extended period
      const newEndDate = moment(rental.rentalDetails.endDate)
        .add(extensionMonths, "months")
        .toDate();

      const availability = await this.checkProductAvailability(
        rental.product,
        rental.rentalDetails.endDate,
        newEndDate,
        rentalId,
      );

      if (!availability.available) {
        throw new AppError(
          "Product is not available for the extended period",
          400,
        );
      }

      // Calculate additional amount
      const additionalMonths = extensionMonths;
      const monthlyRate = rental.rentalDetails.monthlyRent;
      const additionalAmount = monthlyRate * additionalMonths;

      // Apply extension discount if applicable
      const product = await Product.findById(rental.product);
      const rentalOption = product.pricing.rentalOptions?.find(
        (opt) =>
          opt.months === rental.rentalDetails.tenureMonths + additionalMonths,
      );

      let discount = 0;
      if (rentalOption) {
        discount = (additionalAmount * rentalOption.discount) / 100;
      }

      const finalAmount = additionalAmount - discount;

      // Create extension request
      rental.extensions.push({
        requestedBy: userId,
        requestedDate: new Date(),
        newEndDate,
        additionalMonths,
        additionalAmount: finalAmount,
        status: "pending",
      });

      rental.status = "extension_requested";
      await rental.save({ session });

      await session.commitTransaction();

      // Emit event
      eventEmitter.emit(EVENTS.RENTAL.EXTENSION_REQUESTED, {
        rentalId: rental._id,
        rentalNumber: rental.rentalNumber,
        userId,
        vendorId: rental.vendor,
        extensionMonths,
        additionalAmount: finalAmount,
      });

      return rental;
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error in extendRental:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Approve extension (vendor action)
   */
  async approveExtension(rentalId, vendorId, extensionIndex) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const rental = await Rental.findOne({
        _id: rentalId,
        vendor: vendorId,
        status: "extension_requested",
      }).session(session);

      if (!rental) {
        throw new AppError("Rental not found or no pending extension", 404);
      }

      const extension = rental.extensions[extensionIndex];
      if (!extension || extension.status !== "pending") {
        throw new AppError("Extension request not found", 404);
      }

      // Update rental
      rental.rentalDetails.endDate = extension.newEndDate;
      rental.rentalDetails.tenureMonths += extension.additionalMonths;
      rental.rentalDetails.totalAmount += extension.additionalAmount;
      rental.status = "active";

      extension.status = "approved";
      extension.approvedBy = vendorId;
      extension.approvedAt = new Date();

      rental.timeline.push({
        status: "extended",
        timestamp: new Date(),
        note: `Rental extended by ${extension.additionalMonths} months`,
      });

      await rental.save({ session });

      await session.commitTransaction();

      // Create payment for extension
      await addJob("payment", "create", {
        userId: rental.user,
        rentalId: rental._id,
        amount: extension.additionalAmount,
        type: "extension",
      });

      // Emit event
      eventEmitter.emit(EVENTS.RENTAL.EXTENSION_APPROVED, {
        rentalId: rental._id,
        rentalNumber: rental.rentalNumber,
        userId: rental.user,
        vendorId,
        additionalMonths: extension.additionalMonths,
        newEndDate: extension.newEndDate,
      });

      return rental;
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error in approveExtension:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Mark rental as delivered
   */
  async markAsDelivered(rentalId, deliveryData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const rental = await Rental.findOne({
        _id: rentalId,
        status: "confirmed",
      }).session(session);

      if (!rental) {
        throw new AppError("Rental not found or cannot be delivered", 404);
      }

      rental.status = "delivered";
      rental.delivery = {
        ...deliveryData,
        actualDate: new Date(),
      };

      rental.timeline.push({
        status: "delivered",
        timestamp: new Date(),
        note: "Product delivered to customer",
      });

      await rental.save({ session });

      // Update delivery record
      await Delivery.findOneAndUpdate(
        { rental: rentalId, type: "delivery" },
        {
          status: "delivered",
          "tracking.actualArrival": new Date(),
          proof: deliveryData.proof,
        },
        { session },
      );

      await session.commitTransaction();

      // Schedule return reminder
      const returnDate = moment(rental.rentalDetails.endDate)
        .subtract(3, "days")
        .toDate();
      await addJob("rental", "return-reminder", {
        rentalId: rental._id,
        userId: rental.user,
        scheduledAt: returnDate,
      });

      // Schedule review reminder
      await addJob("rental", "review-reminder", {
        rentalId: rental._id,
        userId: rental.user,
        scheduledAt: moment(rental.rentalDetails.endDate)
          .add(1, "day")
          .toDate(),
      });

      // Emit event
      eventEmitter.emit(EVENTS.RENTAL.DELIVERED, {
        rentalId: rental._id,
        rentalNumber: rental.rentalNumber,
        userId: rental.user,
        vendorId: rental.vendor,
      });

      return rental;
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error in markAsDelivered:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Mark rental as active (after delivery confirmation)
   */
  async markAsActive(rentalId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const rental = await Rental.findOne({
        _id: rentalId,
        status: "delivered",
      }).session(session);

      if (!rental) {
        throw new AppError("Rental not found or cannot be activated", 404);
      }

      rental.status = "active";
      rental.timeline.push({
        status: "active",
        timestamp: new Date(),
        note: "Rental period started",
      });

      await rental.save({ session });

      // Update inventory status
      await Inventory.findByIdAndUpdate(
        rental.inventory,
        { status: "rented" },
        { session },
      );

      await session.commitTransaction();

      // Schedule payment reminders
      const nextPaymentDate = moment(rental.rentalDetails.startDate)
        .add(1, "month")
        .toDate();
      await addJob("payment", "reminder", {
        rentalId: rental._id,
        userId: rental.user,
        amount: rental.rentalDetails.monthlyRent,
        scheduledAt: moment(nextPaymentDate).subtract(3, "days").toDate(),
      });

      // Emit event
      eventEmitter.emit(EVENTS.RENTAL.ACTIVE, {
        rentalId: rental._id,
        rentalNumber: rental.rentalNumber,
        userId: rental.user,
        vendorId: rental.vendor,
      });

      return rental;
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error in markAsActive:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Initiate return
   */
  async initiateReturn(rentalId, userId, returnData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const rental = await Rental.findOne({
        _id: rentalId,
        user: userId,
        status: "active",
      }).session(session);

      if (!rental) {
        throw new AppError("Active rental not found", 404);
      }

      const { returnDate, returnSlot, condition, images, notes } = returnData;

      rental.status = "return_initiated";
      rental.returnDetails = {
        requestedDate: new Date(),
        scheduledDate: new Date(returnDate),
        scheduledSlot: returnSlot,
        condition,
        images,
        notes,
      };

      rental.timeline.push({
        status: "return_initiated",
        timestamp: new Date(),
        note: "Return requested by customer",
      });

      await rental.save({ session });

      // Create pickup delivery record
      await Delivery.create(
        [
          {
            rental: rentalId,
            type: "pickup",
            status: "scheduled",
            schedule: {
              requestedDate: new Date(returnDate),
              scheduledDate: new Date(returnDate),
              scheduledSlot: returnSlot,
            },
            address: rental.address,
            items: [
              {
                product: rental.product,
                inventory: rental.inventory,
                condition,
              },
            ],
          },
        ],
        { session },
      );

      await session.commitTransaction();

      // Emit event
      eventEmitter.emit(EVENTS.RENTAL.RETURN_SCHEDULED, {
        rentalId: rental._id,
        rentalNumber: rental.rentalNumber,
        userId,
        vendorId: rental.vendor,
        returnDate,
      });

      return rental;
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error in initiateReturn:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Complete return (vendor action)
   */
  async completeReturn(rentalId, vendorId, returnData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const rental = await Rental.findOne({
        _id: rentalId,
        vendor: vendorId,
        status: "return_initiated",
      }).session(session);

      if (!rental) {
        throw new AppError("Return request not found", 404);
      }

      const { condition, damages, images, notes } = returnData;

      // Calculate damage charges if any
      let damageCharges = 0;
      if (damages && damages.length > 0) {
        damageCharges = damages.reduce((sum, d) => sum + (d.charge || 0), 0);
      }

      // Calculate late fee if applicable
      const actualReturnDate = new Date();
      const lateFee = this.calculateLateFee(rental, actualReturnDate);

      // Calculate security deposit refund
      const securityDeposit = rental.rentalDetails.securityDeposit;
      const totalDeductions = damageCharges + lateFee;
      const depositRefund = Math.max(0, securityDeposit - totalDeductions);

      rental.status = "completed";
      rental.rentalDetails.actualEndDate = actualReturnDate;
      rental.returnDetails = {
        ...rental.returnDetails,
        actualDate: actualReturnDate,
        condition,
        damages,
        images,
        notes,
        lateFee,
        damageCharges,
        depositRefund,
      };

      rental.timeline.push({
        status: "completed",
        timestamp: new Date(),
        note: "Rental completed and product returned",
      });

      await rental.save({ session });

      // Update inventory
      const inventory = await Inventory.findById(rental.inventory).session(
        session,
      );
      inventory.status = "available";
      inventory.currentRental = null;
      inventory.condition.status = condition;
      inventory.condition.lastInspectionDate = new Date();

      if (damages && damages.length > 0) {
        inventory.condition.notes = JSON.stringify(damages);
      }

      await inventory.save({ session });

      // Update product availability
      await Product.findByIdAndUpdate(
        rental.product,
        { $inc: { "inventory.availableQuantity": 1 } },
        { session },
      );

      // Create damage payment if applicable
      if (damageCharges > 0) {
        await Payment.create(
          [
            {
              user: rental.user,
              rental: rentalId,
              amount: damageCharges,
              type: "damage_charge",
              method: "adjustment",
              status: "pending",
              metadata: { damages },
            },
          ],
          { session },
        );
      }

      // Process security deposit refund
      if (depositRefund > 0) {
        await addJob("payment", "refund-deposit", {
          userId: rental.user,
          rentalId: rental._id,
          amount: depositRefund,
        });
      }

      await session.commitTransaction();

      // Emit event
      eventEmitter.emit(EVENTS.RENTAL.COMPLETED, {
        rentalId: rental._id,
        rentalNumber: rental.rentalNumber,
        userId: rental.user,
        vendorId,
        depositRefund,
        damageCharges,
      });

      return rental;
    } catch (error) {
      await session.abortTransaction();
      logger.error("Error in completeReturn:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get rental timeline
   */
  async getRentalTimeline(rentalId) {
    try {
      const rental = await Rental.findById(rentalId);
      if (!rental) return [];

      const timeline = [...rental.timeline];

      // Add payment events
      const payments = await Payment.find({ rental: rentalId })
        .select("createdAt amount status type")
        .lean();

      payments.forEach((p) => {
        timeline.push({
          status: `payment_${p.status}`,
          timestamp: p.createdAt,
          note: `Payment of ₹${p.amount} - ${p.type}`,
          metadata: { paymentId: p._id, amount: p.amount },
        });
      });

      // Add delivery events
      const deliveries = await Delivery.find({ rental: rentalId })
        .select("createdAt status type schedule")
        .lean();

      deliveries.forEach((d) => {
        timeline.push({
          status: `delivery_${d.status}`,
          timestamp: d.createdAt,
          note: `${d.type} ${d.status}`,
          metadata: {
            deliveryId: d._id,
            scheduledDate: d.schedule?.scheduledDate,
          },
        });
      });

      // Add maintenance events
      const maintenance = await Maintenance.find({ rental: rentalId })
        .select("createdAt status issueType")
        .lean();

      maintenance.forEach((m) => {
        timeline.push({
          status: `maintenance_${m.status}`,
          timestamp: m.createdAt,
          note: `Maintenance request: ${m.issueType}`,
          metadata: { maintenanceId: m._id },
        });
      });

      // Sort by timestamp
      return timeline.sort(
        (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
      );
    } catch (error) {
      logger.error("Error in getRentalTimeline:", error);
      return [];
    }
  }

  /**
   * Get rental statistics
   */
  async getRentalStats(userId, role = "user") {
    try {
      const match = role === "user" ? { user: userId } : { vendor: userId };

      const stats = await Rental.aggregate([
        { $match: match },
        {
          $facet: {
            overview: [
              {
                $group: {
                  _id: null,
                  totalRentals: { $sum: 1 },
                  totalSpent: { $sum: "$rentalDetails.totalAmount" },
                  averageValue: { $avg: "$rentalDetails.totalAmount" },
                  activeCount: {
                    $sum: {
                      $cond: [
                        {
                          $in: [
                            "$status",
                            ["active", "confirmed", "delivered"],
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  completedCount: {
                    $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
                  },
                  cancelledCount: {
                    $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
                  },
                },
              },
            ],
            byMonth: [
              {
                $group: {
                  _id: {
                    year: { $year: "$createdAt" },
                    month: { $month: "$createdAt" },
                  },
                  count: { $sum: 1 },
                  amount: { $sum: "$rentalDetails.totalAmount" },
                },
              },
              { $sort: { "_id.year": 1, "_id.month": 1 } },
            ],
            byStatus: [
              {
                $group: {
                  _id: "$status",
                  count: { $sum: 1 },
                  amount: { $sum: "$rentalDetails.totalAmount" },
                },
              },
            ],
            byCategory: [
              {
                $lookup: {
                  from: "products",
                  localField: "product",
                  foreignField: "_id",
                  as: "product",
                },
              },
              { $unwind: "$product" },
              {
                $lookup: {
                  from: "categories",
                  localField: "product.category",
                  foreignField: "_id",
                  as: "category",
                },
              },
              { $unwind: "$category" },
              {
                $group: {
                  _id: "$category.name",
                  count: { $sum: 1 },
                  amount: { $sum: "$rentalDetails.totalAmount" },
                },
              },
              { $sort: { count: -1 } },
              { $limit: 5 },
            ],
          },
        },
      ]);

      return (
        stats[0] || {
          overview: [
            {
              totalRentals: 0,
              totalSpent: 0,
              averageValue: 0,
              activeCount: 0,
              completedCount: 0,
              cancelledCount: 0,
            },
          ],
          byMonth: [],
          byStatus: [],
          byCategory: [],
        }
      );
    } catch (error) {
      logger.error("Error in getRentalStats:", error);
      throw error;
    }
  }

  /**
   * Check for overdue rentals (cron job)
   */
  async checkOverdueRentals() {
    try {
      const overdueRentals = await Rental.find({
        status: "active",
        "rentalDetails.endDate": { $lt: new Date() },
      })
        .populate("user")
        .populate("vendor");

      for (const rental of overdueRentals) {
        const daysOverdue = moment().diff(
          moment(rental.rentalDetails.endDate),
          "days",
        );
        const lateFee = this.calculateLateFee(rental, new Date());

        rental.status = "overdue";
        rental.lateFee = lateFee;
        await rental.save();

        // Emit event
        eventEmitter.emit(EVENTS.RENTAL.OVERDUE, {
          rentalId: rental._id,
          rentalNumber: rental.rentalNumber,
          userId: rental.user._id,
          vendorId: rental.vendor._id,
          daysOverdue,
          lateFee,
        });

        // Send notification
        await addJob("notification", "create", {
          userId: rental.user._id,
          type: "in_app",
          title: "⚠️ Rental Overdue",
          content: `Your rental #${rental.rentalNumber} is overdue by ${daysOverdue} days. Late fee: ₹${lateFee}`,
          data: { rentalId: rental._id, daysOverdue, lateFee },
        });
      }

      return overdueRentals.length;
    } catch (error) {
      logger.error("Error in checkOverdueRentals:", error);
      throw error;
    }
  }

  /**
   * Generate rental invoice
   */
  async generateInvoice(rentalId) {
    try {
      const rental = await Rental.findById(rentalId)
        .populate("user", "profile.firstName profile.lastName email phone")
        .populate("vendor", "business.name business.gstin")
        .populate("product", "basicInfo.name basicInfo.sku")
        .populate("payment.paymentHistory")
        .lean();

      console.log("vendor--->", rental.payment);

      if (!rental) {
        throw new AppError("Rental not found", 404);
      }

      const invoice = {
        invoiceNumber: `INV-${rental.rentalNumber}`,
        date: new Date(),
        rental: {
          number: rental.rentalNumber,
          startDate: rental.rentalDetails.startDate,
          endDate: rental.rentalDetails.endDate,
          status: rental.status,
        },
        customer: {
          name: `${rental.user.profile.firstName} ${rental.user.profile.lastName}`,
          email: rental.user.email,
          phone: rental.user.phone,
        },
        vendor: {
          name: rental.vendor.business.name,
          gstin: rental.vendor.business.gstin,
        },
        product: {
          name: rental.product.basicInfo.name,
          sku: rental.product.basicInfo.sku,
        },
        charges: {
          monthlyRent: rental.rentalDetails.monthlyRent,
          tenureMonths: rental.rentalDetails.tenureMonths,
          subtotal: rental.rentalDetails.subtotal,
          discount: rental.rentalDetails.discount || 0,
          securityDeposit: rental.rentalDetails.securityDeposit,
          deliveryCharges: rental.rentalDetails.deliveryCharges,
          total: rental.rentalDetails.totalAmount,
          paid: rental.payment.paidAmount,
          due: rental.payment.dueAmount,
        },
        payments: rental.payment.paymentHistory.map((p) => ({
          date: p.createdAt,
          amount: p.amount,
          method: p.method,
          status: p.status,
        })),
      };

      return invoice;
    } catch (error) {
      logger.error("Error in generateInvoice:", error);
      throw error;
    }
  }

  /**
   * Invalidate rental cache
   */
  async invalidateRentalCache(rentalId) {
    try {
      if (this.redisClient) {
        const patterns = [
          `rental:${rentalId}`,
          `rental:${rentalId}:*`,
          "rentals:user:*",
          "rentals:vendor:*",
        ];

        for (const pattern of patterns) {
          const keys = await this.redisClient.keys(pattern);
          if (keys.length > 0) {
            await this.redisClient.del(keys);
          }
        }
      }
    } catch (error) {
      logger.error("Error invalidating rental cache:", error);
    }
  }
}

module.exports = new RentalService();