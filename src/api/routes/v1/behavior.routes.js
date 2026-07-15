const express = require('express');
const router = express.Router();
const behaviorController = require('../../controllers/behavior.controller');
const { protect } = require('../../middlewares/auth.middleware');
const { body } = require('express-validator');

// Public / optional-auth event tracking
router.post('/events',
  [
    body('eventType').notEmpty(),
    body('sessionId').optional().isString(),
    body('productId').optional().isMongoId(),
  ],
  protect,
  behaviorController.trackEvent,
);

// Wishlist (authenticated users)
router.use(protect);
router.get('/wishlist', behaviorController.getWishlist);
router.post('/wishlist', [body('productId').isMongoId()], behaviorController.addWishlist);
router.delete('/wishlist/:productId', behaviorController.removeWishlist);

module.exports = router;
