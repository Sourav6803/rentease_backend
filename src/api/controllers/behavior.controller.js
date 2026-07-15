const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const BehaviorTrackingService = require('../../services/behavior-tracking.service');

class BehaviorController {
  trackEvent = catchAsync(async (req, res) => {
    const event = await BehaviorTrackingService.trackEvent(req.body, req.user?._id);
    return ApiResponse.created(res, 'Event tracked', { event });
  });

  getWishlist = catchAsync(async (req, res) => {
    const items = await BehaviorTrackingService.getUserWishlist(req.user._id);
    return ApiResponse.success(res, 200, 'Wishlist retrieved', { items });
  });

  addWishlist = catchAsync(async (req, res) => {
    const item = await BehaviorTrackingService.addToWishlist(req.user._id, req.body.productId, req.body.source);
    return ApiResponse.created(res, 'Added to wishlist', { item });
  });

  removeWishlist = catchAsync(async (req, res) => {
    await BehaviorTrackingService.removeFromWishlist(req.user._id, req.params.productId);
    return ApiResponse.success(res, 200, 'Removed from wishlist');
  });
}

module.exports = new BehaviorController();
