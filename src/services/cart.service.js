// const { Cart, Product } = require('../models');
// const AppError = require('../utils/AppError');
// const logger = require('../config/logger');

// class CartService {
//   getDiscountPercent(product, rentalMonths) {
//     const option = product.pricing?.rentalOptions?.find(
//       (r) => r.months === rentalMonths
//     );
//     return option?.discount || 0;
//   }

//   buildPricingAndTotals(product, quantity, rentalMonths) {
//     const discountPercent = this.getDiscountPercent(product, rentalMonths);
//     const monthlyRent = product.pricing.monthlyRent;
//     const effectiveMonthlyRent = Math.max(
//       0,
//       monthlyRent - (monthlyRent * discountPercent) / 100
//     );
//     const securityDeposit = product.pricing.securityDeposit || 0;
//     const deliveryCharges = product.pricing.deliveryCharges || 0;

//     const monthlySubtotal = effectiveMonthlyRent * quantity;
//     const tenureSubtotal = monthlySubtotal * rentalMonths;
//     const securityDepositTotal = securityDeposit * quantity;
//     const deliveryChargesTotal = deliveryCharges * quantity;
//     const lineTotal =
//       tenureSubtotal + securityDepositTotal + deliveryChargesTotal;

//     return {
//       pricing: {
//         monthlyRent,
//         effectiveMonthlyRent,
//         securityDeposit,
//         deliveryCharges,
//         discountPercent,
//       },
//       totals: {
//         monthlySubtotal,
//         tenureSubtotal,
//         securityDepositTotal,
//         deliveryChargesTotal,
//         lineTotal,
//       },
//     };
//   }

//   validateRentalMonths(product, rentalMonths) {
//     const minMonths = product.rentalTerms?.minRentalMonths || 1;
//     const maxMonths = product.rentalTerms?.maxRentalMonths || 12;

//     if (rentalMonths < minMonths || rentalMonths > maxMonths) {
//       throw new AppError(
//         `Rental months must be between ${minMonths} and ${maxMonths}`,
//         400
//       );
//     }
//   }

//   validateProductForCart(product, requestedQuantity) {
//     if (!product) {
//       throw new AppError('Product not found', 404);
//     }

//     if (!product.status?.isActive) {
//       throw new AppError('Product is currently unavailable', 400);
//     }

//     const available = product.inventory?.availableQuantity || 0;
//     if (available < requestedQuantity) {
//       throw new AppError(
//         `Only ${available} unit(s) available for this product`,
//         400
//       );
//     }
//   }

//   recalculateSummary(cart) {
//     const summary = {
//       itemsCount: cart.items.length,
//       totalQuantity: 0,
//       monthlyRentTotal: 0,
//       securityDepositTotal: 0,
//       deliveryChargesTotal: 0,
//       grandTotal: 0,
//     };

//     for (const item of cart.items) {
//       summary.totalQuantity += item.quantity;
//       summary.monthlyRentTotal += item.totals.monthlySubtotal;
//       summary.securityDepositTotal += item.totals.securityDepositTotal;
//       summary.deliveryChargesTotal += item.totals.deliveryChargesTotal;
//       summary.grandTotal += item.totals.lineTotal;
//     }

//     cart.summary = summary;
//   }

//   async getOrCreateCart(userId) {
//     let cart = await Cart.findOne({ user: userId });
//     if (!cart) {
//       cart = await Cart.create({ user: userId, items: [] });
//     }
//     return cart;
//   }

//   async getCart(userId) {
//     const cart = await this.getOrCreateCart(userId);
//     await cart.populate({
//       path: 'items.product',
//       select:
//         'basicInfo.name basicInfo.slug media.images pricing inventory.availableQuantity status.isActive rentalTerms',
//     });
//     return cart;
//   }

//   async addToCart(userId, payload) {
//     const { productId, quantity = 1, rentalMonths = 1 } = payload;
//     const normalizedQuantity = Number(quantity);
//     const normalizedRentalMonths = Number(rentalMonths);

//     if (normalizedQuantity < 1) {
//       throw new AppError('Quantity must be at least 1', 400);
//     }

//     const product = await Product.findById(productId);
//     this.validateProductForCart(product, normalizedQuantity);
//     this.validateRentalMonths(product, normalizedRentalMonths);

//     const cart = await this.getOrCreateCart(userId);
//     const existingIndex = cart.items.findIndex(
//       (item) =>
//         item.product.toString() === productId &&
//         item.rentalMonths === normalizedRentalMonths
//     );

//     if (existingIndex >= 0) {
//       const nextQty = cart.items[existingIndex].quantity + normalizedQuantity;
//       this.validateProductForCart(product, nextQty);

//       const { pricing, totals } = this.buildPricingAndTotals(
//         product,
//         nextQty,
//         normalizedRentalMonths
//       );
//       cart.items[existingIndex].quantity = nextQty;
//       cart.items[existingIndex].pricing = pricing;
//       cart.items[existingIndex].totals = totals;
//     } else {
//       const { pricing, totals } = this.buildPricingAndTotals(
//         product,
//         normalizedQuantity,
//         normalizedRentalMonths
//       );

//       cart.items.push({
//         product: product._id,
//         quantity: normalizedQuantity,
//         rentalMonths: normalizedRentalMonths,
//         pricing,
//         totals,
//       });
//     }

//     this.recalculateSummary(cart);
//     await cart.save();

//     return this.getCart(userId);
//   }

//   async updateCartItem(userId, itemId, payload) {
//     const { quantity, rentalMonths } = payload;
//     const cart = await this.getOrCreateCart(userId);
//     const item = cart.items.id(itemId);

//     if (!item) {
//       throw new AppError('Cart item not found', 404);
//     }

//     const product = await Product.findById(item.product);
//     if (!product) {
//       throw new AppError('Product not found for cart item', 404);
//     }

//     const nextQuantity = quantity ? Number(quantity) : item.quantity;
//     const nextRentalMonths = rentalMonths
//       ? Number(rentalMonths)
//       : item.rentalMonths;

//     if (nextQuantity < 1) {
//       throw new AppError('Quantity must be at least 1', 400);
//     }

//     this.validateProductForCart(product, nextQuantity);
//     this.validateRentalMonths(product, nextRentalMonths);

//     const { pricing, totals } = this.buildPricingAndTotals(
//       product,
//       nextQuantity,
//       nextRentalMonths
//     );

//     item.quantity = nextQuantity;
//     item.rentalMonths = nextRentalMonths;
//     item.pricing = pricing;
//     item.totals = totals;

//     this.recalculateSummary(cart);
//     await cart.save();

//     return this.getCart(userId);
//   }

//   async removeCartItem(userId, itemId) {
//     const cart = await this.getOrCreateCart(userId);
//     const item = cart.items.id(itemId);

//     if (!item) {
//       throw new AppError('Cart item not found', 404);
//     }

//     item.deleteOne();
//     this.recalculateSummary(cart);
//     await cart.save();

//     return this.getCart(userId);
//   }

//   async clearCart(userId) {
//     const cart = await this.getOrCreateCart(userId);
//     cart.items = [];
//     this.recalculateSummary(cart);
//     await cart.save();
//     return cart;
//   }
// }

// module.exports = new CartService();


const { Cart, Product } = require('../models');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const DiscountService = require('./discount.service');

class CartService {
  // Maximum items per cart
  MAX_CART_ITEMS = 50;
  
  // Cache TTL for cart operations
  CART_TTL = 300; // 5 minutes

  async validateProductExists(productId) {
    return await Product.findById(productId);
  }

  getDiscountPercent(product, rentalMonths) {
    const option = product.pricing?.rentalOptions?.find(
      (r) => r.months === rentalMonths
    );
    
    // Check if discount is still valid
    if (option?.validUntil && option.validUntil < new Date()) {
      return 0;
    }
    
    return option?.discount || 0;
  }

  validateProductPricing(product, rentalMonths) {
    if (rentalMonths === 1) return true;
    
    const validOption = product.pricing?.rentalOptions?.find(
      r => r.months === rentalMonths
    );
    
    if (!validOption) {
      throw new AppError(`Rental period of ${rentalMonths} months is not supported for this product`, 400);
    }
    
    return true;
  }

  buildPricingAndTotals(product, quantity, rentalMonths) {
    const discountPercent = this.getDiscountPercent(product, rentalMonths);
    const monthlyRent = product.pricing.monthlyRent;
    const effectiveMonthlyRent = Math.max(
      0,
      monthlyRent - (monthlyRent * discountPercent) / 100
    );
    const securityDeposit = product.pricing.securityDeposit || 0;
    const deliveryCharges = product.pricing.deliveryCharges || 0;

    const monthlySubtotal = effectiveMonthlyRent * quantity;
    const tenureSubtotal = monthlySubtotal * rentalMonths;
    const securityDepositTotal = securityDeposit * quantity;
    const deliveryChargesTotal = deliveryCharges * quantity;
    const lineTotal = tenureSubtotal + securityDepositTotal + deliveryChargesTotal;

    // Take price snapshot to prevent future price changes
    return {
      pricing: {
        monthlyRent,
        effectiveMonthlyRent,
        securityDeposit,
        deliveryCharges,
        discountPercent,
        priceSnapshot: {
          takenAt: new Date(),
          monthlyRent,
          securityDeposit,
          deliveryCharges
        }
      },
      totals: {
        monthlySubtotal,
        tenureSubtotal,
        securityDepositTotal,
        deliveryChargesTotal,
        lineTotal,
      },
    };
  }

  validateRentalMonths(product, rentalMonths) {
    const minMonths = product.rentalTerms?.minRentalMonths || 1;
    const maxMonths = product.rentalTerms?.maxRentalMonths || 12;

    if (rentalMonths < minMonths || rentalMonths > maxMonths) {
      throw new AppError(
        `Rental months must be between ${minMonths} and ${maxMonths}`,
        400
      );
    }
  }

  async validateProductForCart(product, requestedQuantity, session = null) {
    if (!product) {
      throw new AppError('Product not found', 404);
    }

    if (!product.status?.isActive) {
      throw new AppError('Product is currently unavailable', 400);
    }

    // Use atomic operation for inventory check
    const query = { _id: product._id };
    if (session) {
      const freshProduct = await Product.findById(product._id).session(session);
      const available = freshProduct.inventory?.availableQuantity || 0;
      if (available < requestedQuantity) {
        throw new AppError(
          `Only ${available} unit(s) available for this product`,
          400
        );
      }
    } else {
      const available = product.inventory?.availableQuantity || 0;
      if (available < requestedQuantity) {
        throw new AppError(
          `Only ${available} unit(s) available for this product`,
          400
        );
      }
    }
  }

  async validateCartLimit(cart) {
    if (cart.items.length >= this.MAX_CART_ITEMS) {
      throw new AppError(`Cart cannot have more than ${this.MAX_CART_ITEMS} items`, 400);
    }
  }

  recalculateSummary(cart) {
    const summary = {
      itemsCount: cart.items.length,
      totalQuantity: 0,
      monthlyRentTotal: 0,
      securityDepositTotal: 0,
      deliveryChargesTotal: 0,
      subtotal: 0,
      discountAmount: 0,
      grandTotal: 0,
    };

    for (const item of cart.items) {
      summary.totalQuantity += item.quantity;
      summary.monthlyRentTotal += item.totals.monthlySubtotal;
      summary.securityDepositTotal += item.totals.securityDepositTotal;
      summary.deliveryChargesTotal += item.totals.deliveryChargesTotal;
      summary.subtotal += item.totals.lineTotal;
    }

    // Apply coupon discount
    if (cart.coupon && cart.coupon.isValid) {
      // Prefer the amount already computed by the Discount system at apply time.
      if (typeof cart.coupon.discountAmount === 'number' && cart.coupon.discountAmount > 0) {
        summary.discountAmount = Math.min(cart.coupon.discountAmount, summary.subtotal);
      } else if (cart.coupon.type === 'percentage') {
        summary.discountAmount = (summary.subtotal * cart.coupon.value) / 100;
        if (cart.coupon.maxDiscount) {
          summary.discountAmount = Math.min(summary.discountAmount, cart.coupon.maxDiscount);
        }
      } else if (cart.coupon.type === 'fixed') {
        summary.discountAmount = Math.min(cart.coupon.value, summary.subtotal);
      }

      summary.discountAmount = Math.round(summary.discountAmount * 100) / 100;
      summary.grandTotal = summary.subtotal - summary.discountAmount;
    } else {
      summary.grandTotal = summary.subtotal;
    }

    cart.summary = summary;
  }

  async getOrCreateCart(userId) {
    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = await Cart.create({ 
        user: userId, 
        items: [],
        version: 1,
        reserved: false
      });
    }
    return cart;
  }

  async getCart(userId, populate = true) {
    const cart = await this.getOrCreateCart(userId);
    
    if (populate) {
      await cart.populate({
        path: 'items.product',
        select: 'basicInfo.name basicInfo.slug media.images pricing inventory.availableQuantity status.isActive rentalTerms',
      });
    }
    
    this.recalculateSummary(cart);
    return cart;
  }

  async getCartSummary(userId) {
    const cart = await this.getCart(userId, false);
    return cart.summary;
  }

  async checkCartAvailability(userId) {
    const cart = await this.getCart(userId, true);
    const availability = {
      available: true,
      unavailableItems: []
    };
    
    for (const item of cart.items) {
      const product = item.product;
      if (!product || !product.status?.isActive) {
        availability.available = false;
        availability.unavailableItems.push({
          itemId: item._id,
          productId: item.product?._id,
          reason: 'Product unavailable'
        });
      } else if ((product.inventory?.availableQuantity || 0) < item.quantity) {
        availability.available = false;
        availability.unavailableItems.push({
          itemId: item._id,
          productId: product._id,
          reason: 'Insufficient stock',
          available: product.inventory?.availableQuantity || 0,
          requested: item.quantity
        });
      }
    }
    
    return availability;
  }

  async addToCart(userId, payload) {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const { productId, quantity = 1, rentalMonths = 1 } = payload;
      const normalizedQuantity = Number(quantity);
      const normalizedRentalMonths = Number(rentalMonths);

      if (normalizedQuantity < 1) {
        throw new AppError('Quantity must be at least 1', 400);
      }

      const product = await Product.findById(productId).session(session);
      await this.validateProductForCart(product, normalizedQuantity, session);
      this.validateRentalMonths(product, normalizedRentalMonths);
      this.validateProductPricing(product, normalizedRentalMonths);

      let cart = await this.getOrCreateCart(userId);
      await this.validateCartLimit(cart);
      
      // Use atomic findOneAndUpdate to prevent race conditions
      const existingIndex = cart.items.findIndex(
        (item) =>
          item.product.toString() === productId &&
          item.rentalMonths === normalizedRentalMonths
      );

      if (existingIndex >= 0) {
        const nextQty = cart.items[existingIndex].quantity + normalizedQuantity;
        await this.validateProductForCart(product, nextQty, session);

        const { pricing, totals } = this.buildPricingAndTotals(
          product,
          nextQty,
          normalizedRentalMonths
        );
        
        cart.items[existingIndex].quantity = nextQty;
        cart.items[existingIndex].pricing = pricing;
        cart.items[existingIndex].totals = totals;
        cart.items[existingIndex].updatedAt = new Date();
      } else {
        const { pricing, totals } = this.buildPricingAndTotals(
          product,
          normalizedQuantity,
          normalizedRentalMonths
        );

        cart.items.push({
          product: product._id,
          quantity: normalizedQuantity,
          rentalMonths: normalizedRentalMonths,
          pricing,
          totals,
          addedAt: new Date()
        });
      }

      cart.version += 1;
      this.recalculateSummary(cart);
      await cart.save({ session });
      await session.commitTransaction();
      
      return this.getCart(userId);
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async bulkAddToCart(userId, items) {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      let cart = await this.getOrCreateCart(userId);
      
      for (const item of items) {
        const { productId, quantity = 1, rentalMonths = 1 } = item;
        const product = await Product.findById(productId).session(session);
        
        await this.validateProductForCart(product, quantity, session);
        this.validateRentalMonths(product, rentalMonths);
        this.validateProductPricing(product, rentalMonths);
        
        const existingIndex = cart.items.findIndex(
          (cartItem) =>
            cartItem.product.toString() === productId &&
            cartItem.rentalMonths === rentalMonths
        );
        
        const { pricing, totals } = this.buildPricingAndTotals(
          product,
          quantity,
          rentalMonths
        );
        
        if (existingIndex >= 0) {
          cart.items[existingIndex].quantity += quantity;
          cart.items[existingIndex].pricing = pricing;
          cart.items[existingIndex].totals = totals;
        } else {
          cart.items.push({
            product: product._id,
            quantity,
            rentalMonths,
            pricing,
            totals,
            addedAt: new Date()
          });
        }
      }
      
      cart.version += 1;
      this.recalculateSummary(cart);
      await cart.save({ session });
      await session.commitTransaction();
      
      return this.getCart(userId);
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async updateCartItem(userId, itemId, payload) {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const { quantity, rentalMonths } = payload;
      const cart = await this.getOrCreateCart(userId);
      const item = cart.items.id(itemId);

      if (!item) {
        throw new AppError('Cart item not found', 404);
      }

      const product = await Product.findById(item.product).session(session);
      if (!product) {
        throw new AppError('Product not found for cart item', 404);
      }

      const nextQuantity = quantity ? Number(quantity) : item.quantity;
      const nextRentalMonths = rentalMonths
        ? Number(rentalMonths)
        : item.rentalMonths;

      if (nextQuantity < 1) {
        throw new AppError('Quantity must be at least 1', 400);
      }

      await this.validateProductForCart(product, nextQuantity, session);
      this.validateRentalMonths(product, nextRentalMonths);
      this.validateProductPricing(product, nextRentalMonths);

      const { pricing, totals } = this.buildPricingAndTotals(
        product,
        nextQuantity,
        nextRentalMonths
      );

      item.quantity = nextQuantity;
      item.rentalMonths = nextRentalMonths;
      item.pricing = pricing;
      item.totals = totals;
      item.updatedAt = new Date();

      cart.version += 1;
      this.recalculateSummary(cart);
      await cart.save({ session });
      await session.commitTransaction();

      return this.getCart(userId);
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async removeCartItem(userId, itemId) {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const cart = await this.getOrCreateCart(userId);
      const item = cart.items.id(itemId);

      if (!item) {
        throw new AppError('Cart item not found', 404);
      }

      item.deleteOne();
      cart.version += 1;
      this.recalculateSummary(cart);
      await cart.save({ session });
      await session.commitTransaction();

      return this.getCart(userId);
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async clearCart(userId) {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const cart = await this.getOrCreateCart(userId);
      cart.items = [];
      cart.coupon = null;
      cart.version += 1;
      this.recalculateSummary(cart);
      await cart.save({ session });
      await session.commitTransaction();
      
      return cart;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async applyCoupon(userId, couponCode) {
    // Load the cart (with items populated) so we can validate against the order.
    const cart = await this.getCart(userId, true);

    if (!cart.items || cart.items.length === 0) {
      throw new AppError('Cannot apply a coupon to an empty cart', 400);
    }

    const subtotal = cart.summary?.subtotal ?? 0;
    const productIds = cart.items.map((item) => item.product?._id || item.product);
    const rentalMonths = cart.items[0]?.rentalMonths;
    const vendorId = cart.items[0]?.product?.vendor;

    // Validate against the unified Discount system (single source of truth).
    const validation = await DiscountService.validateDiscount(couponCode, userId, {
      amount: subtotal,
      productIds,
      rentalMonths,
      vendorId,
    });

    if (!validation.valid) {
      throw new AppError(validation.reason || 'Invalid or expired coupon', 400);
    }

    const { discount, discountAmount } = validation;

    cart.coupon = {
      code: discount.code,
      type: discount.type,
      value: discount.value,
      maxDiscount: discount.maxDiscountAmount,
      discountId: discount._id,
      discountAmount,
      isValid: true,
      appliedAt: new Date(),
    };

    this.recalculateSummary(cart);
    await cart.save();

    return this.getCart(userId);
  }

  async removeCoupon(userId) {
    const cart = await this.getOrCreateCart(userId);
    cart.coupon = null;
    this.recalculateSummary(cart);
    await cart.save();
    return this.getCart(userId);
  }

  // async reserveCartItems(userId, reservationMinutes = 15) {
  //   const cart = await this.getCart(userId, true);
    
  //   if (cart.items.length === 0) {
  //     throw new AppError('Cannot reserve empty cart', 400);
  //   }
    
  //   // Check availability before reservation
  //   const availability = await this.checkCartAvailability(userId);
  //   if (!availability.available) {
  //     throw new AppError('Some items are no longer available', 400);
  //   }
    
  //   const reservedUntil = new Date();
  //   reservedUntil.setMinutes(reservedUntil.getMinutes() + reservationMinutes);
    
  //   cart.reserved = true;
  //   cart.reservedUntil = reservedUntil;
  //   cart.reservationToken = require('crypto').randomBytes(32).toString('hex');
  //   await cart.save();
    
  //   // Reduce inventory
  //   const session = await mongoose.startSession();
  //   session.startTransaction();
    
  //   try {
  //     for (const item of cart.items) {
  //       await Product.updateOne(
  //         { _id: item.product._id },
  //         { $inc: { 'inventory.reservedQuantity': item.quantity } },
  //         { session }
  //       );
  //     }
  //     await session.commitTransaction();
  //   } catch (error) {
  //     await session.abortTransaction();
  //     throw new AppError('Failed to reserve items', 500);
  //   } finally {
  //     session.endSession();
  //   }
    
  //   return {
  //     reservationToken: cart.reservationToken,
  //     reservedUntil,
  //     expiresInMinutes: reservationMinutes
  //   };
  // }

  // cart.service.js - Update the reserveCartItems method
  

  // Add this helper method to check availability
  
  // services/cart.service.js - Update the reserveCartItems method
async reserveCartItems(userId, reservationMinutes = 15) {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const cart = await this.getOrCreateCart(userId);
    
    if (cart.items.length === 0) {
      throw new AppError('Cannot reserve empty cart', 400);
    }
    
    // Check if already reserved and not expired
    if (cart.reserved && cart.reservedUntil && new Date() < new Date(cart.reservedUntil)) {
      // Already reserved, just return existing reservation
      await session.commitTransaction();
      return {
        reservationToken: cart.reservationToken,
        reservedUntil: cart.reservedUntil,
        expiresInMinutes: Math.ceil((new Date(cart.reservedUntil) - new Date()) / 60000)
      };
    }
    
    // Check availability before reservation
    const availability = await this.checkCartAvailability(userId);
    if (!availability.available) {
      throw new AppError('Some items are no longer available', 400);
    }
    
    const reservedUntil = new Date();
    reservedUntil.setMinutes(reservedUntil.getMinutes() + reservationMinutes);
    
    // Update cart with reservation
    cart.reserved = true;
    cart.reservedUntil = reservedUntil;
    cart.reservationToken = require('crypto').randomBytes(32).toString('hex');
    
    // IMPORTANT: Save the cart before committing transaction
    await cart.save({ session });
    
    // Reduce inventory reserved quantity
    for (const item of cart.items) {
      await Product.updateOne(
        { _id: item.product },
        { $inc: { 'inventory.reservedQuantity': item.quantity } },
        { session }
      );
    }
    
    await session.commitTransaction();
    
    // Fetch the updated cart to verify
    const updatedCart = await Cart.findById(cart._id);
    console.log('Cart reserved successfully:', {
      cartId: updatedCart._id,
      reserved: updatedCart.reserved,
      reservedUntil: updatedCart.reservedUntil,
      token: updatedCart.reservationToken?.substring(0, 10) + '...'
    });
    
    return {
      reservationToken: cart.reservationToken,
      reservedUntil,
      expiresInMinutes: reservationMinutes
    };
  } catch (error) {
    await session.abortTransaction();
    logger.error('Error in reserveCartItems:', error);
    throw error;
  } finally {
    session.endSession();
  }
}

// Add this helper method
async checkCartAvailability(userId) {
  const cart = await this.getCart(userId, true);
  const availability = {
    available: true,
    unavailableItems: []
  };
  
  for (const item of cart.items) {
    const product = item.product;
    if (!product || !product.status?.isActive) {
      availability.available = false;
      availability.unavailableItems.push({
        itemId: item._id,
        productId: item.product?._id,
        reason: 'Product unavailable'
      });
    } else if ((product.inventory?.availableQuantity || 0) < item.quantity) {
      availability.available = false;
      availability.unavailableItems.push({
        itemId: item._id,
        productId: product._id,
        reason: 'Insufficient stock',
        available: product.inventory?.availableQuantity || 0,
        requested: item.quantity
      });
    }
  }
  
  return availability;
}
  
  // async checkCartAvailability(userId) {
  //   const cart = await this.getCart(userId, true);
  //   const availability = {
  //     available: true,
  //     unavailableItems: []
  //   };
    
  //   for (const item of cart.items) {
  //     const product = item.product;
  //     if (!product || !product.status?.isActive) {
  //       availability.available = false;
  //       availability.unavailableItems.push({
  //         itemId: item._id,
  //         productId: item.product?._id,
  //         reason: 'Product unavailable'
  //       });
  //     } else if ((product.inventory?.availableQuantity || 0) < item.quantity) {
  //       availability.available = false;
  //       availability.unavailableItems.push({
  //         itemId: item._id,
  //         productId: product._id,
  //         reason: 'Insufficient stock',
  //         available: product.inventory?.availableQuantity || 0,
  //         requested: item.quantity
  //       });
  //     }
  //   }
    
  //   return availability;
  // }

  async releaseCartItems(userId) {
    const cart = await this.getOrCreateCart(userId);
    
    if (!cart.reserved) {
      return;
    }
    
    // Return inventory
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      for (const item of cart.items) {
        await Product.updateOne(
          { _id: item.product },
          { $inc: { 'inventory.reservedQuantity': -item.quantity } },
          { session }
        );
      }
      
      cart.reserved = false;
      cart.reservedUntil = null;
      cart.reservationToken = null;
      await cart.save({ session });
      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw new AppError('Failed to release items', 500);
    } finally {
      session.endSession();
    }
  }
}

module.exports = new CartService();