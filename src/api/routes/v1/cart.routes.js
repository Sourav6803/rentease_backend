
const express = require('express');
const { body, param, query } = require('express-validator');
const cartController = require('../../controllers/cart.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const { rateLimit } = require('express-rate-limit');
const { CartService } = require('../../../services/cart.service');
const Product = require('../../../models/Product.model')

const router = express.Router();

// Apply rate limiting to cart endpoints
const cartRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  skipSuccessfulRequests: true,
});

router.use(protect);
router.use(cartRateLimit);


const addToCartValidation = [
  body('productId')
    .notEmpty()
    .withMessage('Product ID is required')
    .isMongoId()
    .withMessage('Invalid product ID')
    .custom(async (productId) => {
      const product = await Product.findById(productId);
      if (!product) {
        throw new Error('Product not found');
      }
      if (!product.status?.isActive) {
        throw new Error('Product is currently unavailable');
      }
      return true;
    }),
  body('quantity')
    .optional()
    .isInt({ min: 1, max: 999 })
    .withMessage('Quantity must be between 1 and 999')
    .toInt(),
  body('rentalMonths')
    .optional()
    .isInt({ min: 1, max: 36 })
    .withMessage('Rental months must be between 1 and 36')
    .toInt()
    .custom(async (months, { req }) => {
      if (!months) return true;
      
      // Get product from previous validation or fetch it
      const product = await Product.findById(req.body.productId);
      if (!product) return true;
      
      const minMonths = product.rentalTerms?.minRentalMonths || 1;
      const maxMonths = product.rentalTerms?.maxRentalMonths || 36;
      
      if (months < minMonths || months > maxMonths) {
        throw new Error(`Rental months must be between ${minMonths} and ${maxMonths} for this product`);
      }
      
      // Check if rental period is supported
      if (months !== 1) {
        const validOption = product.pricing?.rentalOptions?.find(r => r.months === months);
        if (!validOption) {
          throw new Error(`Rental period of ${months} months is not supported for this product`);
        }
      }
      
      return true;
    }),
];

const updateCartItemValidation = [
  param('itemId')
    .isMongoId()
    .withMessage('Invalid cart item ID'),
  body('quantity')
    .optional()
    .isInt({ min: 1, max: 999 })
    .withMessage('Quantity must be between 1 and 999')
    .toInt(),
  body('rentalMonths')
    .optional()
    .isInt({ min: 1, max: 36 })
    .withMessage('Rental months must be between 1 and 36')
    .toInt(),
  body()
    .custom((value, { req }) => {
      if (req.body.quantity === undefined && req.body.rentalMonths === undefined) {
        throw new Error('At least one of quantity or rentalMonths is required');
      }
      return true;
    }),
];

const itemIdValidation = [
  param('itemId')
    .isMongoId()
    .withMessage('Invalid cart item ID'),
];

const bulkAddToCartValidation = [
  body('items')
    .isArray({ min: 1, max: 20 })
    .withMessage('Items must be an array with 1-20 items'),
  body('items.*.productId')
    .isMongoId()
    .withMessage('Invalid product ID in item'),
  body('items.*.quantity')
    .optional()
    .isInt({ min: 1, max: 999 })
    .withMessage('Quantity must be between 1 and 999')
    .toInt(),
  body('items.*.rentalMonths')
    .optional()
    .isInt({ min: 1, max: 36 })
    .withMessage('Rental months must be between 1 and 36')
    .toInt(),
];

const applyCouponValidation = [
  body('couponCode')
    .notEmpty()
    .withMessage('Coupon code is required')
    .isString()
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Coupon code must be between 3 and 50 characters'),
];

// Routes
router.get('/me', cartController.getMyCart);
router.get('/summary', cartController.getCartSummary);
router.get('/check-availability', cartController.checkCartAvailability);

router.post('/add', validate(addToCartValidation), cartController.addToCart);
router.post('/bulk/add', validate(bulkAddToCartValidation), cartController.bulkAddToCart);
router.post('/apply-coupon', validate(applyCouponValidation), cartController.applyCoupon);
router.post('/remove-coupon', cartController.removeCoupon);

router.patch('/item/:itemId', validate(updateCartItemValidation), cartController.updateCartItem);
router.delete('/item/:itemId', validate(itemIdValidation), cartController.removeCartItem);
router.delete('/clear', cartController.clearMyCart);

// Reserved items (for checkout)
router.post('/reserve', cartController.reserveCartItems);
router.post('/release', cartController.releaseCartItems);

module.exports = router;
