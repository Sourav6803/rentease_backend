const { User, Address, Vendor, Admin } = require('../models');
const  Encryption  = require('../utils/encryption');
const  AppError  = require('../utils/AppError');
const { sendEmail } = require('./email.service');
const { addJob } = require('../jobs');
const { eventEmitter, EVENTS } = require('../events');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');

class UserService {
  constructor() {
    this.encryption = Encryption;
    this.redisClient = getRedisClient();
  }

  /**
   * Get user profile by ID
   */
  async getUserProfile(userId) {
    try {
      const user = await User.findById(userId)
        .select('-password -security.refreshTokens -security.passwordResetToken -security.passwordResetExpires')
        .populate('addresses')
        .lean();

      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Get user stats
      const stats = await this.getUserStats(userId);

      return {
        ...user,
        stats,
      };
    } catch (error) {
      logger.error('Error in getUserProfile:', error);
      throw error;
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(userId, updateData) {
    try {
      const { profile, phone, email } = updateData;

      // Check if email is being changed and if it's already taken
      if (email) {
        const existingUser = await User.findOne({ 
          email: email.toLowerCase(),
          _id: { $ne: userId }
        });
        if (existingUser) {
          throw new AppError('Email already in use', 409);
        }
      }

      // Check if phone is being changed and if it's already taken
      if (phone) {
        const existingUser = await User.findOne({ 
          phone,
          _id: { $ne: userId }
        });
        if (existingUser) {
          throw new AppError('Phone number already in use', 409);
        }
      }

      const updateFields = {};
      if (email) updateFields.email = email.toLowerCase();
      if (phone) updateFields.phone = phone;
      if (profile) {
        updateFields['profile.firstName'] = profile.firstName;
        updateFields['profile.lastName'] = profile.lastName;
        if (profile.avatar) updateFields['profile.avatar'] = profile.avatar;
        if (profile.dateOfBirth) updateFields['profile.dateOfBirth'] = profile.dateOfBirth;
        if (profile.gender) updateFields['profile.gender'] = profile.gender;
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { $set: updateFields },
        { new: true, runValidators: true }
      ).select('-password -security.refreshTokens');

      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Emit profile updated event
      eventEmitter.emit(EVENTS.USER.PROFILE_UPDATED, {
        userId: user._id,
        email: user.email,
        changes: Object.keys(updateFields),
      });

      return user;
    } catch (error) {
      logger.error('Error in updateProfile:', error);
      throw error;
    }
  }

  /**
   * Get user addresses
   */
  async getUserAddresses(userId) {
    try {
      const addresses = await Address.find({ user: userId })
        .sort({ isDefault: -1, createdAt: -1 })
        .lean();

      return addresses;
    } catch (error) {
      logger.error('Error in getUserAddresses:', error);
      throw error;
    }
  }

  /**
   * Add new address
   */
  // async addAddress(userId, addressData) {
  //   const session = await mongoose.startSession();
  //   session.startTransaction();

  //   try {
  //     const { isDefault = false } = addressData;

  //     // If this is the first address or set as default, update other addresses
  //     const addressCount = await Address.countDocuments({ user: userId });
      
  //     if (isDefault || addressCount === 0) {
  //       await Address.updateMany(
  //         { user: userId },
  //         { $set: { isDefault: false } },
  //         { session }
  //       );
  //     }

  //     const address = await Address.create([{
  //       user: userId,
  //       ...addressData,
  //       isDefault: addressCount === 0 ? true : isDefault,
  //     }], { session });

  //     await session.commitTransaction();

  //     return address[0];
  //   } catch (error) {
  //     await session.abortTransaction();
  //     logger.error('Error in addAddress:', error);
  //      console.error('❌ Error in addAddress:', error);
  //      console.error('❌ Error stack:', error.stack); // Add this line
  //     throw error;
  //   } finally {
  //     session.endSession();
  //   }
  // }

  // services/address.service.js - Fix the addAddress method

async addAddress(userId, addressData) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { isDefault = false } = addressData;

    // Check if user exists
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Count existing addresses
    const addressCount = await Address.countDocuments({ user: userId });
    
    // Set default for first address or if requested
    const shouldBeDefault = addressCount === 0 ? true : isDefault;
    
    if (shouldBeDefault) {
      // Update all other addresses to not be default
      await Address.updateMany(
        { user: userId },
        { $set: { isDefault: false } },
        { session }
      );
    }

    // Create new address
    const address = await Address.create([{
      user: userId,
      ...addressData,
      isDefault: shouldBeDefault,
    }], { session });

    // IMPORTANT: Add address reference to user's addresses array
    await User.findByIdAndUpdate(
      userId,
      { 
        $push: { addresses: address[0]._id },
        $set: { 'metadata.updatedBy': userId }
      },
      { session }
    );

    await session.commitTransaction();

    // Return populated address
    return await Address.findById(address[0]._id);
  } catch (error) {
    await session.abortTransaction();
    logger.error('Error in addAddress:', error);
    console.error('❌ Error in addAddress:', error);
    throw error;
  } finally {
    session.endSession();
  }
}

// Add method to get user addresses
async getUserAddresses(userId) {
  try {
    const addresses = await Address.find({ user: userId })
      .sort({ isDefault: -1, createdAt: -1 });
    
    return addresses;
  } catch (error) {
    logger.error('Error in getUserAddresses:', error);
    throw error;
  }
}

// Add method to update address
async updateAddress(userId, addressId, updateData) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const address = await Address.findOne({
      _id: addressId,
      user: userId
    }).session(session);

    if (!address) {
      throw new AppError('Address not found', 404);
    }

    // Handle default address update
    if (updateData.isDefault && !address.isDefault) {
      await Address.updateMany(
        { user: userId, _id: { $ne: addressId } },
        { $set: { isDefault: false } },
        { session }
      );
    }

    // Update address
    Object.assign(address, updateData);
    await address.save({ session });

    await session.commitTransaction();
    return address;
  } catch (error) {
    await session.abortTransaction();
    logger.error('Error in updateAddress:', error);
    throw error;
  } finally {
    session.endSession();
  }
}

// Add method to delete address
async deleteAddress(userId, addressId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const address = await Address.findOneAndDelete({
      _id: addressId,
      user: userId
    }).session(session);

    if (!address) {
      throw new AppError('Address not found', 404);
    }

    // Remove address reference from user
    await User.findByIdAndUpdate(
      userId,
      { $pull: { addresses: addressId } },
      { session }
    );

    // If deleted address was default, set another as default
    if (address.isDefault) {
      const nextAddress = await Address.findOne({ user: userId })
        .sort({ createdAt: -1 })
        .session(session);
      
      if (nextAddress) {
        nextAddress.isDefault = true;
        await nextAddress.save({ session });
      }
    }

    await session.commitTransaction();
    return { success: true, message: 'Address deleted successfully' };
  } catch (error) {
    await session.abortTransaction();
    logger.error('Error in deleteAddress:', error);
    throw error;
  } finally {
    session.endSession();
  }
}

  /**
   * Update address
   */
  async updateAddress(userId, addressId, updateData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const address = await Address.findOne({ 
        _id: addressId, 
        user: userId 
      });

      if (!address) {
        throw new AppError('Address not found', 404);
      }

      const { isDefault } = updateData;

      // If setting as default, update other addresses
      if (isDefault && !address.isDefault) {
        await Address.updateMany(
          { user: userId, _id: { $ne: addressId } },
          { $set: { isDefault: false } },
          { session }
        );
      }

      const updatedAddress = await Address.findByIdAndUpdate(
        addressId,
        { $set: updateData },
        { new: true, runValidators: true, session }
      );

      await session.commitTransaction();

      return updatedAddress;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in updateAddress:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Delete address
   */
  async deleteAddress(userId, addressId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const address = await Address.findOne({ 
        _id: addressId, 
        user: userId 
      });

      if (!address) {
        throw new AppError('Address not found', 404);
      }

      const wasDefault = address.isDefault;

      await Address.deleteOne({ _id: addressId }, { session });

      // If deleted address was default, set another address as default
      if (wasDefault) {
        const nextAddress = await Address.findOne({ user: userId })
          .sort({ createdAt: -1 })
          .session(session);

        if (nextAddress) {
          nextAddress.isDefault = true;
          await nextAddress.save({ session });
        }
      }

      await session.commitTransaction();

      return { message: 'Address deleted successfully' };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in deleteAddress:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Set default address
   */
  async setDefaultAddress(userId, addressId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const address = await Address.findOne({ 
        _id: addressId, 
        user: userId 
      });

      if (!address) {
        throw new AppError('Address not found', 404);
      }

      // Update all addresses to not default
      await Address.updateMany(
        { user: userId },
        { $set: { isDefault: false } },
        { session }
      );

      // Set the selected address as default
      address.isDefault = true;
      await address.save({ session });

      await session.commitTransaction();

      return address;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in setDefaultAddress:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get user statistics
   */
  async getUserStats(userId) {
    try {
      const Rental = require('../models/Rental.model');
      const Payment = require('../models/Payment.model');
      const Review = require('../models/Review.model');

      const [rentalStats, paymentStats, reviewStats] = await Promise.all([
        Rental.aggregate([
          { $match: { user: userId } },
          {
            $group: {
              _id: null,
              totalRentals: { $sum: 1 },
              activeRentals: {
                $sum: { $cond: [{ $in: ['$status', ['active', 'confirmed', 'delivered']] }, 1, 0] }
              },
              completedRentals: {
                $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
              },
              cancelledRentals: {
                $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
              },
            }
          }
        ]),
        Payment.aggregate([
          { $match: { user: userId, status: 'success' } },
          {
            $group: {
              _id: null,
              totalSpent: { $sum: '$amount' },
              totalPayments: { $sum: 1 },
              avgPayment: { $avg: '$amount' }
            }
          }
        ]),
        Review.countDocuments({ user: userId })
      ]);

      return {
        rentals: rentalStats[0] || {
          totalRentals: 0,
          activeRentals: 0,
          completedRentals: 0,
          cancelledRentals: 0
        },
        payments: paymentStats[0] || {
          totalSpent: 0,
          totalPayments: 0,
          avgPayment: 0
        },
        totalReviews: reviewStats || 0
      };
    } catch (error) {
      logger.error('Error in getUserStats:', error);
      return {
        rentals: { totalRentals: 0, activeRentals: 0, completedRentals: 0, cancelledRentals: 0 },
        payments: { totalSpent: 0, totalPayments: 0, avgPayment: 0 },
        totalReviews: 0
      };
    }
  }

  /**
   * Get user activity history
   */
  async getUserActivity(userId, page = 1, limit = 20) {
    try {
      const Rental = require('../models/Rental.model');
      const Payment = require('../models/Payment.model');
      const Review = require('../models/Review.model');

      const skip = (page - 1) * limit;

      const [rentals, payments, reviews] = await Promise.all([
        Rental.find({ user: userId })
          .populate('product', 'basicInfo.name basicInfo.slug media.images')
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(skip)
          .lean(),
        Payment.find({ user: userId })
          .populate('rental', 'rentalNumber')
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(skip)
          .lean(),
        Review.find({ user: userId })
          .populate('product', 'basicInfo.name')
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(skip)
          .lean()
      ]);

      // Combine and sort all activities
      const activities = [
        ...rentals.map(r => ({ ...r, activityType: 'rental', date: r.createdAt })),
        ...payments.map(p => ({ ...p, activityType: 'payment', date: p.createdAt })),
        ...reviews.map(r => ({ ...r, activityType: 'review', date: r.createdAt }))
      ].sort((a, b) => new Date(b.date) - new Date(a.date));

      const total = activities.length;

      return {
        activities: activities.slice(0, limit),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getUserActivity:', error);
      throw error;
    }
  }

  /**
   * Upload avatar
   */
  async uploadAvatar(userId, avatarUrl, publicId) {
    try {
      const user = await User.findByIdAndUpdate(
        userId,
        {
          $set: {
            'profile.avatar': avatarUrl,
            'profile.avatarPublicId': publicId
          }
        },
        { new: true }
      ).select('-password -security.refreshTokens');

      if (!user) {
        throw new AppError('User not found', 404);
      }

      return user;
    } catch (error) {
      logger.error('Error in uploadAvatar:', error);
      throw error;
    }
  }

  /**
   * Delete avatar
   */
  async deleteAvatar(userId) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Delete from cloudinary if publicId exists
      if (user.profile?.avatarPublicId) {
        const cloudinary = require('cloudinary').v2;
        await cloudinary.uploader.destroy(user.profile.avatarPublicId);
      }

      user.profile.avatar = undefined;
      user.profile.avatarPublicId = undefined;
      await user.save();

      return { message: 'Avatar deleted successfully' };
    } catch (error) {
      logger.error('Error in deleteAvatar:', error);
      throw error;
    }
  }

  /**
   * Update notification preferences
   */
  async updateNotificationPreferences(userId, preferences) {
    try {
      const user = await User.findByIdAndUpdate(
        userId,
        { $set: { 'preferences.notifications': preferences } },
        { new: true }
      ).select('-password -security.refreshTokens');

      if (!user) {
        throw new AppError('User not found', 404);
      }

      return user.preferences.notifications;
    } catch (error) {
      logger.error('Error in updateNotificationPreferences:', error);
      throw error;
    }
  }

  /**
   * Deactivate account
   */
  async deactivateAccount(userId, reason) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Check for active rentals
      const Rental = require('../models/Rental.model');
      const activeRentals = await Rental.countDocuments({
        user: userId,
        status: { $in: ['active', 'confirmed', 'delivered'] }
      }).session(session);

      if (activeRentals > 0) {
        throw new AppError('Cannot deactivate account with active rentals', 400);
      }

      user.status.isActive = false;
      user.status.deactivationReason = reason;
      user.status.deactivatedAt = new Date();
      await user.save({ session });

      // If user is a vendor, deactivate vendor account too
      if (user.role === 'vendor') {
        await Vendor.findOneAndUpdate(
          { user: userId },
          {
            $set: {
              'status.isActive': false,
              'status.deactivationReason': reason,
              'status.deactivatedAt': new Date()
            }
          },
          { session }
        );
      }

      // If user is an admin, deactivate admin account too
      if (user.role === 'admin' || user.role === 'super-admin') {
        await Admin.findOneAndUpdate(
          { user: userId },
          {
            $set: {
              'status.isActive': false,
              'status.deactivationReason': reason,
              'status.deactivatedAt': new Date()
            }
          },
          { session }
        );
      }

      await session.commitTransaction();

      // Invalidate all sessions
      if (this.redisClient) {
        const sessionKeys = await this.redisClient.keys(`sess:*`);
        for (const key of sessionKeys) {
          await this.redisClient.del(key);
        }
      }

      // Send confirmation email
      await addJob('email', 'send', {
        to: user.email,
        subject: 'Account Deactivated - RentEase',
        template: 'account-deactivated',
        data: {
          name: user.profile.firstName,
          reason
        }
      });

      return { message: 'Account deactivated successfully' };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in deactivateAccount:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Reactivate account
   */
  async reactivateAccount(userId) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      user.status.isActive = true;
      user.status.deactivationReason = undefined;
      user.status.deactivatedAt = undefined;
      await user.save();

      // If user is a vendor, reactivate vendor account too
      if (user.role === 'vendor') {
        await Vendor.findOneAndUpdate(
          { user: userId },
          {
            $set: {
              'status.isActive': true,
              'status.deactivationReason': null,
              'status.deactivatedAt': null
            }
          }
        );
      }

      // If user is an admin, reactivate admin account too
      if (user.role === 'admin' || user.role === 'super-admin') {
        await Admin.findOneAndUpdate(
          { user: userId },
          {
            $set: {
              'status.isActive': true,
              'status.deactivationReason': null,
              'status.deactivatedAt': null
            }
          }
        );
      }

      // Send confirmation email
      await addJob('email', 'send', {
        to: user.email,
        subject: 'Account Reactivated - RentEase',
        template: 'account-reactivated',
        data: {
          name: user.profile.firstName
        }
      });

      return { message: 'Account reactivated successfully' };
    } catch (error) {
      logger.error('Error in reactivateAccount:', error);
      throw error;
    }
  }

  /**
   * Delete account (permanent)
   */
  async deleteAccount(userId, password) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).select('+password').session(session);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Verify password
      const isPasswordValid = await this.encryption.comparePassword(password, user.password);
      if (!isPasswordValid) {
        throw new AppError('Invalid password', 401);
      }

      // Check for active rentals
      const Rental = require('../models/Rental.model');
      const activeRentals = await Rental.countDocuments({
        user: userId,
        status: { $in: ['active', 'confirmed', 'delivered'] }
      }).session(session);

      if (activeRentals > 0) {
        throw new AppError('Cannot delete account with active rentals', 400);
      }

      // Delete related data
      await Promise.all([
        Address.deleteMany({ user: userId }).session(session),
        Review.deleteMany({ user: userId }).session(session),
        Notification.deleteMany({ user: userId }).session(session)
      ]);

      // If user is a vendor, delete vendor profile
      if (user.role === 'vendor') {
        await Vendor.findOneAndDelete({ user: userId }).session(session);
      }

      // If user is an admin, delete admin profile
      if (user.role === 'admin' || user.role === 'super-admin') {
        await Admin.findOneAndDelete({ user: userId }).session(session);
      }

      // Delete the user
      await User.findByIdAndDelete(userId).session(session);

      await session.commitTransaction();

      return { message: 'Account deleted permanently' };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in deleteAccount:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Search users (admin only)
   */
  async searchUsers(query, page = 1, limit = 10) {
    try {
      const skip = (page - 1) * limit;
      
      const searchQuery = {};
      
      if (query.email) {
        searchQuery.email = new RegExp(query.email, 'i');
      }
      if (query.phone) {
        searchQuery.phone = new RegExp(query.phone, 'i');
      }
      if (query.name) {
        searchQuery.$or = [
          { 'profile.firstName': new RegExp(query.name, 'i') },
          { 'profile.lastName': new RegExp(query.name, 'i') }
        ];
      }
      if (query.role) {
        searchQuery.role = query.role;
      }
      if (query.status) {
        searchQuery['status.isActive'] = query.status === 'active';
      }

      const [users, total] = await Promise.all([
        User.find(searchQuery)
          .select('-password -security.refreshTokens -security.passwordResetToken')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        User.countDocuments(searchQuery)
      ]);

      return {
        users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in searchUsers:', error);
      throw error;
    }
  }

  /**
   * Get user by ID (admin only)
   */
  async getUserById(userId) {
    try {
      const user = await User.findById(userId)
        .select('-password -security.refreshTokens -security.passwordResetToken')
        .populate('addresses')
        .lean();

      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Get additional stats for admin view
      const Rental = require('../models/Rental.model');
      const Payment = require('../models/Payment.model');
      const Review = require('../models/Review.model');

      const [rentals, payments, reviews] = await Promise.all([
        Rental.find({ user: userId }).sort({ createdAt: -1 }).limit(10).lean(),
        Payment.find({ user: userId }).sort({ createdAt: -1 }).limit(10).lean(),
        Review.find({ user: userId }).sort({ createdAt: -1 }).limit(10).lean()
      ]);

      return {
        ...user,
        recentRentals: rentals,
        recentPayments: payments,
        recentReviews: reviews
      };
    } catch (error) {
      logger.error('Error in getUserById:', error);
      throw error;
    }
  }

  /**
   * Update user role (admin only)
   */
  async updateUserRole(userId, role, adminId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      const oldRole = user.role;
      user.role = role;
      await user.save({ session });

      // Handle role-specific profiles
      if (role === 'vendor' && oldRole !== 'vendor') {
        // Create vendor profile if becoming vendor
        await Vendor.create([{
          user: user._id,
          business: {
            name: `${user.profile.firstName} ${user.profile.lastName}'s Store`
          },
          verification: { status: 'pending' },
          status: { isActive: true, isOnboarded: false }
        }], { session });
      } else if (oldRole === 'vendor' && role !== 'vendor') {
        // Delete vendor profile if no longer vendor
        await Vendor.findOneAndDelete({ user: userId }).session(session);
      }

      await session.commitTransaction();

      // Log the change
      await addJob('audit', 'log', {
        action: 'USER_ROLE_CHANGED',
        actor: adminId,
        target: userId,
        details: {
          oldRole,
          newRole: role
        }
      });

      return user;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in updateUserRole:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Block/Unblock user (admin only)
   */
  async toggleUserBlock(userId, block, reason, adminId) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      user.status.isBlocked = block;
      if (block) {
        user.status.blockReason = reason;
        user.status.blockedAt = new Date();
        user.status.blockedBy = adminId;
      } else {
        user.status.isBlocked = false;
        user.status.blockReason = undefined;
        user.status.blockedAt = undefined;
        user.status.blockedBy = undefined;
      }
      
      await user.save();

      // If user is a vendor, block/unblock vendor account too
      if (user.role === 'vendor') {
        await Vendor.findOneAndUpdate(
          { user: userId },
          {
            $set: {
              'status.isBlocked': block,
              'status.blockReason': block ? reason : null,
              'status.blockedAt': block ? new Date() : null,
              'status.blockedBy': block ? adminId : null
            }
          }
        );
      }

      // Invalidate sessions if blocked
      if (block && this.redisClient) {
        const sessionKeys = await this.redisClient.keys(`sess:*`);
        for (const key of sessionKeys) {
          await this.redisClient.del(key);
        }
      }

      // Emit event
      if (block) {
        eventEmitter.emit(EVENTS.USER.ACCOUNT_BLOCKED, {
          userId: user._id,
          email: user.email,
          reason,
          blockedBy: adminId
        });
      } else {
        eventEmitter.emit(EVENTS.USER.ACCOUNT_UNBLOCKED, {
          userId: user._id,
          email: user.email
        });
      }

      return user;
    } catch (error) {
      logger.error('Error in toggleUserBlock:', error);
      throw error;
    }
  }

  /**
   * Verify user email (admin only)
   */
  async verifyUserEmail(userId) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      user.verification.email = true;
      await user.save();

      return { message: 'Email verified successfully' };
    } catch (error) {
      logger.error('Error in verifyUserEmail:', error);
      throw error;
    }
  }

  /**
   * Verify user phone (admin only)
   */
  async verifyUserPhone(userId) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      user.verification.phone = true;
      await user.save();

      return { message: 'Phone verified successfully' };
    } catch (error) {
      logger.error('Error in verifyUserPhone:', error);
      throw error;
    }
  }

  /**
   * Export user data (GDPR compliance)
   */
  async exportUserData(userId) {
    try {
      const [user, addresses, rentals, payments, reviews] = await Promise.all([
        User.findById(userId).lean(),
        Address.find({ user: userId }).lean(),
        Rental.find({ user: userId })
          .populate('product', 'basicInfo.name')
          .lean(),
        Payment.find({ user: userId }).lean(),
        Review.find({ user: userId })
          .populate('product', 'basicInfo.name')
          .lean()
      ]);

      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Remove sensitive data
      delete user.password;
      delete user.security;

      const exportData = {
        user,
        addresses,
        rentals,
        payments,
        reviews,
        exportedAt: new Date().toISOString()
      };

      return exportData;
    } catch (error) {
      logger.error('Error in exportUserData:', error);
      throw error;
    }
  }
}

module.exports = new UserService();