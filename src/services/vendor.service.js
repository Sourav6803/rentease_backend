const { Vendor, User, Product, Rental, Review, Payment } = require('../models');
const  AppError  = require('../utils/AppError');
const { addJob } = require('../jobs');
const { eventEmitter, EVENTS } = require('../events');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');

class VendorService {
  constructor() {
    this.redisClient = getRedisClient();
  }

  /**
   * Get vendor profile
   */
  async getVendorProfile(userId) {
    try {
      const vendor = await Vendor.findOne({ user: userId })
        .populate('user', 'email phone profile verification.kyc.status')
        .populate('addresses.warehouse')
        .populate('addresses.registeredOffice')
        .lean();

      if (!vendor) {
        throw new AppError('Vendor profile not found', 404);
      }

      // Get additional stats
      const stats = await this.getVendorStats(userId);

      return {
        ...vendor,
        stats,
      };
    } catch (error) {
      logger.error('Error in getVendorProfile:', error);
      throw error;
    }
  }

  /**
   * Get vendor by ID (public)
   */
  async getVendorById(vendorId) {
    try {
      const vendor = await Vendor.findOne({ vendorId })
        .populate('user', 'profile.firstName profile.lastName profile.avatar')
        .select('business.name business.description performance.rating products.total addresses.serviceableCities')
        .lean();

      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      // Get top products
      const topProducts = await Product.find({ 
        vendor: vendor.user,
        'status.isActive': true 
      })
      .select('basicInfo.name pricing.monthlyRent media.images ratings.average')
      .sort({ 'ratings.average': -1 })
      .limit(5)
      .lean();

      return {
        ...vendor,
        topProducts,
      };
    } catch (error) {
      logger.error('Error in getVendorById:', error);
      throw error;
    }
  }

  /**
   * Update vendor profile
   */
  async updateVendorProfile(userId, updateData) {
    try {
      const { business, contact, addresses, settings } = updateData;

      const updateFields = {};
      if (business) {
        if (business.name) updateFields['business.name'] = business.name;
        if (business.description) updateFields['business.description'] = business.description;
        if (business.website) updateFields['business.website'] = business.website;
      }
      if (contact) {
        if (contact.primaryPhone) updateFields['contact.primaryPhone'] = contact.primaryPhone;
        if (contact.secondaryPhone) updateFields['contact.secondaryPhone'] = contact.secondaryPhone;
        if (contact.supportEmail) updateFields['contact.supportEmail'] = contact.supportEmail;
        if (contact.supportPhone) updateFields['contact.supportPhone'] = contact.supportPhone;
      }
      if (addresses) {
        if (addresses.serviceableCities) updateFields['addresses.serviceableCities'] = addresses.serviceableCities;
        if (addresses.serviceablePincodes) updateFields['addresses.serviceablePincodes'] = addresses.serviceablePincodes;
      }
      if (settings) {
        if (settings.businessHours) updateFields['settings.businessHours'] = settings.businessHours;
        if (settings.autoConfirmBookings !== undefined) {
          updateFields['settings.autoConfirmBookings'] = settings.autoConfirmBookings;
        }
        if (settings.advanceNotice) updateFields['settings.advanceNotice'] = settings.advanceNotice;
        if (settings.cancellationPolicy) updateFields['settings.cancellationPolicy'] = settings.cancellationPolicy;
      }

      const vendor = await Vendor.findOneAndUpdate(
        { user: userId },
        { $set: updateFields },
        { new: true, runValidators: true }
      ).populate('user', 'email phone');

      if (!vendor) {
        throw new AppError('Vendor profile not found', 404);
      }

      // Emit event
      eventEmitter.emit('vendor:profile-updated', {
        vendorId: vendor.vendorId,
        userId: vendor.user._id,
        updatedFields: Object.keys(updateFields),
      });

      return vendor;
    } catch (error) {
      logger.error('Error in updateVendorProfile:', error);
      throw error;
    }
  }

  /**
   * Get vendor dashboard stats
   */
  async getVendorDashboard(userId) {
    try {
      const vendor = await Vendor.findOne({ user: userId });
      if (!vendor) {
        throw new AppError('Vendor profile not found', 404);
      }

      const [
        productStats,
        rentalStats,
        revenueStats,
        pendingRequests,
        lowInventory,
        recentReviews,
        monthlyTrends
      ] = await Promise.all([
        // Product statistics
        Product.aggregate([
          { $match: { vendor: userId } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: { $sum: { $cond: [{ $eq: ['$status.isActive', true] }, 1, 0] } },
              inactive: { $sum: { $cond: [{ $eq: ['$status.isActive', false] }, 1, 0] } },
              totalInventory: { $sum: '$inventory.totalQuantity' },
              availableInventory: { $sum: '$inventory.availableQuantity' },
            }
          }
        ]),

        // Rental statistics
        Rental.aggregate([
          { $match: { vendor: userId } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: {
                $sum: { $cond: [{ $in: ['$status', ['active', 'confirmed', 'delivered']] }, 1, 0] }
              },
              completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
              cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
              overdue: { $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0] } },
            }
          }
        ]),

        // Revenue statistics
        Payment.aggregate([
          { $match: { 
            vendor: userId,
            status: 'success',
            type: { $in: ['rent', 'security_deposit', 'delivery'] }
          }},
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$amount' },
              totalPayments: { $sum: 1 },
              averagePayment: { $avg: '$amount' },
              thisMonth: {
                $sum: {
                  $cond: [
                    { $gte: ['$createdAt', new Date(new Date().setDate(1))] },
                    '$amount',
                    0
                  ]
                }
              }
            }
          }
        ]),

        // Pending requests (rental confirmations, maintenance)
        Promise.all([
          Rental.countDocuments({ 
            vendor: userId, 
            status: 'pending' 
          }),
          require('../models/Maintenance').countDocuments({ 
            vendor: userId, 
            status: 'pending' 
          })
        ]).then(([pendingRentals, pendingMaintenance]) => ({
          pendingRentals,
          pendingMaintenance,
          total: pendingRentals + pendingMaintenance
        })),

        // Low inventory alerts
        Product.find({
          vendor: userId,
          'inventory.availableQuantity': { $lt: 5 }
        })
        .select('basicInfo.name inventory.availableQuantity')
        .limit(10)
        .lean(),

        // Recent reviews
        Review.find({ vendor: userId })
          .populate('user', 'profile.firstName profile.lastName profile.avatar')
          .populate('product', 'basicInfo.name')
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),

        // Monthly trends (last 6 months)
        Rental.aggregate([
          { $match: { 
            vendor: userId,
            createdAt: { $gte: new Date(new Date().setMonth(new Date().getMonth() - 6)) }
          }},
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' }
              },
              rentals: { $sum: 1 },
              revenue: { $sum: '$rentalDetails.totalAmount' }
            }
          },
          { $sort: { '_id.year': 1, '_id.month': 1 } }
        ])
      ]);

      return {
        products: productStats[0] || { total: 0, active: 0, inactive: 0, totalInventory: 0, availableInventory: 0 },
        rentals: rentalStats[0] || { total: 0, active: 0, completed: 0, cancelled: 0, overdue: 0 },
        revenue: revenueStats[0] || { totalRevenue: 0, totalPayments: 0, averagePayment: 0, thisMonth: 0 },
        pendingRequests,
        lowInventory,
        recentReviews,
        monthlyTrends,
        vendor: {
          verificationStatus: vendor.verification.status,
          subscription: vendor.subscription.plan,
          rating: vendor.performance.rating.average,
          totalReviews: vendor.performance.rating.count,
        }
      };
    } catch (error) {
      logger.error('Error in getVendorDashboard:', error);
      throw error;
    }
  }

  /**
   * Get vendor statistics
   */
  async getVendorStats(userId) {
    try {
      const [productCount, rentalCount, revenue, averageRating] = await Promise.all([
        Product.countDocuments({ vendor: userId }),
        Rental.countDocuments({ vendor: userId }),
        Payment.aggregate([
          { $match: { vendor: userId, status: 'success' } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        Review.aggregate([
          { $match: { vendor: userId } },
          { $group: { _id: null, average: { $avg: '$ratings.overall' } } }
        ])
      ]);

      return {
        totalProducts: productCount,
        totalRentals: rentalCount,
        totalRevenue: revenue[0]?.total || 0,
        averageRating: averageRating[0]?.average || 0,
        joinedDate: await this.getVendorJoinDate(userId),
      };
    } catch (error) {
      logger.error('Error in getVendorStats:', error);
      return {
        totalProducts: 0,
        totalRentals: 0,
        totalRevenue: 0,
        averageRating: 0,
      };
    }
  }

  /**
   * Get vendor join date
   */
  async getVendorJoinDate(userId) {
    const vendor = await Vendor.findOne({ user: userId }).select('createdAt');
    return vendor?.createdAt || new Date();
  }

  /**
   * Get vendor products
   */
  async getVendorProducts(userId, page = 1, limit = 10, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = { vendor: userId };
      
      // Apply filters
      if (filters.category) query.category = filters.category;
      if (filters.status) {
        if (filters.status === 'active') query['status.isActive'] = true;
        if (filters.status === 'inactive') query['status.isActive'] = false;
      }
      if (filters.condition) query.condition = filters.condition;
      if (filters.search) {
        query.$or = [
          { 'basicInfo.name': new RegExp(filters.search, 'i') },
          { 'basicInfo.description': new RegExp(filters.search, 'i') },
          { 'basicInfo.sku': new RegExp(filters.search, 'i') }
        ];
      }

      const [products, total] = await Promise.all([
        Product.find(query)
          .populate('category', 'name')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Product.countDocuments(query)
      ]);

      // Get inventory counts
      const Inventory = require('../models/Inventory.model');
      const productsWithInventory = await Promise.all(
        products.map(async (product) => {
          const inventoryCount = await Inventory.countDocuments({ 
            product: product._id,
            status: 'available'
          });
          return {
            ...product,
            availableInventory: inventoryCount,
          };
        })
      );

      return {
        products: productsWithInventory,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getVendorProducts:', error);
      throw error;
    }
  }

  /**
   * Get vendor rentals
   */
  async getVendorRentals(userId, page = 1, limit = 10, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = { vendor: userId };
      
      if (filters.status) query.status = filters.status;
      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
        if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
      }

      const [rentals, total] = await Promise.all([
        Rental.find(query)
          .populate('user', 'profile.firstName profile.lastName email phone')
          .populate('product', 'basicInfo.name basicInfo.sku')
          .populate('address')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Rental.countDocuments(query)
      ]);

      return {
        rentals,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getVendorRentals:', error);
      throw error;
    }
  }

  /**
   * Get vendor analytics
   */
  async getVendorAnalytics(userId, startDate, endDate) {
    try {
      const matchStage = {
        vendor: userId,
        createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
      };

      const [
        revenueByDay,
        rentalsByStatus,
        topProducts,
        customerMetrics,
        paymentMethods,
      ] = await Promise.all([
        // Daily revenue
        Payment.aggregate([
          { $match: { ...matchStage, status: 'success' } },
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
                day: { $dayOfMonth: '$createdAt' }
              },
              revenue: { $sum: '$amount' },
              count: { $sum: 1 }
            }
          },
          { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
        ]),

        // Rentals by status
        Rental.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              revenue: { $sum: '$rentalDetails.totalAmount' }
            }
          }
        ]),

        // Top products by revenue
        Rental.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: '$product',
              rentals: { $sum: 1 },
              revenue: { $sum: '$rentalDetails.totalAmount' }
            }
          },
          { $sort: { revenue: -1 } },
          { $limit: 10 },
          {
            $lookup: {
              from: 'products',
              localField: '_id',
              foreignField: '_id',
              as: 'product'
            }
          },
          { $unwind: '$product' },
          {
            $project: {
              _id: 1,
              name: '$product.basicInfo.name',
              rentals: 1,
              revenue: 1
            }
          }
        ]),

        // Customer metrics
        Rental.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: '$user',
              rentals: { $sum: 1 },
              totalSpent: { $sum: '$rentalDetails.totalAmount' }
            }
          },
          {
            $group: {
              _id: null,
              totalCustomers: { $sum: 1 },
              avgRentalsPerCustomer: { $avg: '$rentals' },
              avgSpentPerCustomer: { $avg: '$totalSpent' },
              newCustomers: {
                $sum: {
                  $cond: [{ $eq: ['$rentals', 1] }, 1, 0]
                }
              },
              returningCustomers: {
                $sum: {
                  $cond: [{ $gt: ['$rentals', 1] }, 1, 0]
                }
              }
            }
          }
        ]),

        // Payment methods breakdown
        Payment.aggregate([
          { $match: { ...matchStage, status: 'success' } },
          {
            $group: {
              _id: '$method',
              count: { $sum: 1 },
              amount: { $sum: '$amount' }
            }
          }
        ])
      ]);

      return {
        period: { startDate, endDate },
        revenue: {
          daily: revenueByDay,
          total: revenueByDay.reduce((sum, d) => sum + d.revenue, 0),
          byStatus: rentalsByStatus,
        },
        products: {
          topProducts,
          totalProducts: await Product.countDocuments({ vendor: userId }),
          activeProducts: await Product.countDocuments({ vendor: userId, 'status.isActive': true }),
        },
        rentals: {
          total: rentalsByStatus.reduce((sum, s) => sum + s.count, 0),
          byStatus: rentalsByStatus,
        },
        customers: customerMetrics[0] || {
          totalCustomers: 0,
          avgRentalsPerCustomer: 0,
          avgSpentPerCustomer: 0,
          newCustomers: 0,
          returningCustomers: 0,
        },
        payments: {
          byMethod: paymentMethods,
          totalAmount: paymentMethods.reduce((sum, m) => sum + m.amount, 0),
        },
      };
    } catch (error) {
      logger.error('Error in getVendorAnalytics:', error);
      throw error;
    }
  }

  /**
   * Update bank details
   */
  async updateBankDetails(userId, bankDetails) {
    try {
      const vendor = await Vendor.findOne({ user: userId });
      
      if (!vendor) {
        throw new AppError('Vendor profile not found', 404);
      }

      vendor.bankDetails = {
        ...vendor.bankDetails,
        ...bankDetails,
        verified: false,
      };

      await vendor.save();

      // Notify admin for verification
      eventEmitter.emit('vendor:bank-details-updated', {
        vendorId: vendor.vendorId,
        userId: vendor.user,
      });

      return vendor.bankDetails;
    } catch (error) {
      logger.error('Error in updateBankDetails:', error);
      throw error;
    }
  }

  /**
   * Update subscription plan
   */
  async updateSubscription(userId, plan) {
    try {
      const vendor = await Vendor.findOne({ user: userId });
      
      if (!vendor) {
        throw new AppError('Vendor profile not found', 404);
      }

      const oldPlan = vendor.subscription.plan;
      
      vendor.subscription.plan = plan;
      vendor.subscription.validUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year

      // Set limits based on plan
      const planLimits = {
        basic: { maxProducts: 50, maxRentalsPerMonth: 100 },
        standard: { maxProducts: 200, maxRentalsPerMonth: 500 },
        premium: { maxProducts: 1000, maxRentalsPerMonth: 2000 },
        enterprise: { maxProducts: -1, maxRentalsPerMonth: -1 }, // Unlimited
      };

      vendor.subscription.limits = planLimits[plan];

      await vendor.save();

      // Emit event
      eventEmitter.emit('vendor:subscription-upgraded', {
        vendorId: vendor.vendorId,
        userId: vendor.user,
        oldPlan,
        newPlan: plan,
      });

      return vendor.subscription;
    } catch (error) {
      logger.error('Error in updateSubscription:', error);
      throw error;
    }
  }

  /**
   * Get subscription details
   */
  async getSubscriptionDetails(userId) {
    try {
      const vendor = await Vendor.findOne({ user: userId })
        .select('subscription payments payoutSchedule');

      if (!vendor) {
        throw new AppError('Vendor profile not found', 404);
      }

      // Calculate usage
      const currentMonthStart = new Date(new Date().setDate(1));
      const currentUsage = await Rental.countDocuments({
        vendor: userId,
        createdAt: { $gte: currentMonthStart }
      });

      const productCount = await Product.countDocuments({ vendor: userId });

      return {
        currentPlan: vendor.subscription.plan,
        validUntil: vendor.subscription.validUntil,
        limits: vendor.subscription.limits,
        features: vendor.subscription.features,
        usage: {
          currentRentals: currentUsage,
          totalProducts: productCount,
          remainingRentals: vendor.subscription.limits?.maxRentalsPerMonth === -1 
            ? 'Unlimited' 
            : Math.max(0, (vendor.subscription.limits?.maxRentalsPerMonth || 0) - currentUsage),
          remainingProducts: vendor.subscription.limits?.maxProducts === -1
            ? 'Unlimited'
            : Math.max(0, (vendor.subscription.limits?.maxProducts || 0) - productCount),
        },
        payoutSchedule: vendor.payoutSchedule,
        pendingPayout: vendor.payments?.pending || 0,
        totalPaid: vendor.payments?.paid || 0,
      };
    } catch (error) {
      logger.error('Error in getSubscriptionDetails:', error);
      throw error;
    }
  }

  /**
   * Update payout schedule
   */
  async updatePayoutSchedule(userId, schedule) {
    try {
      const vendor = await Vendor.findOne({ user: userId });
      
      if (!vendor) {
        throw new AppError('Vendor profile not found', 404);
      }

      vendor.payoutSchedule = schedule;
      await vendor.save();

      return vendor.payoutSchedule;
    } catch (error) {
      logger.error('Error in updatePayoutSchedule:', error);
      throw error;
    }
  }

  /**
   * Get payout history
   */
  async getPayoutHistory(userId, page = 1, limit = 10) {
    try {
      const vendor = await Vendor.findOne({ user: userId });
      
      if (!vendor) {
        throw new AppError('Vendor profile not found', 404);
      }

      const Payment = require('../models/Payment.model');
      const skip = (page - 1) * limit;

      const [payouts, total] = await Promise.all([
        Payment.find({ 
          vendor: userId,
          type: 'payout'
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
        Payment.countDocuments({ vendor: userId, type: 'payout' })
      ]);

      return {
        payouts,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getPayoutHistory:', error);
      throw error;
    }
  }

  /**
   * Update business hours
   */
  async updateBusinessHours(userId, businessHours) {
    try {
      const vendor = await Vendor.findOne({ user: userId });
      
      if (!vendor) {
        throw new AppError('Vendor profile not found', 404);
      }

      vendor.settings.businessHours = businessHours;
      await vendor.save();

      return vendor.settings.businessHours;
    } catch (error) {
      logger.error('Error in updateBusinessHours:', error);
      throw error;
    }
  }

  /**
   * Update notification preferences
   */
  async updateNotificationPreferences(userId, preferences) {
    try {
      const vendor = await Vendor.findOne({ user: userId });
      
      if (!vendor) {
        throw new AppError('Vendor profile not found', 404);
      }

      vendor.settings.notificationPreferences = {
        ...vendor.settings.notificationPreferences,
        ...preferences,
      };
      await vendor.save();

      return vendor.settings.notificationPreferences;
    } catch (error) {
      logger.error('Error in updateNotificationPreferences:', error);
      throw error;
    }
  }

  /**
   * Get vendor reviews
   */
  async getVendorReviews(userId, page = 1, limit = 10) {
    try {
      const skip = (page - 1) * limit;

      const [reviews, total] = await Promise.all([
        Review.find({ vendor: userId })
          .populate('user', 'profile.firstName profile.lastName profile.avatar')
          .populate('product', 'basicInfo.name')
          .populate('rental', 'rentalNumber')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Review.countDocuments({ vendor: userId })
      ]);

      // Calculate rating distribution
      const distribution = await Review.aggregate([
        { $match: { vendor: userId } },
        {
          $group: {
            _id: '$ratings.overall',
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      const distributionMap = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      distribution.forEach(d => {
        distributionMap[d._id] = d.count;
      });

      return {
        reviews,
        distribution: distributionMap,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getVendorReviews:', error);
      throw error;
    }
  }

  /**
   * Reply to review
   */
  async replyToReview(userId, reviewId, reply) {
    try {
      const review = await Review.findById(reviewId);
      
      if (!review) {
        throw new AppError('Review not found', 404);
      }

      // Check if vendor owns this review
      if (review.vendor.toString() !== userId.toString()) {
        throw new AppError('Unauthorized to reply to this review', 403);
      }

      review.responses.push({
        user: userId,
        content: reply,
        isVendorResponse: true,
        createdAt: new Date(),
      });

      await review.save();

      // Notify user
      await addJob('notification', 'create', {
        userId: review.user,
        type: 'in_app',
        title: 'Vendor Responded to Your Review',
        content: `The vendor has responded to your review.`,
        data: { reviewId: review._id },
      });

      return review.responses[review.responses.length - 1];
    } catch (error) {
      logger.error('Error in replyToReview:', error);
      throw error;
    }
  }

  /**
   * Get pending verifications (admin only)
   */
  async getPendingVerifications() {
    try {
      const vendors = await Vendor.find({
        'verification.status': 'pending'
      })
      .populate('user', 'email phone profile.firstName profile.lastName')
      .sort({ createdAt: 1 })
      .lean();

      return vendors;
    } catch (error) {
      logger.error('Error in getPendingVerifications:', error);
      throw error;
    }
  }

  /**
   * Approve vendor (admin only)
   */
  async approveVendor(vendorId, adminId, commission) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const vendor = await Vendor.findOne({ vendorId }).session(session);
      
      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      vendor.verification.status = 'verified';
      vendor.verification.verifiedAt = new Date();
      vendor.verification.verifiedBy = adminId;
      vendor.status.isOnboarded = true;
      vendor.status.onboardedAt = new Date();

      if (commission) {
        vendor.commission.rate = commission;
      }

      await vendor.save({ session });

      // Update user role if not already vendor
      await User.findByIdAndUpdate(
        vendor.user,
        { role: 'vendor' },
        { session }
      );

      await session.commitTransaction();

      // Emit event
      eventEmitter.emit(EVENTS.VENDOR.APPROVED, {
        vendorId: vendor.vendorId,
        userId: vendor.user,
        businessName: vendor.business.name,
        email: vendor.user?.email,
        ownerName: vendor.user?.profile?.firstName + ' ' + vendor.user?.profile?.lastName,
        approvedBy: adminId,
      });

      return vendor;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in approveVendor:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Reject vendor (admin only)
   */
  async rejectVendor(vendorId, adminId, reason) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const vendor = await Vendor.findOne({ vendorId }).session(session);
      
      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      vendor.verification.status = 'rejected';
      vendor.verification.rejectionReason = reason;
      vendor.verification.verifiedAt = new Date();
      vendor.verification.verifiedBy = adminId;

      await vendor.save({ session });

      await session.commitTransaction();

      // Emit event
      eventEmitter.emit(EVENTS.VENDOR.REJECTED, {
        vendorId: vendor.vendorId,
        userId: vendor.user,
        businessName: vendor.business.name,
        email: vendor.user?.email,
        ownerName: vendor.user?.profile?.firstName + ' ' + vendor.user?.profile?.lastName,
        reason,
        rejectedBy: adminId,
      });

      return vendor;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in rejectVendor:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Suspend vendor (admin only)
   */
  async suspendVendor(vendorId, adminId, reason) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const vendor = await Vendor.findOne({ vendorId }).session(session);
      
      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      vendor.status.isActive = false;
      vendor.status.isBlocked = true;
      vendor.status.blockReason = reason;
      vendor.status.blockedAt = new Date();
      vendor.status.blockedBy = adminId;

      await vendor.save({ session });

      // Deactivate all products
      await Product.updateMany(
        { vendor: vendor.user },
        { $set: { 'status.isActive': false } },
        { session }
      );

      await session.commitTransaction();

      // Emit event
      eventEmitter.emit(EVENTS.VENDOR.SUSPENDED, {
        vendorId: vendor.vendorId,
        userId: vendor.user,
        businessName: vendor.business.name,
        email: vendor.user?.email,
        reason,
        suspendedBy: adminId,
      });

      return vendor;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in suspendVendor:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Reinstate vendor (admin only)
   */
  async reinstateVendor(vendorId, adminId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const vendor = await Vendor.findOne({ vendorId }).session(session);
      
      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      vendor.status.isActive = true;
      vendor.status.isBlocked = false;
      vendor.status.blockReason = null;
      vendor.status.blockedAt = null;
      vendor.status.blockedBy = null;

      await vendor.save({ session });

      // Reactivate products
      await Product.updateMany(
        { vendor: vendor.user },
        { $set: { 'status.isActive': true } },
        { session }
      );

      await session.commitTransaction();

      // Emit event
      eventEmitter.emit('vendor:reinstated', {
        vendorId: vendor.vendorId,
        userId: vendor.user,
        businessName: vendor.business.name,
        email: vendor.user?.email,
        reinstatedBy: adminId,
      });

      return vendor;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in reinstateVendor:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get all vendors (admin only)
   */
  async getAllVendors(page = 1, limit = 10, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = {};
      if (filters.verificationStatus) {
        query['verification.status'] = filters.verificationStatus;
      }
      if (filters.status) {
        query['status.isActive'] = filters.status === 'active';
      }
      if (filters.plan) {
        query['subscription.plan'] = filters.plan;
      }
      if (filters.search) {
        query.$or = [
          { 'business.name': new RegExp(filters.search, 'i') },
          { 'vendorId': new RegExp(filters.search, 'i') }
        ];
      }

      const [vendors, total] = await Promise.all([
        Vendor.find(query)
          .populate('user', 'email phone profile.firstName profile.lastName')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Vendor.countDocuments(query)
      ]);

      return {
        vendors,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getAllVendors:', error);
      throw error;
    }
  }

  /**
   * Get top vendors (public)
   */
  async getTopVendors(limit = 10) {
    try {
      const vendors = await Vendor.find({
        'status.isActive': true,
        'verification.status': 'verified'
      })
      .populate('user', 'profile.firstName profile.lastName profile.avatar')
      .sort({ 'performance.rating.average': -1, 'performance.metrics.completedRentals': -1 })
      .limit(limit)
      .select('vendorId business.name performance.rating performance.metrics.completedRentals')
      .lean();

      return vendors;
    } catch (error) {
      logger.error('Error in getTopVendors:', error);
      return [];
    }
  }

  /**
   * Check vendor availability for rental
   */
  async checkVendorAvailability(vendorId, productId, startDate, endDate) {
    try {
      const vendor = await Vendor.findOne({ vendorId });
      
      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      // Check if vendor is active
      if (!vendor.status.isActive || vendor.status.isBlocked) {
        return { available: false, reason: 'Vendor is not active' };
      }

      // Check if vendor is verified
      if (vendor.verification.status !== 'verified') {
        return { available: false, reason: 'Vendor is not verified' };
      }

      // Check if product exists and belongs to vendor
      const product = await Product.findOne({ 
        _id: productId,
        vendor: vendor.user
      });

      if (!product) {
        return { available: false, reason: 'Product not found or does not belong to this vendor' };
      }

      // Check product availability
      if (!product.status.isActive || product.inventory.availableQuantity < 1) {
        return { available: false, reason: 'Product is not available' };
      }

      // Check vendor's serviceable area (would need address pincode)
      // This would require the delivery address pincode

      return { 
        available: true,
        vendor,
        product
      };
    } catch (error) {
      logger.error('Error in checkVendorAvailability:', error);
      throw error;
    }
  }



  getDateRange(period) {
    const end = new Date();
    let start;
    
    switch(period) {
      case '7d': start = moment().subtract(7, 'days').toDate(); break;
      case '30d': start = moment().subtract(30, 'days').toDate(); break;
      case '90d': start = moment().subtract(90, 'days').toDate(); break;
      case '1y': start = moment().subtract(1, 'year').toDate(); break;
      default: start = moment().subtract(30, 'days').toDate();
    }
    
    return { start, end };
  }

  async getOverview(vendorId, period) {
    const dateRange = this.getDateRange(period);
    
    const [revenue, rentals, products, ratings] = await Promise.all([
      this.getRevenueOverview(vendorId, dateRange),
      this.getRentalOverview(vendorId, dateRange),
      this.getProductOverview(vendorId),
      this.getRatingOverview(vendorId, dateRange)
    ]);
    
    // Calculate growth rates
    const previousPeriod = {
      start: moment(dateRange.start).subtract(moment(dateRange.end).diff(dateRange.start), 'ms').toDate(),
      end: dateRange.start
    };
    
    const previousRevenue = await this.getRevenueTotal(vendorId, previousPeriod);
    const previousRentals = await this.getRentalCount(vendorId, previousPeriod);
    
    return {
      period,
      kpi: {
        revenue: {
          current: revenue.total,
          previous: previousRevenue,
          growth: previousRevenue ? ((revenue.total - previousRevenue) / previousRevenue) * 100 : 0
        },
        rentals: {
          current: rentals.total,
          previous: previousRentals,
          growth: previousRentals ? ((rentals.total - previousRentals) / previousRentals) * 100 : 0
        },
        activeProducts: products.active,
        averageRating: ratings.average,
        totalCustomers: rentals.uniqueCustomers
      },
      revenueByDay: revenue.daily,
      rentalsByStatus: rentals.byStatus,
      recentActivity: await this.getRecentActivity(vendorId, dateRange)
    };
  }

  async getRevenueTotal(vendorId, dateRange) {
    const result = await Payment.aggregate([
      { $match: { vendor: vendorId, status: 'success', createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    return result[0]?.total || 0;
  }

  async getRevenueOverview(vendorId, dateRange) {
    const result = await Payment.aggregate([
      { $match: { vendor: vendorId, status: 'success', createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
      {
        $facet: {
          total: [{ $group: { _id: null, amount: { $sum: '$amount' } } }],
          daily: [
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                amount: { $sum: '$amount' },
                count: { $sum: 1 }
              }
            },
            { $sort: { _id: 1 } }
          ],
          byType: [
            { $group: { _id: '$type', amount: { $sum: '$amount' }, count: { $sum: 1 } } }
          ],
          byMethod: [
            { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } }
          ]
        }
      }
    ]);
    
    return {
      total: result[0]?.total[0]?.amount || 0,
      daily: result[0]?.daily || [],
      byType: result[0]?.byType || [],
      byMethod: result[0]?.byMethod || []
    };
  }

  async getRentalOverview(vendorId, dateRange) {
    const result = await Rental.aggregate([
      { $match: { vendor: vendorId, createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
      {
        $facet: {
          total: [{ $group: { _id: null, count: { $sum: 1 } } }],
          uniqueCustomers: [{ $group: { _id: '$user' } }, { $count: 'count' }],
          byStatus: [
            { $group: { _id: '$status', count: { $sum: 1 } } }
          ],
          byMonth: [
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
                count: { $sum: 1 }
              }
            },
            { $sort: { _id: 1 } }
          ]
        }
      }
    ]);
    
    return {
      total: result[0]?.total[0]?.count || 0,
      uniqueCustomers: result[0]?.uniqueCustomers[0]?.count || 0,
      byStatus: result[0]?.byStatus || [],
      byMonth: result[0]?.byMonth || []
    };
  }

  async getProductOverview(vendorId) {
    const result = await Product.aggregate([
      { $match: { vendor: vendorId } },
      {
        $facet: {
          total: [{ $count: 'count' }],
          active: [
            { $match: { 'status.isActive': true } },
            { $count: 'count' }
          ],
          outOfStock: [
            { $match: { 'inventory.availableQuantity': 0 } },
            { $count: 'count' }
          ],
          lowStock: [
            { $match: { 'inventory.availableQuantity': { $lt: 5 } } },
            { $count: 'count' }
          ]
        }
      }
    ]);
    
    return {
      total: result[0]?.total[0]?.count || 0,
      active: result[0]?.active[0]?.count || 0,
      outOfStock: result[0]?.outOfStock[0]?.count || 0,
      lowStock: result[0]?.lowStock[0]?.count || 0
    };
  }

  async getRatingOverview(vendorId, dateRange) {
    const result = await Review.aggregate([
      { $match: { vendor: vendorId, createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
      {
        $group: {
          _id: null,
          average: { $avg: '$ratings.overall' },
          total: { $sum: 1 },
          distribution: {
            $push: '$ratings.overall'
          }
        }
      }
    ]);
    
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (result[0]?.distribution) {
      result[0].distribution.forEach(r => distribution[r]++);
    }
    
    return {
      average: result[0]?.average || 0,
      total: result[0]?.total || 0,
      distribution
    };
  }

  async getRecentActivity(vendorId, dateRange) {
    const recentRentals = await Rental.find({ vendor: vendorId })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('user', 'profile.firstName profile.lastName')
      .populate('product', 'basicInfo.name')
      .lean();
    
    return recentRentals.map(r => ({
      id: r._id,
      type: 'rental',
      action: `New rental order`,
      customer: `${r.user?.profile?.firstName || ''} ${r.user?.profile?.lastName || ''}`,
      product: r.product?.basicInfo?.name,
      amount: r.rentalDetails?.totalAmount,
      status: r.status,
      time: r.createdAt
    }));
  }

  async getSalesReport(vendorId, period) {
    const dateRange = this.getDateRange(period);
    
    const [revenue, rentals, topProducts] = await Promise.all([
      this.getRevenueOverview(vendorId, dateRange),
      this.getRentalOverview(vendorId, dateRange),
      this.getTopProducts(vendorId, dateRange, 10)
    ]);
    
    // Calculate monthly trends
    const monthlyTrends = await Payment.aggregate([
      { 
        $match: { 
          vendor: vendorId, 
          status: 'success',
          createdAt: { $gte: dateRange.start, $lte: dateRange.end }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          revenue: { $sum: '$amount' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    return {
      period,
      summary: {
        totalRevenue: revenue.total,
        totalOrders: rentals.total,
        averageOrderValue: rentals.total ? revenue.total / rentals.total : 0,
        uniqueCustomers: rentals.uniqueCustomers
      },
      dailyRevenue: revenue.daily,
      monthlyTrends,
      topProducts,
      revenueByType: revenue.byType,
      revenueByMethod: revenue.byMethod
    };
  }

  async getTopProducts(vendorId, dateRange, limit = 10) {
    const result = await Rental.aggregate([
      { $match: { vendor: vendorId, createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
      {
        $group: {
          _id: '$product',
          totalRentals: { $sum: 1 },
          totalRevenue: { $sum: '$rentalDetails.totalAmount' },
          uniqueCustomers: { $addToSet: '$user' }
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $project: {
          productId: '$_id',
          name: '$product.basicInfo.name',
          category: '$product.category',
          monthlyRent: '$product.pricing.monthlyRent',
          totalRentals: 1,
          totalRevenue: 1,
          uniqueCustomers: { $size: '$uniqueCustomers' },
          image: { $arrayElemAt: ['$product.media.images.url', 0] }
        }
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: limit }
    ]);
    
    return result;
  }

  async getProductPerformance(vendorId, period, limit = 10) {
    const dateRange = this.getDateRange(period);
    
    const [topProducts, categoryBreakdown, inventoryStatus] = await Promise.all([
      this.getTopProducts(vendorId, dateRange, limit),
      this.getCategoryBreakdown(vendorId, dateRange),
      this.getInventoryStatus(vendorId)
    ]);
    
    // Get product views (would need product analytics collection)
    const productViews = await this.getProductViews(vendorId, dateRange);
    
    return {
      period,
      topProducts: topProducts.map(p => ({
        ...p,
        views: productViews[p.productId] || 0,
        conversionRate: productViews[p.productId] ? (p.totalRentals / productViews[p.productId]) * 100 : 0
      })),
      categoryBreakdown,
      inventoryStatus,
      totalProducts: await Product.countDocuments({ vendor: vendorId }),
      activeProducts: await Product.countDocuments({ vendor: vendorId, 'status.isActive': true })
    };
  }

  async getCategoryBreakdown(vendorId, dateRange) {
    const result = await Rental.aggregate([
      { $match: { vendor: vendorId, createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $lookup: {
          from: 'categories',
          localField: 'product.category',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: '$category' },
      {
        $group: {
          _id: '$category.name',
          totalRentals: { $sum: 1 },
          totalRevenue: { $sum: '$rentalDetails.totalAmount' }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);
    
    return result;
  }

  async getInventoryStatus(vendorId) {
    const result = await Product.aggregate([
      { $match: { vendor: vendorId } },
      {
        $group: {
          _id: null,
          totalInventory: { $sum: '$inventory.totalQuantity' },
          availableInventory: { $sum: '$inventory.availableQuantity' },
          rentedInventory: { $sum: '$inventory.rentedQuantity' },
          lowStockProducts: {
            $sum: { $cond: [{ $lt: ['$inventory.availableQuantity', 5] }, 1, 0] }
          },
          outOfStockProducts: {
            $sum: { $cond: [{ $eq: ['$inventory.availableQuantity', 0] }, 1, 0] }
          }
        }
      }
    ]);
    
    const stats = result[0] || { totalInventory: 0, availableInventory: 0, rentedInventory: 0, lowStockProducts: 0, outOfStockProducts: 0 };
    
    return {
      ...stats,
      utilizationRate: stats.totalInventory ? (stats.rentedInventory / stats.totalInventory) * 100 : 0
    };
  }

  async getProductViews(vendorId, dateRange) {
    // This would query a product_views collection
    // For now, return mock data based on rental counts
    const rentals = await Rental.aggregate([
      { $match: { vendor: vendorId, createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
      { $group: { _id: '$product', count: { $sum: 1 } } }
    ]);
    
    const views = {};
    rentals.forEach(r => {
      views[r._id] = r.count * 10; // Assume 10 views per rental
    });
    
    return views;
  }

  async getCustomerInsights(vendorId, period) {
    const dateRange = this.getDateRange(period);
    
    const customerData = await Rental.aggregate([
      { $match: { vendor: vendorId, createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
      {
        $group: {
          _id: '$user',
          totalSpent: { $sum: '$rentalDetails.totalAmount' },
          totalRentals: { $sum: 1 },
          lastRental: { $max: '$createdAt' },
          firstRental: { $min: '$createdAt' },
          products: { $addToSet: '$product' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          customerId: '$_id',
          name: { $concat: ['$user.profile.firstName', ' ', '$user.profile.lastName'] },
          email: '$user.email',
          phone: '$user.phone',
          totalSpent: 1,
          totalRentals: 1,
          lastRental: 1,
          firstRental: 1,
          uniqueProducts: { $size: '$products' }
        }
      },
      { $sort: { totalSpent: -1 } }
    ]);
    
    // Calculate segments
    const segments = {
      vip: customerData.filter(c => c.totalSpent > 50000),
      frequent: customerData.filter(c => c.totalRentals >= 3 && c.totalSpent <= 50000),
      regular: customerData.filter(c => c.totalRentals === 2 && c.totalSpent <= 25000),
      new: customerData.filter(c => c.totalRentals === 1 && c.totalSpent <= 10000)
    };
    
    // Calculate repeat rate
    const repeatCustomers = customerData.filter(c => c.totalRentals > 1).length;
    const repeatRate = customerData.length ? (repeatCustomers / customerData.length) * 100 : 0;
    
    // Calculate average LTV
    const avgLTV = customerData.length ? customerData.reduce((sum, c) => sum + c.totalSpent, 0) / customerData.length : 0;
    
    // Get top customers
    const topCustomers = customerData.slice(0, 10);
    
    // Get recent customers
    const recentCustomers = await Rental.aggregate([
      { $match: { vendor: vendorId } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$user', lastOrder: { $first: '$createdAt' } } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' }
    ]);
    
    return {
      period,
      summary: {
        totalCustomers: customerData.length,
        repeatCustomers,
        repeatRate,
        avgLTV,
        vipCount: segments.vip.length,
        frequentCount: segments.frequent.length
      },
      segments,
      topCustomers,
      customerList: customerData
    };
  }
}

module.exports = new VendorService();