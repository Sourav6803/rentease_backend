// const CartService = require('../../services/cart.service');
// const catchAsync = require('../../utils/catchAsync');
// const { ApiResponse } = require('../../utils/apiResponse');

// class CartController {
//   getMyCart = catchAsync(async (req, res) => {
//     const cart = await CartService.getCart(req.user._id);
//     return ApiResponse.success(res, 200, 'Cart fetched successfully', { cart });
//   });

//   addToCart = catchAsync(async (req, res) => {
//     const cart = await CartService.addToCart(req.user._id, req.body);
//     return ApiResponse.success(res, 200, 'Item added to cart', { cart });
//   });

//   updateCartItem = catchAsync(async (req, res) => {
//     const { itemId } = req.params;
//     const cart = await CartService.updateCartItem(req.user._id, itemId, req.body);
//     return ApiResponse.success(res, 200, 'Cart item updated successfully', { cart });
//   });

//   removeCartItem = catchAsync(async (req, res) => {
//     const { itemId } = req.params;
//     const cart = await CartService.removeCartItem(req.user._id, itemId);
//     return ApiResponse.success(res, 200, 'Cart item removed successfully', { cart });
//   });

//   clearMyCart = catchAsync(async (req, res) => {
//     await CartService.clearCart(req.user._id);
//     return ApiResponse.success(res, 200, 'Cart cleared successfully');
//   });
// }

// module.exports = new CartController();


const CartService = require('../../services/cart.service');
const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const logger = require('../../config/logger');

class CartController {
  getMyCart = catchAsync(async (req, res) => {
    const { populate = 'true' } = req.query;
    const cart = await CartService.getCart(req.user._id, populate === 'true');
    
    return ApiResponse.success(res, 200, 'Cart fetched successfully', { 
      cart,
      expiresAt: cart.reservedUntil
    });
  });

  getCartSummary = catchAsync(async (req, res) => {
    const summary = await CartService.getCartSummary(req.user._id);
    return ApiResponse.success(res, 200, 'Cart summary fetched', { summary });
  });

  checkCartAvailability = catchAsync(async (req, res) => {
    const availability = await CartService.checkCartAvailability(req.user._id);
    return ApiResponse.success(res, 200, 'Cart availability checked', { availability });
  });

  addToCart = catchAsync(async (req, res) => {
    const cart = await CartService.addToCart(req.user._id, req.body);
    
    logger.info(`User ${req.user._id} added item to cart`, {
      userId: req.user._id,
      productId: req.body.productId,
      quantity: req.body.quantity
    });
    
    return ApiResponse.success(res, 200, 'Item added to cart successfully', { cart });
  });

  bulkAddToCart = catchAsync(async (req, res) => {
    const { items } = req.body;
    const cart = await CartService.bulkAddToCart(req.user._id, items);
    
    logger.info(`User ${req.user._id} added ${items.length} items to cart`);
    
    return ApiResponse.success(res, 200, 'Items added to cart successfully', { 
      cart,
      addedCount: items.length
    });
  });

  updateCartItem = catchAsync(async (req, res) => {
    const { itemId } = req.params;
    const cart = await CartService.updateCartItem(req.user._id, itemId, req.body);
    
    logger.info(`User ${req.user._id} updated cart item ${itemId}`);
    
    return ApiResponse.success(res, 200, 'Cart item updated successfully', { cart });
  });

  removeCartItem = catchAsync(async (req, res) => {
    const { itemId } = req.params;
    const cart = await CartService.removeCartItem(req.user._id, itemId);
    
    logger.info(`User ${req.user._id} removed cart item ${itemId}`);
    
    return ApiResponse.success(res, 200, 'Cart item removed successfully', { cart });
  });

  clearMyCart = catchAsync(async (req, res) => {
    await CartService.clearCart(req.user._id);
    
    logger.info(`User ${req.user._id} cleared their cart`);
    
    return ApiResponse.success(res, 200, 'Cart cleared successfully');
  });

  applyCoupon = catchAsync(async (req, res) => {
    const { couponCode } = req.body;
    const cart = await CartService.applyCoupon(req.user._id, couponCode);
    
    logger.info(`User ${req.user._id} applied coupon ${couponCode}`);
    
    return ApiResponse.success(res, 200, 'Coupon applied successfully', { cart });
  });

  removeCoupon = catchAsync(async (req, res) => {
    const cart = await CartService.removeCoupon(req.user._id);
    
    logger.info(`User ${req.user._id} removed coupon`);
    
    return ApiResponse.success(res, 200, 'Coupon removed successfully', { cart });
  });

  reserveCartItems = catchAsync(async (req, res) => {
    const { reservationMinutes = 15 } = req.body;
    const reservation = await CartService.reserveCartItems(req.user._id, reservationMinutes);
    
    logger.info(`User ${req.user._id} reserved cart items for ${reservationMinutes} minutes`);
    
    return ApiResponse.success(res, 200, 'Cart items reserved successfully', reservation);
  });

  releaseCartItems = catchAsync(async (req, res) => {
    await CartService.releaseCartItems(req.user._id);
    
    logger.info(`User ${req.user._id} released cart reservation`);
    
    return ApiResponse.success(res, 200, 'Cart reservation released');
  });
}

module.exports = new CartController();