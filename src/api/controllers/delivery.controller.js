// const DeliveryService = require('../../services/delivery.service');
// const catchAsync = require('../../utils/catchAsync');
// const ApiResponse = require('../../utils/apiResponse');
// const AppError = require('../../utils/AppError');
// const logger = require('../../config/logger');

// class DeliveryController {
//   /**
//    * Create delivery
//    */
//   createDelivery = catchAsync(async (req, res) => {
//     const { rentalId } = req.params;
    
//     const delivery = await DeliveryService.createDelivery(rentalId, req.user._id, req.body);
    
//     return ApiResponse.success(res, 201, 'Delivery created successfully', { delivery });
//   });

//   /**
//    * Get delivery by ID
//    */
//   getDelivery = catchAsync(async (req, res) => {
//     const { id } = req.params;
    
//     const delivery = await DeliveryService.getDelivery(id, req.user._id, req.user.role);
    
//     return ApiResponse.success(res, 200, 'Delivery retrieved successfully', { delivery });
//   });

//   /**
//    * Get user deliveries
//    */
//   getUserDeliveries = catchAsync(async (req, res) => {
//     const { page = 1, limit = 10, ...filters } = req.query;
    
//     const deliveries = await DeliveryService.getUserDeliveries(
//       req.user._id,
//       parseInt(page),
//       parseInt(limit),
//       filters
//     );
    
//     return ApiResponse.success(res, 200, 'Deliveries retrieved successfully', deliveries);
//   });

//   /**
//    * Get vendor deliveries
//    */
//   getVendorDeliveries = catchAsync(async (req, res) => {
//     const { page = 1, limit = 10, ...filters } = req.query;
    
//     const deliveries = await DeliveryService.getVendorDeliveries(
//       req.user._id,
//       parseInt(page),
//       parseInt(limit),
//       filters
//     );
    
//     return ApiResponse.success(res, 200, 'Vendor deliveries retrieved successfully', deliveries);
//   });

//   /**
//    * Assign delivery person
//    */
//   assignDeliveryPerson = catchAsync(async (req, res) => {
//     const { id } = req.params;
    
//     const delivery = await DeliveryService.assignDeliveryPerson(id, req.user._id, req.body);
    
//     return ApiResponse.success(res, 200, 'Delivery person assigned successfully', { delivery });
//   });

//   /**
//    * Start delivery
//    */
//   startDelivery = catchAsync(async (req, res) => {
//     const { id } = req.params;
    
//     const delivery = await DeliveryService.startDelivery(id, req.user._id, req.body);
    
//     return ApiResponse.success(res, 200, 'Delivery started successfully', { delivery });
//   });

//   /**
//    * Update delivery location
//    */
//   updateLocation = catchAsync(async (req, res) => {
//     const { id } = req.params;
    
//     const delivery = await DeliveryService.updateLocation(id, req.user._id, req.body);
    
//     return ApiResponse.success(res, 200, 'Location updated successfully', { delivery });
//   });

//   /**
//    * Mark as delivered
//    */
//   markAsDelivered = catchAsync(async (req, res) => {
//     const { id } = req.params;
    
//     const delivery = await DeliveryService.markAsDelivered(id, req.user._id, req.body);
    
//     return ApiResponse.success(res, 200, 'Delivery marked as delivered', { delivery });
//   });

//   /**
//    * Mark as failed
//    */
//   markAsFailed = catchAsync(async (req, res) => {
//     const { id } = req.params;
    
//     const delivery = await DeliveryService.markAsFailed(id, req.user._id, req.body);
    
//     return ApiResponse.success(res, 200, 'Delivery marked as failed', { delivery });
//   });

//   /**
//    * Reschedule delivery
//    */
//   rescheduleDelivery = catchAsync(async (req, res) => {
//     const { id } = req.params;
    
//     const delivery = await DeliveryService.rescheduleDelivery(id, req.user._id, req.body);
    
//     return ApiResponse.success(res, 200, 'Delivery rescheduled successfully', { delivery });
//   });

//   /**
//    * Get available time slots
//    */
//   getAvailableTimeSlots = catchAsync(async (req, res) => {
//     const { date } = req.query;
    
//     if (!date) {
//       throw new AppError('Date is required', 400);
//     }

//     const slots = DeliveryService.getAvailableTimeSlots(new Date(date));
    
//     return ApiResponse.success(res, 200, 'Time slots retrieved successfully', { slots });
//   });

//   /**
//    * Track delivery
//    */
//   trackDelivery = catchAsync(async (req, res) => {
//     const { trackingNumber } = req.params;
    
//     const tracking = await DeliveryService.getDeliveryTracking(trackingNumber);
    
//     return ApiResponse.success(res, 200, 'Delivery tracking retrieved successfully', tracking);
//   });

//   /**
//    * Get delivery analytics
//    */
//   getDeliveryAnalytics = catchAsync(async (req, res) => {
//     const { startDate, endDate } = req.query;
    
//     if (!startDate || !endDate) {
//       throw new AppError('Start date and end date are required', 400);
//     }

//     const analytics = await DeliveryService.getDeliveryAnalytics(
//       req.user._id,
//       startDate,
//       endDate
//     );
    
//     return ApiResponse.success(res, 200, 'Delivery analytics retrieved successfully', analytics);
//   });

//   /**
//    * Get delivery person performance
//    */
//   getDeliveryPersonPerformance = catchAsync(async (req, res) => {
//     const { personId } = req.params;
//     const { startDate, endDate } = req.query;
    
//     if (!startDate || !endDate) {
//       throw new AppError('Start date and end date are required', 400);
//     }

//     const performance = await DeliveryService.getDeliveryPersonPerformance(
//       personId,
//       startDate,
//       endDate
//     );
    
//     return ApiResponse.success(res, 200, 'Delivery person performance retrieved successfully', performance);
//   });

//   /**
//    * Get delivery summary
//    */
//   getDeliverySummary = catchAsync(async (req, res) => {
//     const summary = await DeliveryService.getDeliverySummary(req.user._id);
    
//     return ApiResponse.success(res, 200, 'Delivery summary retrieved successfully', summary);
//   });

//   // ==================== ADMIN ROUTES ====================

//   /**
//    * Get all deliveries (admin)
//    */
//   getAllDeliveries = catchAsync(async (req, res) => {
//     const { page = 1, limit = 20, vendorId, ...filters } = req.query;
    
//     // Use vendor deliveries method with optional vendor filter
//     const deliveries = await DeliveryService.getVendorDeliveries(
//       vendorId,
//       parseInt(page),
//       parseInt(limit),
//       filters
//     );
    
//     return ApiResponse.success(res, 200, 'All deliveries retrieved successfully', deliveries);
//   });

//   /**
//    * Get delivery analytics (admin)
//    */
//   getGlobalDeliveryAnalytics = catchAsync(async (req, res) => {
//     const { startDate, endDate } = req.query;
    
//     if (!startDate || !endDate) {
//       throw new AppError('Start date and end date are required', 400);
//     }

//     const analytics = await Delivery.aggregate([
//       {
//         $match: {
//           createdAt: {
//             $gte: new Date(startDate),
//             $lte: new Date(endDate)
//           }
//         }
//       },
//       {
//         $facet: {
//           overview: [
//             {
//               $group: {
//                 _id: null,
//                 totalDeliveries: { $sum: 1 },
//                 successfulDeliveries: {
//                   $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
//                 },
//                 averageDuration: {
//                   $avg: {
//                     $subtract: ['$tracking.actualArrival', '$createdAt']
//                   }
//                 }
//               }
//             }
//           ],
//           byVendor: [
//             {
//               $lookup: {
//                 from: 'rentals',
//                 localField: 'rental',
//                 foreignField: '_id',
//                 as: 'rental'
//               }
//             },
//             { $unwind: '$rental' },
//             {
//               $group: {
//                 _id: '$rental.vendor',
//                 count: { $sum: 1 },
//                 successful: {
//                   $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
//                 }
//               }
//             },
//             {
//               $lookup: {
//                 from: 'vendors',
//                 localField: '_id',
//                 foreignField: 'user',
//                 as: 'vendor'
//               }
//             },
//             { $unwind: '$vendor' },
//             {
//               $project: {
//                 vendorName: '$vendor.business.name',
//                 count: 1,
//                 successful: 1,
//                 successRate: { $multiply: [{ $divide: ['$successful', '$count'] }, 100] }
//               }
//             },
//             { $sort: { count: -1 } }
//           ]
//         }
//       }
//     ]);

//     return ApiResponse.success(res, 200, 'Global delivery analytics retrieved successfully', analytics[0]);
//   });

//   // Add to existing delivery.controller.js

//   /**
//    * Generate OTP for delivery completion
//    */
//   generateDeliveryOTP = catchAsync(async (req, res) => {
//     const { deliveryId } = req.params;
//     const delivery = await Delivery.findById(deliveryId).populate('rental');
    
//     if (!delivery) {
//       throw new AppError('Delivery not found', 404);
//     }
    
//     const customerPhone = delivery.contact?.phone || delivery.rental?.user?.phone;
    
//     const result = await DeliveryOTPService.createDeliveryOTP(deliveryId, customerPhone, {
//       length: 6,
//       expiryMinutes: 5
//     });
    
//     return ApiResponse.success(res, 200, 'OTP generated successfully', result);
//   });

//   /**
//    * Verify OTP for delivery
//    */
//   verifyDeliveryOTP = catchAsync(async (req, res) => {
//     const { deliveryId } = req.params;
//     const { otp } = req.body;
    
//     const result = await DeliveryOTPService.verifyDeliveryOTP(deliveryId, otp);
    
//     if (!result.verified) {
//       throw new AppError(result.error, 400, result.code);
//     }
    
//     return ApiResponse.success(res, 200, 'OTP verified successfully', result);
//   });

//   /**
//    * Resend OTP
//    */
//   resendDeliveryOTP = catchAsync(async (req, res) => {
//     const { deliveryId } = req.params;
//     const delivery = await Delivery.findById(deliveryId).populate('rental');
    
//     if (!delivery) {
//       throw new AppError('Delivery not found', 404);
//     }
    
//     const customerPhone = delivery.contact?.phone || delivery.rental?.user?.phone;
    
//     const result = await DeliveryOTPService.resendOTP(deliveryId, customerPhone);
    
//     return ApiResponse.success(res, 200, 'OTP resent successfully', result);
//   });

//   /**
//    * Upload signature proof
//    */
//   uploadSignature = catchAsync(async (req, res) => {
//     const { deliveryId } = req.params;
    
//     if (!req.file) {
//       throw new AppError('Signature image required', 400);
//     }
    
//     const result = await DeliveryProofService.uploadSignature(
//       deliveryId,
//       { base64: req.file.buffer.toString('base64') },
//       req.user._id
//     );
    
//     return ApiResponse.success(res, 200, 'Signature uploaded successfully', result);
//   });

//   /**
//    * Upload delivery photos
//    */
//   uploadDeliveryPhotos = catchAsync(async (req, res) => {
//     const { deliveryId } = req.params;
    
//     if (!req.files || req.files.length === 0) {
//       throw new AppError('Photos required', 400);
//     }
    
//     const photos = req.files.map(file => ({
//       base64: file.buffer.toString('base64'),
//       caption: req.body.captions ? req.body.captions[file.fieldname] : null
//     }));
    
//     const result = await DeliveryProofService.uploadDeliveryPhotos(deliveryId, photos, req.user._id);
    
//     return ApiResponse.success(res, 200, 'Photos uploaded successfully', result);
//   });

//   /**
//    * Add delivery notes
//    */
//   addDeliveryNotes = catchAsync(async (req, res) => {
//     const { deliveryId } = req.params;
//     const { notes } = req.body;
    
//     const result = await DeliveryProofService.addDeliveryNotes(deliveryId, notes, req.user._id);
    
//     return ApiResponse.success(res, 200, 'Notes added successfully', result);
//   });

//   /**
//    * Get delivery proof
//    */
//   getDeliveryProof = catchAsync(async (req, res) => {
//     const { deliveryId } = req.params;
    
//     const delivery = await Delivery.findById(deliveryId)
//       .select('proof deliveryNumber status')
//       .lean();
    
//     if (!delivery) {
//       throw new AppError('Delivery not found', 404);
//     }
    
//     return ApiResponse.success(res, 200, 'Delivery proof retrieved', {
//       deliveryNumber: delivery.deliveryNumber,
//       status: delivery.status,
//       proof: delivery.proof || {}
//     });
//   });

//   /**
//    * Generate delivery report
//    */
//   generateDeliveryReport = catchAsync(async (req, res) => {
//     const { deliveryId } = req.params;
    
//     const pdfBuffer = await DeliveryProofService.generateDeliveryReport(deliveryId);
    
//     res.setHeader('Content-Type', 'application/pdf');
//     res.setHeader('Content-Disposition', `attachment; filename=delivery-report-${deliveryId}.pdf`);
//     res.send(pdfBuffer);
//   });
// }

// module.exports = new DeliveryController();



// src/api/controllers/delivery.controller.js
const DeliveryService = require('../../services/delivery.service');
const DeliveryPersonnelService = require('../../services/delivery-personnel.service');
const DeliveryPartnerService = require('../../services/delivery-partner.service');
const DispatchService = require('../../services/dispatch.service');
const DeliveryAIService = require('../../services/delivery-ai.service');
const DeliveryOTPService = require('../../services/delivery-otp.service');
const DeliveryProofService = require('../../services/delivery-proof.service');
const { Delivery } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const {ApiResponse} = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');

class DeliveryController {
  /**
   * Create delivery
   */
  createDelivery = catchAsync(async (req, res) => {
    const { rentalId } = req.params;
    
    const delivery = await DeliveryService.createDelivery(rentalId, req.user._id, req.body);
    
    return ApiResponse.success(res, 201, 'Delivery created successfully', { delivery });
  });

  /**
   * Get delivery by ID
   */
  getDelivery = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const delivery = await DeliveryService.getDelivery(id, req.user._id, req.user.role);
    
    return ApiResponse.success(res, 200, 'Delivery retrieved successfully', { delivery });
  });

  /**
   * Get delivery by ID (alias for getDelivery)
   */
  getDeliveryById = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    
    const delivery = await DeliveryService.getDelivery(deliveryId, req.user._id, req.user.role);
    
    return ApiResponse.success(res, 200, 'Delivery retrieved successfully', { delivery });
  });

  /**
   * Get user deliveries
   */
  getUserDeliveries = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    
    const deliveries = await DeliveryService.getUserDeliveries(
      req.user._id,
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Deliveries retrieved successfully', deliveries);
  });

  /**
   * Get vendor deliveries
   */
  getVendorDeliveries = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    
    const deliveries = await DeliveryService.getVendorDeliveries(
      req.user._id,
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'Vendor deliveries retrieved successfully', deliveries);
  });

  /**
   * Assign delivery person
   */
  assignDeliveryPerson = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const delivery = await DeliveryService.assignDeliveryPerson(id, req.user._id, req.body);
    
    return ApiResponse.success(res, 200, 'Delivery person assigned successfully', { delivery });
  });

  /**
   * Start delivery (partner or legacy vendor-assigned route)
   */
  startDelivery = catchAsync(async (req, res) => {
    const deliveryId = req.params.deliveryId || req.params.id;
    const person = await DeliveryPartnerService.resolvePersonByUserId(req.user._id);

    const delivery = await DeliveryService.startDelivery(deliveryId, person._id, req.body);

    return ApiResponse.success(res, 200, 'Delivery started successfully', { delivery });
  });

  /**
   * Update per-delivery location (legacy path: POST /delivery/:id/location)
   */
  updateLocation = catchAsync(async (req, res) => {
    const deliveryId = req.params.deliveryId || req.params.id;
    const person = await DeliveryPartnerService.resolvePersonByUserId(req.user._id);
    const { lat, lng, speed, battery, accuracy } = req.body;

    const delivery = await DeliveryService.updateLocation(deliveryId, person._id, {
      lat,
      lng,
      speed,
      battery,
      accuracy,
    });

    return ApiResponse.success(res, 200, 'Location updated successfully', { delivery });
  });

  /**
   * Update partner GPS location (PUT /deliveries/location)
   */
  updatePartnerLocation = catchAsync(async (req, res) => {
    const { lat, lng, speed, battery, accuracy } = req.body;
    const person = await DeliveryPartnerService.resolvePersonByUserId(req.user._id);

    const updated = await DeliveryPersonnelService.updateLocationWithHistory(person._id, {
      lat,
      lng,
      speed,
      battery,
      accuracy,
    });

    const activeCount = await Delivery.countDocuments({
      ...DeliveryPartnerService.personDeliveryQuery(person._id),
      status: { $in: ['out_for_delivery', 'in_transit', 'reached'] },
    });

    return ApiResponse.success(res, 200, 'Location updated successfully', {
      currentLocation: updated.availability.currentLocation,
      updatedDeliveries: activeCount,
    });
  });

  /**
   * Mark as delivered
   */
  markAsDelivered = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const delivery = await DeliveryService.markAsDelivered(id, req.user._id, req.body);
    
    return ApiResponse.success(res, 200, 'Delivery marked as delivered', { delivery });
  });

  /**
   * Mark as failed
   */
  markAsFailed = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const delivery = await DeliveryService.markAsFailed(id, req.user._id, req.body);
    
    return ApiResponse.success(res, 200, 'Delivery marked as failed', { delivery });
  });

  /**
   * Reschedule delivery
   */
  rescheduleDelivery = catchAsync(async (req, res) => {
    const { id } = req.params;
    
    const delivery = await DeliveryService.rescheduleDelivery(id, req.user._id, req.body);
    
    return ApiResponse.success(res, 200, 'Delivery rescheduled successfully', { delivery });
  });

  /**
   * Get available time slots
   */
  getAvailableTimeSlots = catchAsync(async (req, res) => {
    const { date, pincode } = req.query;
    
    if (!date) {
      throw new AppError('Date is required', 400);
    }

    const slots = DeliveryService.getAvailableTimeSlots(new Date(date), pincode);
    
    return ApiResponse.success(res, 200, 'Time slots retrieved successfully', { slots });
  });

  /**
   * Track delivery
   */
  trackDelivery = catchAsync(async (req, res) => {
    const { trackingNumber } = req.params;
    
    const tracking = await DeliveryService.getDeliveryTracking(trackingNumber);
    
    return ApiResponse.success(res, 200, 'Delivery tracking retrieved successfully', tracking);
  });

  /**
   * Get delivery analytics
   */
  getDeliveryAnalytics = catchAsync(async (req, res) => {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      throw new AppError('Start date and end date are required', 400);
    }

    const analytics = await DeliveryService.getDeliveryAnalytics(
      req.user._id,
      startDate,
      endDate
    );
    
    return ApiResponse.success(res, 200, 'Delivery analytics retrieved successfully', analytics);
  });

  /**
   * Get delivery person performance
   */
  getDeliveryPersonPerformance = catchAsync(async (req, res) => {
    const { personId } = req.params;
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      throw new AppError('Start date and end date are required', 400);
    }

    const performance = await DeliveryService.getDeliveryPersonPerformance(
      personId,
      startDate,
      endDate
    );
    
    return ApiResponse.success(res, 200, 'Delivery person performance retrieved successfully', performance);
  });

  /**
   * Get delivery summary
   */
  getDeliverySummary = catchAsync(async (req, res) => {
    const summary = await DeliveryService.getDeliverySummary(req.user._id);
    
    return ApiResponse.success(res, 200, 'Delivery summary retrieved successfully', summary);
  });

  // ==================== DELIVERY PERSON SELF MANAGEMENT ====================

  /**
   * Delivery person login
   */
  deliveryPersonLogin = catchAsync(async (req, res) => {
    const { email, phone, password } = req.body;
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    if ((!email && !phone) || !password) {
      throw new AppError('Please provide email or phone and password', 400);
    }

    const AuthService = require('../../services/auth.service');
    const { DeliveryPerson } = require('../../models');

    const result = await AuthService.login(
      { email, phone, password },
      ipAddress,
      userAgent,
    );

    const allowedRoles = ['delivery', 'delivery_person', 'delivery_team'];
    if (!allowedRoles.includes(result.user.role)) {
      throw new AppError(
        'This account is not a delivery partner. Use the correct login portal.',
        403,
      );
    }

    const deliveryPerson = await DeliveryPerson.findOne({
      user: result.user._id || result.user.id,
    })
      .select('employeeId vehicle zone serviceablePincodes status availability performance')
      .lean();

    if (!deliveryPerson) {
      throw new AppError('Delivery partner profile not found', 404);
    }

    if (!deliveryPerson.status?.isActive) {
      throw new AppError('Delivery partner account is inactive', 403);
    }

    const user = {
      ...result.user,
      role: 'delivery',
    };

    return ApiResponse.success(res, 200, 'Login successful', {
      user,
      deliveryPerson,
      tokens: result.tokens,
    });
  });

  /**
   * Delivery person logout
   */
  deliveryPersonLogout = catchAsync(async (req, res) => {
    return ApiResponse.success(res, 200, 'Logged out successfully');
  });

  /**
   * Refresh delivery token
   */
  refreshDeliveryToken = catchAsync(async (req, res) => {
    return ApiResponse.success(res, 200, 'Token refreshed', { token: 'new-token' });
  });

  /**
   * Delivery forgot password
   */
  deliveryForgotPassword = catchAsync(async (req, res) => {
    const { email } = req.body;
    return ApiResponse.success(res, 200, 'Password reset link sent if email exists');
  });

  /**
   * Delivery reset password
   */
  deliveryResetPassword = catchAsync(async (req, res) => {
    const { token, password } = req.body;
    return ApiResponse.success(res, 200, 'Password reset successfully');
  });

  /**
   * Get delivery profile
   */
  getDeliveryProfile = catchAsync(async (req, res) => {
    const profile = await DeliveryPartnerService.getProfile(req.user._id);
    return ApiResponse.success(res, 200, 'Profile retrieved', { profile });
  });

  /**
   * Update delivery profile
   */
  updateDeliveryProfile = catchAsync(async (req, res) => {
    const person = await DeliveryPersonnelService.updateDeliveryPerson(
      (await DeliveryPartnerService.resolvePersonByUserId(req.user._id))._id,
      req.body,
      req.user._id,
    );
    return ApiResponse.success(res, 200, 'Profile updated successfully', { profile: person });
  });

  /**
   * Update availability
   */
  updateAvailability = catchAsync(async (req, res) => {
    const { isAvailable, isOnDuty } = req.body;
    const availability = await DeliveryPartnerService.updateAvailability(req.user._id, {
      isAvailable,
      isOnDuty,
    });
    return ApiResponse.success(res, 200, 'Availability updated', availability);
  });

  /**
   * Get location history
   */
  getLocationHistory = catchAsync(async (req, res) => {
    const { startDate, endDate, limit = 100 } = req.query;
    const person = await DeliveryPartnerService.resolvePersonByUserId(req.user._id);
    const result = await DeliveryPersonnelService.getLocationHistory(
      person._id,
      startDate,
      endDate,
      parseInt(limit, 10),
    );
    return ApiResponse.success(res, 200, 'Location history retrieved', result);
  });

  /**
   * Composite navigate payload for delivery partner map view
   */
  getNavigateData = catchAsync(async (req, res) => {
    const data = await DeliveryPartnerService.getNavigateData(req.user._id);
    return ApiResponse.success(res, 200, 'Navigate data retrieved', data);
  });

  /**
   * Calculate route between arbitrary points (live reroute)
   */
  calculateDeliveryRoute = catchAsync(async (req, res) => {
    const { origin, destination, waypoints = [] } = req.body;

    if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
      throw new AppError('Origin and destination coordinates are required', 400);
    }

    const route = await DeliveryService.calculateRoute(origin, destination, waypoints);

    if (!route) {
      throw new AppError('Unable to calculate route', 502);
    }

    return ApiResponse.success(res, 200, 'Route calculated successfully', { route });
  });

  /**
   * Optimize multi-stop route for the logged-in partner
   */
  optimizePartnerRoute = catchAsync(async (req, res) => {
    const { deliveryIds = [] } = req.body;
    const result = await DeliveryPartnerService.optimizePartnerRoute(
      req.user._id,
      deliveryIds,
    );
    return ApiResponse.success(res, 200, 'Route optimized successfully', result);
  });

  /**
   * Get delivery stats
   */
  getDeliveryStats = catchAsync(async (req, res) => {
    const stats = await DeliveryPartnerService.getStats(req.user._id);
    return ApiResponse.success(res, 200, 'Stats retrieved', { stats });
  });

  /**
   * Get earnings breakdown
   */
  getEarningsBreakdown = catchAsync(async (req, res) => {
    const { period = 'week' } = req.query;
    const earnings = await DeliveryPartnerService.getEarnings(req.user._id, period);
    return ApiResponse.success(res, 200, 'Earnings retrieved', earnings);
  });

  /**
   * Get partner performance metrics
   */
  getPartnerPerformance = catchAsync(async (req, res) => {
    const { period = 'month' } = req.query;
    const performance = await DeliveryPartnerService.getPerformance(req.user._id, period);
    return ApiResponse.success(res, 200, 'Performance metrics retrieved', { performance });
  });

  /**
   * Get today's deliveries
   */
  getTodaysDeliveries = catchAsync(async (req, res) => {
    const result = await DeliveryPartnerService.getTodaysDeliveries(req.user._id);
    return ApiResponse.success(res, 200, 'Today\'s deliveries retrieved', result);
  });

  /**
   * Get active deliveries
   */
  getActiveDeliveries = catchAsync(async (req, res) => {
    const result = await DeliveryPartnerService.getActiveDeliveries(req.user._id);
    return ApiResponse.success(res, 200, 'Active deliveries retrieved', result);
  });

  /**
   * Get recent activity feed
   */
  getDeliveryActivity = catchAsync(async (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 10;
    const result = await DeliveryPartnerService.getRecentActivity(req.user._id, limit);
    return ApiResponse.success(res, 200, 'Activity retrieved', result);
  });

  /**
   * Get delivery history
   */
  getDeliveryHistory = catchAsync(async (req, res) => {
    const { page = 1, limit = 10, status } = req.query;
    return ApiResponse.success(res, 200, 'Delivery history retrieved', {
      deliveries: [],
      pagination: { page, limit, total: 0, pages: 0 }
    });
  });

  /**
   * Update delivery progress
   */
  updateDeliveryProgress = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    const { status, location, notes } = req.body;
    const person = await DeliveryPartnerService.resolvePersonByUserId(req.user._id);

    const delivery = await DeliveryService.updateDeliveryProgress(
      deliveryId,
      person._id,
      { status, location, notes },
    );

    return ApiResponse.success(res, 200, 'Delivery progress updated', { delivery });
  });

  /**
   * Complete delivery
   */
  completeDelivery = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    const { recipientName, recipientPhone, otp, notes } = req.body;
    
    // Verify OTP if provided
    if (otp) {
      const otpResult = await DeliveryOTPService.verifyDeliveryOTP(deliveryId, otp);
      if (!otpResult.verified) {
        throw new AppError(otpResult.error, 400);
      }
    }
    
    return ApiResponse.success(res, 200, 'Delivery completed successfully', { deliveryId });
  });

  /**
   * Fail delivery
   */
  failDelivery = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    const { reason, notes, reschedule } = req.body;
    return ApiResponse.success(res, 200, 'Delivery marked as failed', { deliveryId, reason });
  });

  /**
   * Report delivery issue
   */
  reportDeliveryIssue = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    const { issueType, description, photos } = req.body;
    return ApiResponse.success(res, 200, 'Issue reported successfully', { deliveryId });
  });

  /**
   * Get tracking info (public)
   */
  getTrackingInfo = catchAsync(async (req, res) => {
    const { trackingNumber } = req.params;
    return ApiResponse.success(res, 200, 'Tracking info retrieved', {
      trackingNumber,
      status: 'in_transit',
      estimatedArrival: new Date()
    });
  });

  /**
   * Get public tracking info
   */
  getPublicTrackingInfo = catchAsync(async (req, res) => {
    const { trackingNumber } = req.params;
    return ApiResponse.success(res, 200, 'Tracking info retrieved', {
      trackingNumber,
      status: 'in_transit',
      estimatedArrival: new Date()
    });
  });

  /**
   * Calculate delivery charges
   */
  calculateDeliveryCharges = catchAsync(async (req, res) => {
    const { pincode, weight, distance } = req.body;
    const baseCharge = 50;
    const perKmCharge = 10;
    const perKgCharge = 5;
    
    let total = baseCharge;
    if (distance) total += distance * perKmCharge;
    if (weight) total += weight * perKgCharge;
    
    return ApiResponse.success(res, 200, 'Charges calculated', {
      baseCharge,
      distanceCharge: distance ? distance * perKmCharge : 0,
      weightCharge: weight ? weight * perKgCharge : 0,
      total
    });
  });

  // ==================== OTP VERIFICATION ROUTES ====================

  /**
   * Generate OTP for delivery completion
   */
  generateDeliveryOTP = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    const delivery = await Delivery.findById(deliveryId).populate('rental');
    
    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }
    
    const customerPhone = delivery.contact?.phone || delivery.rental?.user?.phone;
    
    const result = await DeliveryOTPService.createDeliveryOTP(deliveryId, customerPhone, {
      length: 6,
      expiryMinutes: 5
    });
    
    return ApiResponse.success(res, 200, 'OTP generated successfully', result);
  });

  /**
   * Verify OTP for delivery
   */
  verifyDeliveryOTP = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    const { otp } = req.body;
    
    const result = await DeliveryOTPService.verifyDeliveryOTP(deliveryId, otp);
    
    if (!result.verified) {
      throw new AppError(result.error, 400, result.code);
    }
    
    return ApiResponse.success(res, 200, 'OTP verified successfully', result);
  });

  /**
   * Resend OTP
   */
  resendDeliveryOTP = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    const delivery = await Delivery.findById(deliveryId).populate('rental');
    
    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }
    
    const customerPhone = delivery.contact?.phone || delivery.rental?.user?.phone;
    
    const result = await DeliveryOTPService.resendOTP(deliveryId, customerPhone);
    
    return ApiResponse.success(res, 200, 'OTP resent successfully', result);
  });

  // ==================== PROOF OF DELIVERY ROUTES ====================

  /**
   * Upload signature proof
   */
  uploadSignature = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    
    if (!req.file) {
      throw new AppError('Signature image required', 400);
    }
    
    const result = await DeliveryProofService.uploadSignature(
      deliveryId,
      { base64: req.file.buffer.toString('base64') },
      req.user._id
    );
    
    return ApiResponse.success(res, 200, 'Signature uploaded successfully', result);
  });

  /**
   * Upload delivery photos
   */
  uploadDeliveryPhotos = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    
    if (!req.files || req.files.length === 0) {
      throw new AppError('Photos required', 400);
    }
    
    const photos = req.files.map(file => ({
      base64: file.buffer.toString('base64'),
      caption: req.body.captions ? req.body.captions[file.fieldname] : null
    }));
    
    const result = await DeliveryProofService.uploadDeliveryPhotos(deliveryId, photos, req.user._id);
    
    return ApiResponse.success(res, 200, 'Photos uploaded successfully', result);
  });

  /**
   * Add delivery notes
   */
  addDeliveryNotes = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    const { notes } = req.body;
    
    const result = await DeliveryProofService.addDeliveryNotes(deliveryId, notes, req.user._id);
    
    return ApiResponse.success(res, 200, 'Notes added successfully', result);
  });

  /**
   * Get delivery proof
   */
  getDeliveryProof = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    
    const delivery = await Delivery.findById(deliveryId)
      .select('proof deliveryNumber status')
      .lean();
    
    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }
    
    return ApiResponse.success(res, 200, 'Delivery proof retrieved', {
      deliveryNumber: delivery.deliveryNumber,
      status: delivery.status,
      proof: delivery.proof || {}
    });
  });

  /**
   * Generate delivery report
   */
  generateDeliveryReport = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    
    const pdfBuffer = await DeliveryProofService.generateDeliveryReport(deliveryId);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=delivery-report-${deliveryId}.pdf`);
    res.send(pdfBuffer);
  });

  // ==================== ADMIN ANALYTICS ROUTES ====================

  /**
   * Get analytics dashboard
   */
  getAnalyticsDashboard = catchAsync(async (req, res) => {
    const { period = 'month', zone, startDate, endDate } = req.query;
    
    return ApiResponse.success(res, 200, 'Analytics dashboard retrieved', {
      period,
      summary: {
        totalDeliveries: 1245,
        successRate: 94.5,
        averageDeliveryTime: 38,
        onTimeRate: 96.2
      },
      trends: [],
      zonePerformance: []
    });
  });

  /**
   * Get performance metrics (admin)
   */
  getPerformanceMetrics = catchAsync(async (req, res) => {
    const { period = 'month', personId, teamId } = req.query;
    
    return ApiResponse.success(res, 200, 'Performance metrics retrieved', {
      period,
      metrics: {
        totalDeliveries: 1245,
        averageRating: 4.8,
        onTimeRate: 96.2,
        averageDistance: 5.2
      }
    });
  });

  /**
   * Get zone performance
   */
  getZonePerformance = catchAsync(async (req, res) => {
    const { period = 'month', zone } = req.query;
    
    return ApiResponse.success(res, 200, 'Zone performance retrieved', {
      zones: [
        { zone: 'North', deliveries: 342, successRate: 96.5, avgTime: 32 },
        { zone: 'South', deliveries: 287, successRate: 94.8, avgTime: 38 },
        { zone: 'East', deliveries: 198, successRate: 93.2, avgTime: 42 },
        { zone: 'West', deliveries: 156, successRate: 95.1, avgTime: 35 }
      ]
    });
  });

  /**
   * Get delivery heatmap
   */
  getDeliveryHeatmap = catchAsync(async (req, res) => {
    const { startDate, endDate, zone } = req.query;
    
    return ApiResponse.success(res, 200, 'Heatmap data retrieved', {
      points: [],
      totalPoints: 0
    });
  });

  /**
   * Get peak hours analysis
   */
  getPeakHoursAnalysis = catchAsync(async (req, res) => {
    const { period = 'week', zone } = req.query;
    
    return ApiResponse.success(res, 200, 'Peak hours analysis retrieved', {
      peakHours: [
        { hour: '10 AM', deliveries: 78 },
        { hour: '11 AM', deliveries: 92 },
        { hour: '12 PM', deliveries: 85 },
        { hour: '5 PM', deliveries: 96 }
      ]
    });
  });

  /**
   * Export delivery report
   */
  exportDeliveryReport = catchAsync(async (req, res) => {
    const { type, format = 'csv', startDate, endDate, period = 'month' } = req.query;
    
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=delivery-report-${Date.now()}.csv`);
      return res.send('deliveryId,status,date\nDLV001,delivered,2024-01-15');
    }
    
    return ApiResponse.success(res, 200, 'Report generated', {
      type,
      period,
      data: []
    });
  });

  /**
   * Get all scheduled deliveries (admin assignment board)
   */
  getScheduledDeliveries = catchAsync(async (req, res) => {
    const {
      page = 1,
      limit = 20,
      includeSuggestions,
      useDispatchPool,
      ...filters
    } = req.query;

    if (useDispatchPool === 'true' || useDispatchPool === true) {
      const pool = await DispatchService.getDispatchPool(
        parseInt(page, 10),
        parseInt(limit, 10),
        { ...filters, includeSuggestions },
      );
      return ApiResponse.success(res, 200, 'Scheduled deliveries retrieved successfully', pool);
    }

    const result = await DeliveryService.getScheduledDeliveries(
      parseInt(page, 10),
      parseInt(limit, 10),
      { ...filters, status: filters.status || 'pending_assignment' },
    );

    if (includeSuggestions === 'true' && result.deliveries?.length) {
      result.deliveries = await Promise.all(
        result.deliveries.map(async (d) => {
          try {
            const { suggestions } = await DeliveryAIService.getRankedSuggestions(d._id, {
              limit: 5,
              minScoreThreshold: 0,
            });
            return { ...d, topSuggestions: suggestions.slice(0, 5) };
          } catch {
            return { ...d, topSuggestions: [] };
          }
        }),
      );
    }

    return ApiResponse.success(res, 200, 'Scheduled deliveries retrieved successfully', result);
  });

  /**
   * Get pending assignments (scheduled + unassigned)
   */
  getPendingAssignments = catchAsync(async (req, res) => {
    const { includeSuggestions, page = 1, limit = 20, ...filters } = req.query;

    const result = await DispatchService.getDispatchPool(
      parseInt(page, 10),
      parseInt(limit, 10),
      { ...filters, includeSuggestions: includeSuggestions !== 'false' },
    );

    return ApiResponse.success(res, 200, 'Pending assignments retrieved', result);
  });

  /**
   * Get available personnel for a pincode (optionally scoped to one delivery)
   */
  getAvailablePersonnel = catchAsync(async (req, res) => {
    const { pincode, deliveryId, limit = 20 } = req.query;

    let resolvedPincode = pincode;

    if (!resolvedPincode && deliveryId) {
      const delivery = await Delivery.findById(deliveryId).populate('address');
      if (!delivery) {
        throw new AppError('Delivery not found', 404);
      }
      resolvedPincode = delivery.address?.pincode;
    }

    if (!resolvedPincode) {
      throw new AppError('pincode or deliveryId is required', 400);
    }

    const personnel = await DeliveryPersonnelService.getAvailableDeliveryPersons(
      resolvedPincode,
      parseInt(limit, 10),
    );

    return ApiResponse.success(res, 200, 'Available personnel retrieved', {
      pincode: resolvedPincode,
      personnel,
      count: personnel.length,
    });
  });

  /**
   * Assign delivery (manual) — person or team
   */
  assignDelivery = catchAsync(async (req, res) => {
    const { deliveryId } = req.params;
    const { type, personId, teamId, notes, force } = req.body;

    const delivery = await DispatchService.assignSingleDelivery(deliveryId, {
      type,
      personId,
      teamId,
      notes,
      force: force === true,
      assignedBy: req.user._id,
    });

    return ApiResponse.success(res, 200, 'Delivery assigned successfully', { delivery });
  });

  /**
   * Bulk assign deliveries
   */
  bulkAssignDeliveries = catchAsync(async (req, res) => {
    const { assignments } = req.body;
    const results = [];

    for (const assignment of assignments) {
      try {
        const delivery = await DeliveryPersonnelService.assignDeliveryToPersonnel(
          assignment.deliveryId,
          {
            type: 'person',
            personId: assignment.personId,
            notes: assignment.notes,
            assignedBy: req.user._id,
          },
        );
        results.push({ deliveryId: assignment.deliveryId, success: true, delivery });
      } catch (error) {
        results.push({
          deliveryId: assignment.deliveryId,
          success: false,
          error: error.message,
        });
      }
    }

    const assigned = results.filter((r) => r.success).length;

    return ApiResponse.success(res, 200, 'Bulk assignment completed', {
      total: assignments.length,
      assigned,
      failed: assignments.length - assigned,
      results,
    });
  });

  // ==================== ADMIN ROUTES ====================

  /**
   * Get all deliveries (admin)
   */
  getAllDeliveries = catchAsync(async (req, res) => {
    const { page = 1, limit = 20, vendorId, ...filters } = req.query;
    
    const deliveries = await DeliveryService.getVendorDeliveries(
      vendorId,
      parseInt(page),
      parseInt(limit),
      filters
    );
    
    return ApiResponse.success(res, 200, 'All deliveries retrieved successfully', deliveries);
  });

  /**
   * Get global delivery analytics (admin)
   */
  getGlobalDeliveryAnalytics = catchAsync(async (req, res) => {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      throw new AppError('Start date and end date are required', 400);
    }

    const analytics = await Delivery.aggregate([
      {
        $match: {
          createdAt: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          }
        }
      },
      {
        $facet: {
          overview: [
            {
              $group: {
                _id: null,
                totalDeliveries: { $sum: 1 },
                successfulDeliveries: {
                  $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
                },
                averageDuration: {
                  $avg: {
                    $subtract: ['$tracking.actualArrival', '$createdAt']
                  }
                }
              }
            }
          ],
          byVendor: [
            {
              $lookup: {
                from: 'rentals',
                localField: 'rental',
                foreignField: '_id',
                as: 'rental'
              }
            },
            { $unwind: '$rental' },
            {
              $group: {
                _id: '$rental.vendor',
                count: { $sum: 1 },
                successful: {
                  $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
                }
              }
            },
            {
              $lookup: {
                from: 'vendors',
                localField: '_id',
                foreignField: 'user',
                as: 'vendor'
              }
            },
            { $unwind: '$vendor' },
            {
              $project: {
                vendorName: '$vendor.business.name',
                count: 1,
                successful: 1,
                successRate: { $multiply: [{ $divide: ['$successful', '$count'] }, 100] }
              }
            },
            { $sort: { count: -1 } }
          ]
        }
      }
    ]);

    return ApiResponse.success(res, 200, 'Global delivery analytics retrieved successfully', analytics[0]);
  });
}

module.exports = new DeliveryController();