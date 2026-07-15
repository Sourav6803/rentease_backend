const { Vendor, User, Address, Notification } = require('../models');
const  AppError  = require('../utils/AppError');
const { addJob } = require('../jobs');
const { eventEmitter, EVENTS } = require('../events');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');

class AdminVendorService {
  constructor() {
    this.redisClient = getRedisClient();
  }

  /**
   * Get all vendors with filters (admin only)
   */
  // async getAllVendors(page = 1, limit = 20, filters = {}) {
  //   try {
  //     const skip = (page - 1) * limit;

  //     console.log('getAllVendors called with filters:', filters)

  //     const query = {};
      
  //     // if (filters.verificationStatus) {
  //     //   query['verification.status'] = filters.verificationStatus;
  //     // }
      
  //     // if (filters.status) {
  //     //   query['status.isActive'] = filters.status === 'active';
  //     // }

  //     if (filters.status) {
  //       query['verification.status'] = filters.status;
  //     }

  //     if (filters.isActive) {
  //       query['status.isActive'] = filters.isActive === 'active';
  //     }
      
  //     if (filters.plan) {
  //       query['subscription.plan'] = filters.plan;
  //     }
      
  //     if (filters.search) {
  //       query.$or = [
  //         { 'business.name': new RegExp(filters.search, 'i') },
  //         { vendorId: new RegExp(filters.search, 'i') },
  //         { 'business.gstin': new RegExp(filters.search, 'i') }
  //       ];
  //     }

  //     console.log("query-->", query)

  //     const [vendors, total] = await Promise.all([
  //       Vendor.find(query)
  //         .populate('user', 'email phone profile')
  //         .populate('addresses.registeredOffice')
  //         .sort({ createdAt: -1 })
  //         .skip(skip)
  //         .limit(limit)
  //         .lean(),
  //       Vendor.countDocuments(query)
  //     ]);

  //     // Add summary stats
  //     const summary = await Vendor.aggregate([
  //       {
  //         $group: {
  //           _id: '$verification.status',
  //           count: { $sum: 1 }
  //         }
  //       }
  //     ]);

  //     const statusSummary = {
  //       pending: 0,
  //       verified: 0,
  //       rejected: 0,
  //       suspended: 0,
  //       total: total
  //     };
      
  //     summary.forEach(s => {
  //       statusSummary[s._id] = s.count;
  //     });

  //     return {
  //       vendors,
  //       summary: statusSummary,
  //       pagination: {
  //         page,
  //         limit,
  //         total,
  //         pages: Math.ceil(total / limit)
  //       }
  //     };
  //   } catch (error) {
  //     logger.error('Error in getAllVendors:', error);
  //     throw error;
  //   }
  // }

   /**
   * Get all vendors with filters (admin only)
   */
  async getAllVendors(page = 1, limit = 20, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      logger.info('getAllVendors called with filters:', filters);

      const query = {};
      
      if (filters.status && filters.status !== 'all') {
        query['verification.status'] = filters.status;
      }

      if (filters.isActive && filters.isActive !== 'all') {
        query['status.isActive'] = filters.isActive === 'active';
      }
      
      if (filters.plan && filters.plan !== 'all') {
        query['subscription.plan'] = filters.plan;
      }
      
      if (filters.search) {
        query.$or = [
          { 'business.name': { $regex: filters.search, $options: 'i' } },
          { vendorId: { $regex: filters.search, $options: 'i' } },
          { 'business.gstin': { $regex: filters.search, $options: 'i' } }
        ];
      }

      logger.info("Query:", JSON.stringify(query));

      const [vendors, total] = await Promise.all([
        Vendor.find(query)
          .populate('user', 'email phone profile')
          .populate('addresses.registeredOffice')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Vendor.countDocuments(query)
      ]);

      // Add summary stats
      const summary = await Vendor.aggregate([
        {
          $group: {
            _id: '$verification.status',
            count: { $sum: 1 }
          }
        }
      ]);

      const statusSummary = {
        pending: 0,
        verified: 0,
        rejected: 0,
        suspended: 0,
        total: total
      };
      
      summary.forEach(s => {
        if (s._id && statusSummary.hasOwnProperty(s._id)) {
          statusSummary[s._id] = s.count;
        }
      });

      return {
        vendors,
        summary: statusSummary,
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
   * Get pending vendors (awaiting approval)
   */
  async getPendingVendors(page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit;

      const [vendors, total] = await Promise.all([
        Vendor.find({ 'verification.status': 'pending' })
          .populate('user', 'email phone profile')
          .populate('addresses.registeredOffice')
          .sort({ createdAt: 1 }) // Oldest first
          .skip(skip)
          .limit(limit)
          .lean(),
        Vendor.countDocuments({ 'verification.status': 'pending' })
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
      logger.error('Error in getPendingVendors:', error);
      throw error;
    }
  }

  /**
   * Get vendor details for admin review
   */
  async getVendorForReview(vendorId) {
    try {
      const vendor = await Vendor.findOne({ vendorId })
        .populate('user', 'email phone profile verification')
        .populate('addresses.registeredOffice')
        .populate('addresses.warehouse')
        .lean();

      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      // Get additional statistics
      const stats = {
        totalProducts: await mongoose.model('Product').countDocuments({ vendor: vendor.user }),
        totalRentals: await mongoose.model('Rental').countDocuments({ vendor: vendor.user }),
        totalRevenue: await mongoose.model('Payment').aggregate([
          { $match: { vendor: vendor.user, status: 'success' } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]).then(r => r[0]?.total || 0)
      };

      return { ...vendor, stats };
    } catch (error) {
      logger.error('Error in getVendorForReview:', error);
      throw error;
    }
  }

  /**
   * Approve vendor
   */
  async approveVendor(vendorId, adminId, approvalData = {}) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { commissionRate, notes, sendEmail = true } = approvalData;

      console.log('approveVendor called with:', { vendorId, adminId })

      const vendor = await Vendor.findOne({_id: vendorId }).session(session);
      
      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      if (vendor.verification.status !== 'pending') {
        throw new AppError(`Vendor is already ${vendor.verification.status}`, 400);
      }

      // Update vendor verification status
      vendor.verification.status = 'verified';
      vendor.verification.verifiedAt = new Date();
      vendor.verification.verifiedBy = adminId;
      
      if (commissionRate) {
        vendor.commission.rate = commissionRate;
      }
      
      if (notes) {
        vendor.metadata.notes = notes;
      }

      // Set onboarding status
      vendor.status.isOnboarded = true;
      vendor.status.onboardedAt = new Date();

      await vendor.save({ session });

      // Update user role if needed
      await User.findByIdAndUpdate(
        vendor.user,
        { role: 'vendor' },
        { session }
      );

      await session.commitTransaction();

      // Send approval email
      if (sendEmail) {
        await this.sendVendorApprovalEmail(vendor);
      }

      // Create notification
      await this.createVendorNotification(vendor.user, 'approved');

      // Emit event
      eventEmitter.emit(EVENTS.VENDOR.APPROVED, {
        vendorId: vendor.vendorId,
        userId: vendor.user,
        businessName: vendor.business.name,
        email: vendor.contact.primaryEmail,
        ownerName: `${vendor.user?.profile?.firstName} ${vendor.user?.profile?.lastName}`,
        approvedBy: adminId
      });

      // Log action
      await this.logVendorAction(vendorId, adminId, 'APPROVED', approvalData);

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
   * Reject vendor
   */
  async rejectVendor(vendorId, adminId, rejectionData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { reason, notes, sendEmail = true } = rejectionData;

      if (!reason) {
        throw new AppError('Rejection reason is required', 400);
      }

      const vendor = await Vendor.findOne({ vendorId }).session(session);
      
      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      if (vendor.verification.status !== 'pending') {
        throw new AppError(`Vendor is already ${vendor.verification.status}`, 400);
      }

      // Update vendor verification status
      vendor.verification.status = 'rejected';
      vendor.verification.rejectionReason = reason;
      vendor.verification.verifiedAt = new Date();
      vendor.verification.verifiedBy = adminId;
      
      if (notes) {
        vendor.metadata.notes = notes;
      }

      await vendor.save({ session });

      // Update user status
      await User.findByIdAndUpdate(
        vendor.user,
        { 'status.isActive': false },
        { session }
      );

      await session.commitTransaction();

      // Send rejection email
      if (sendEmail) {
        await this.sendVendorRejectionEmail(vendor, reason);
      }

      // Create notification
      await this.createVendorNotification(vendor.user, 'rejected', { reason });

      // Emit event
      eventEmitter.emit(EVENTS.VENDOR.REJECTED, {
        vendorId: vendor.vendorId,
        userId: vendor.user,
        businessName: vendor.business.name,
        email: vendor.contact.primaryEmail,
        ownerName: `${vendor.user?.profile?.firstName} ${vendor.user?.profile?.lastName}`,
        reason,
        rejectedBy: adminId
      });

      // Log action
      await this.logVendorAction(vendorId, adminId, 'REJECTED', rejectionData);

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
   * Suspend vendor
   */
  async suspendVendor(vendorId, adminId, suspensionData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { reason, notes, duration, sendEmail = true } = suspensionData;

      if (!reason) {
        throw new AppError('Suspension reason is required', 400);
      }

      const vendor = await Vendor.findOne({ vendorId }).session(session);
      
      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      // Update vendor status
      vendor.status.isActive = false;
      vendor.status.isBlocked = true;
      vendor.status.blockReason = reason;
      vendor.status.blockedAt = new Date();
      vendor.status.blockedBy = adminId;
      
      if (notes) {
        vendor.metadata.notes = notes;
      }

      // Deactivate all products
      await mongoose.model('Product').updateMany(
        { vendor: vendor.user },
        { $set: { 'status.isActive': false } },
        { session }
      );

      await vendor.save({ session });

      await session.commitTransaction();

      // Send suspension email
      if (sendEmail) {
        await this.sendVendorSuspensionEmail(vendor, reason, duration);
      }

      // Create notification
      await this.createVendorNotification(vendor.user, 'suspended', { reason });

      // Emit event
      eventEmitter.emit(EVENTS.VENDOR.SUSPENDED, {
        vendorId: vendor.vendorId,
        userId: vendor.user,
        businessName: vendor.business.name,
        email: vendor.contact.primaryEmail,
        reason,
        suspendedBy: adminId
      });

      // Log action
      await this.logVendorAction(vendorId, adminId, 'SUSPENDED', suspensionData);

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
   * Reinstate vendor
   */
  async reinstateVendor(vendorId, adminId, reinstatementData = {}) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { notes, sendEmail = true } = reinstatementData;

      const vendor = await Vendor.findOne({ vendorId }).session(session);
      
      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      if (!vendor.status.isBlocked) {
        throw new AppError('Vendor is not suspended', 400);
      }

      // Update vendor status
      vendor.status.isActive = true;
      vendor.status.isBlocked = false;
      vendor.status.blockReason = null;
      vendor.status.blockedAt = null;
      vendor.status.blockedBy = null;
      
      if (notes) {
        vendor.metadata.notes = notes;
      }

      // Reactivate products
      await mongoose.model('Product').updateMany(
        { vendor: vendor.user },
        { $set: { 'status.isActive': true } },
        { session }
      );

      await vendor.save({ session });

      await session.commitTransaction();

      // Send reinstatement email
      if (sendEmail) {
        await this.sendVendorReinstatementEmail(vendor);
      }

      // Create notification
      await this.createVendorNotification(vendor.user, 'reinstated');

      // Emit event
      eventEmitter.emit('vendor:reinstated', {
        vendorId: vendor.vendorId,
        userId: vendor.user,
        businessName: vendor.business.name,
        email: vendor.contact.primaryEmail,
        reinstatedBy: adminId
      });

      // Log action
      await this.logVendorAction(vendorId, adminId, 'REINSTATED', reinstatementData);

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
   * Update vendor commission
   */
  async updateVendorCommission(vendorId, adminId, commissionData) {
    try {
      const { rate, type, fixedAmount, monthlyCap, specialRates } = commissionData;

      const vendor = await Vendor.findOne({ vendorId });
      
      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      if (rate !== undefined) vendor.commission.rate = rate;
      if (type) vendor.commission.type = type;
      if (fixedAmount !== undefined) vendor.commission.fixedAmount = fixedAmount;
      if (monthlyCap !== undefined) vendor.commission.monthlyCap = monthlyCap;
      if (specialRates) vendor.commission.specialRates = specialRates;

      await vendor.save();

      // Log action
      await this.logVendorAction(vendorId, adminId, 'COMMISSION_UPDATED', commissionData);

      return vendor.commission;
    } catch (error) {
      logger.error('Error in updateVendorCommission:', error);
      throw error;
    }
  }

  /**
   * Get vendor documents for review
   */
  async getVendorDocuments(vendorId) {
    try {
      const vendor = await Vendor.findOne({ vendorId })
        .select('verification.documents business.name vendorId')
        .lean();

      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      return vendor.verification.documents;
    } catch (error) {
      logger.error('Error in getVendorDocuments:', error);
      throw error;
    }
  }

  /**
   * Verify vendor document
   */
  async verifyVendorDocument(vendorId, documentIndex, adminId, verificationData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { verified, remarks } = verificationData;

      const vendor = await Vendor.findOne({ vendorId }).session(session);
      
      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      if (!vendor.verification.documents[documentIndex]) {
        throw new AppError('Document not found', 404);
      }

      vendor.verification.documents[documentIndex].verifiedAt = new Date();
      vendor.verification.documents[documentIndex].verifiedBy = adminId;
      vendor.verification.documents[documentIndex].remarks = remarks;

      if (verified === false) {
        vendor.verification.documents[documentIndex].status = 'rejected';
      }

      await vendor.save({ session });

      await session.commitTransaction();

      // Log action
      await this.logVendorAction(vendorId, adminId, 'DOCUMENT_VERIFIED', {
        documentIndex,
        verified,
        remarks
      });

      return vendor.verification.documents[documentIndex];
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in verifyVendorDocument:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get vendor statistics for admin dashboard
   */
  async getVendorStats() {
    try {
      const stats = await Vendor.aggregate([
        {
          $facet: {
            overview: [
              {
                $group: {
                  _id: null,
                  totalVendors: { $sum: 1 },
                  activeVendors: {
                    $sum: { $cond: [{ $eq: ['$status.isActive', true] }, 1, 0] }
                  },
                  pendingApproval: {
                    $sum: { $cond: [{ $eq: ['$verification.status', 'pending'] }, 1, 0] }
                  },
                  verified: {
                    $sum: { $cond: [{ $eq: ['$verification.status', 'verified'] }, 1, 0] }
                  },
                  rejected: {
                    $sum: { $cond: [{ $eq: ['$verification.status', 'rejected'] }, 1, 0] }
                  },
                  suspended: {
                    $sum: { $cond: [{ $eq: ['$verification.status', 'suspended'] }, 1, 0] }
                  }
                }
              }
            ],
            byPlan: [
              {
                $group: {
                  _id: '$subscription.plan',
                  count: { $sum: 1 }
                }
              }
            ],
            recentRegistrations: [
              { $sort: { createdAt: -1 } },
              { $limit: 10 },
              {
                $lookup: {
                  from: 'users',
                  localField: 'user',
                  foreignField: '_id',
                  as: 'user'
                }
              },
              { $unwind: '$user' },
              {
                $project: {
                  vendorId: 1,
                  businessName: '$business.name',
                  email: '$user.email',
                  phone: '$user.phone',
                  status: '$verification.status',
                  createdAt: 1
                }
              }
            ]
          }
        }
      ]);

      return stats[0] || {};
    } catch (error) {
      logger.error('Error in getVendorStats:', error);
      throw error;
    }
  }

  /**
   * Send vendor approval email
   */
  async sendVendorApprovalEmail(vendor) {
    const user = await User.findById(vendor.user);
    const loginUrl = `${process.env.CLIENT_URL}/login`;
    const dashboardUrl = `${process.env.CLIENT_URL}/vendor/dashboard`;

    await addJob('email', 'send', {
      to: user.email,
      subject: 'Congratulations! Your Vendor Account is Approved 🎉',
      template: 'vendor-approved',
      data: {
        name: user.profile.firstName,
        businessName: vendor.business.name,
        loginUrl,
        dashboardUrl,
        commissionRate: vendor.commission.rate,
        nextSteps: [
          'Complete your profile',
          'Add your products',
          'Set up payment details',
          'Configure delivery areas',
          'Start receiving orders'
        ]
      }
    });
  }

  /**
   * Send vendor rejection email
   */
  async sendVendorRejectionEmail(vendor, reason) {
    const user = await User.findById(vendor.user);
    const supportEmail = process.env.SUPPORT_EMAIL || 'support@rentease.com';
    const reapplyUrl = `${process.env.CLIENT_URL}/vendor/reapply`;

    await addJob('email', 'send', {
      to: user.email,
      subject: 'Update on Your Vendor Application - RentEase',
      template: 'vendor-rejected',
      data: {
        name: user.profile.firstName,
        businessName: vendor.business.name,
        reason,
        supportEmail,
        reapplyUrl,
        feedback: 'Please review the feedback and improve your application before reapplying.'
      }
    });
  }

  /**
   * Send vendor suspension email
   */
  async sendVendorSuspensionEmail(vendor, reason, duration) {
    const user = await User.findById(vendor.user);
    const appealUrl = `${process.env.CLIENT_URL}/vendor/appeal-suspension`;
    const supportEmail = process.env.SUPPORT_EMAIL || 'support@rentease.com';

    await addJob('email', 'send', {
      to: user.email,
      subject: 'Important: Your Vendor Account Has Been Suspended',
      template: 'vendor-suspended',
      data: {
        name: user.profile.firstName,
        businessName: vendor.business.name,
        reason,
        duration: duration || 'Until further notice',
        appealUrl,
        supportEmail
      }
    });
  }

  /**
   * Send vendor reinstatement email
   */
  async sendVendorReinstatementEmail(vendor) {
    const user = await User.findById(vendor.user);
    const dashboardUrl = `${process.env.CLIENT_URL}/vendor/dashboard`;

    await addJob('email', 'send', {
      to: user.email,
      subject: 'Your Vendor Account Has Been Reinstated',
      template: 'vendor-reinstated',
      data: {
        name: user.profile.firstName,
        businessName: vendor.business.name,
        dashboardUrl,
        message: 'Your account has been reinstated. You can now resume your business operations.'
      }
    });
  }

  /**
   * Create vendor notification
   */
  async createVendorNotification(userId, type, data = {}) {
    const notifications = {
      approved: {
        title: 'Vendor Account Approved! 🎉',
        content: 'Congratulations! Your vendor account has been approved. Start listing your products now.'
      },
      rejected: {
        title: 'Vendor Application Update',
        content: `Your vendor application was not approved at this time. Reason: ${data.reason || 'Please contact support for more information.'}`
      },
      suspended: {
        title: '⚠️ Account Suspended',
        content: `Your vendor account has been suspended. Reason: ${data.reason || 'Please contact support for more information.'}`
      },
      reinstated: {
        title: 'Account Reinstated ✅',
        content: 'Your vendor account has been reinstated. You can now resume your business operations.'
      }
    };

    const notification = notifications[type];
    if (notification) {
      await addJob('notification', 'create', {
        userId,
        type: 'in_app',
        title: notification.title,
        content: notification.content,
        data: { vendorAction: type, ...data }
      });
    }
  }

  /**
   * Log vendor action for audit
   */
  async logVendorAction(vendorId, adminId, action, details) {
    const AdminActivity = require('../models/AdminActivity.model');
    
    await AdminActivity.create({
      admin: adminId,
      action: `VENDOR_${action}`,
      resource: {
        type: 'VENDOR',
        id: vendorId
      },
      details,
      ipAddress: details.ipAddress,
      timestamp: new Date()
    });
  }
}

module.exports = new AdminVendorService();