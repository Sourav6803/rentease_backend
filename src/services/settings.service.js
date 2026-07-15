// services/settings.service.js
const { User } = require('../models');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');
const bcrypt = require('bcrypt');

class SettingsService {
  /**
   * Get user settings
   */
  async getSettings(userId) {
    try {
      const user = await User.findById(userId)
        .select('profile email phone preferences security status updatedAt')
        .lean();

      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Format settings response using existing schema fields
      const settings = {
        account: {
          name: `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim(),
          email: user.email,
          phone: user.phone,
          username: user.email?.split('@')[0], // Generate username from email
          bio: user.profile?.bio || '',
          avatar: user.profile?.avatar || null
        },
        notifications: {
          email: {
            marketing: user.preferences?.notifications?.email ?? true,
            orders: user.preferences?.notifications?.email ?? true,
            reminders: user.preferences?.notifications?.email ?? true,
            promotions: user.preferences?.notifications?.email ?? false,
            newsletter: user.preferences?.notifications?.email ?? false
          },
          push: {
            enabled: user.preferences?.notifications?.push ?? true,
            orders: user.preferences?.notifications?.push ?? true,
            promotions: user.preferences?.notifications?.push ?? false,
            reminders: user.preferences?.notifications?.push ?? true
          },
          sms: {
            enabled: user.preferences?.notifications?.sms ?? true,
            orders: user.preferences?.notifications?.sms ?? true,
            otp: user.preferences?.notifications?.sms ?? true
          }
        },
        privacy: {
          profileVisibility: 'public', // Default since not in schema
          showEmail: false,
          showPhone: false,
          showActivity: true,
          dataSharing: true,
          personalizedAds: true
        },
        appearance: {
          theme: 'system', // Default values that will be stored in localStorage on frontend
          compactView: false,
          reducedMotion: false,
          fontSize: 'medium'
        },
        language: {
          preferred: user.preferences?.language || 'en',
          dateFormat: 'DD/MM/YYYY', // Frontend stored
          timezone: 'Asia/Kolkata',
          currency: 'INR'
        },
        security: {
          twoFactorEnabled: user.security?.twoFactorEnabled || false,
          loginAlerts: true,
          lastPasswordChange: user.updatedAt || null
        }
      };

      return { settings };
    } catch (error) {
      logger.error('Error in getSettings:', error);
      throw error;
    }
  }

  /**
   * Update account settings
   */
  async updateAccountSettings(userId, data) {
    try {
      const updateFields = {};

      if (data.name) {
        const nameParts = data.name.trim().split(' ');
        updateFields['profile.firstName'] = nameParts[0] || '';
        updateFields['profile.lastName'] = nameParts.slice(1).join(' ') || '';
      }

      if (data.email) {
        // Check if email is already taken
        const existingUser = await User.findOne({ email: data.email, _id: { $ne: userId } });
        if (existingUser) {
          throw new AppError('Email already in use', 409);
        }
        updateFields.email = data.email;
      }

      if (data.phone) {
        const existingUser = await User.findOne({ phone: data.phone, _id: { $ne: userId } });
        if (existingUser) {
          throw new AppError('Phone number already in use', 409);
        }
        updateFields.phone = data.phone;
      }

      if (data.bio !== undefined) {
        updateFields['profile.bio'] = data.bio;
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { $set: updateFields },
        { new: true, runValidators: true }
      ).select('profile email phone');

      if (!user) {
        throw new AppError('User not found', 404);
      }

      return {
        account: {
          name: `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim(),
          email: user.email,
          phone: user.phone,
          username: user.email?.split('@')[0],
          bio: user.profile?.bio || '',
          avatar: user.profile?.avatar || null
        }
      };
    } catch (error) {
      logger.error('Error in updateAccountSettings:', error);
      throw error;
    }
  }

  /**
    * Update notification settings
    */
  async updateNotificationSettings(userId, data) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      const currentPrefs = user.preferences?.notifications || {};
      
      if (data.email && typeof data.email === 'object') {
        currentPrefs.email = {
          ...currentPrefs.email,
          ...data.email
        };
      }
      
      if (data.push && typeof data.push === 'object') {
        currentPrefs.push = {
          ...currentPrefs.push,
          ...data.push
        };
      }
      
      if (data.sms && typeof data.sms === 'object') {
        currentPrefs.sms = {
          ...currentPrefs.sms,
          ...data.sms
        };
      }

      user.preferences = user.preferences || {};
      user.preferences.notifications = currentPrefs;
      
      await user.save();

      return currentPrefs;
    } catch (error) {
      logger.error('Error in updateNotificationSettings:', error);
      throw error;
    }
  }

  /**
    * Update privacy settings (stored in user preferences)
    */
  async updatePrivacySettings(userId, data) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      user.preferences = user.preferences || {};
      user.preferences.privacy = data;

      await user.save();
      
      return data;
    } catch (error) {
      logger.error('Error in updatePrivacySettings:', error);
      throw error;
    }
  }

  /**
    * Update appearance settings
    */
  async updateAppearanceSettings(userId, data) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      user.preferences = user.preferences || {};
      user.preferences.appearance = data;

      await user.save();
      
      return data;
    } catch (error) {
      logger.error('Error in updateAppearanceSettings:', error);
      throw error;
    }
  }

  /**
    * Update language settings
    */
  async updateLanguageSettings(userId, data) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      user.preferences = user.preferences || {};
      user.preferences.language = data.preferred || user.preferences.language || 'en';
      user.preferences.dateFormat = data.dateFormat || user.preferences.dateFormat || 'DD/MM/YYYY';
      user.preferences.timezone = data.timezone || user.preferences.timezone || 'Asia/Kolkata';
      user.preferences.currency = data.currency || user.preferences.currency || 'INR';

      await user.save();

      return {
        preferred: user.preferences.language,
        dateFormat: user.preferences.dateFormat,
        timezone: user.preferences.timezone,
        currency: user.preferences.currency
      };
    } catch (error) {
      logger.error('Error in updateLanguageSettings:', error);
      throw error;
    }
  }

  /**
   * Update security settings
   */
  async updateSecuritySettings(userId, data) {
    try {
      const updateData = {};
      
      if (data.twoFactorEnabled !== undefined) {
        updateData['security.twoFactorEnabled'] = data.twoFactorEnabled;
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { $set: updateData },
        { new: true }
      );

      return {
        twoFactorEnabled: user.security?.twoFactorEnabled || false,
        loginAlerts: true,
        lastPasswordChange: user.updatedAt
      };
    } catch (error) {
      logger.error('Error in updateSecuritySettings:', error);
      throw error;
    }
  }

  /**
   * Change password
   */
  async changePassword(userId, currentPassword, newPassword) {
    try {
      const user = await User.findById(userId).select('+password');
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Verify current password
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        throw new AppError('Current password is incorrect', 401);
      }

      // Hash new password
      const salt = await bcrypt.genSalt(12);
      user.password = await bcrypt.hash(newPassword, salt);
      
      // Update security login attempts
      user.security.loginAttempts = 0;
      user.security.lockUntil = null;
      
      await user.save();

      return { message: 'Password changed successfully' };
    } catch (error) {
      logger.error('Error in changePassword:', error);
      throw error;
    }
  }

  /**
   * Delete account (soft delete)
   */
  async deleteAccount(userId, confirmText = null) {
    try {
      // Require confirmation text
      if (confirmText !== 'DELETE') {
        throw new AppError('Please type DELETE to confirm account deletion', 400);
      }

      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Check for active rentals
      const Rental = require('../models/Rental.model');
      const activeRentals = await Rental.countDocuments({
        user: userId,
        status: { $in: ['active', 'confirmed', 'delivered', 'pending'] }
      });

      if (activeRentals > 0) {
        throw new AppError('Cannot delete account with active rentals. Please complete or cancel them first.', 400);
      }

      // Soft delete - mark as inactive and block
      user.status.isActive = false;
      user.status.isBlocked = true;
      user.status.deactivationReason = 'Account deleted by user';
      user.status.deactivatedAt = new Date();
      
      // Anonymize user data
      user.email = `deleted_${user._id}@deleted.com`;
      user.phone = null;
      user.profile.firstName = 'Deleted';
      user.profile.lastName = 'User';
      user.profile.avatar = null;
      
      await user.save();

      return { message: 'Account deleted successfully' };
    } catch (error) {
      logger.error('Error in deleteAccount:', error);
      throw error;
    }
  }

  /**
   * Get privacy settings from separate collection (optional)
   */
  async getPrivacySettings(userId) {
    try {
      // If you implement a separate Privacy model
      // const Privacy = mongoose.model('Privacy');
      // const privacy = await Privacy.findOne({ user: userId });
      // return privacy || {};
      
      // Default values for now
      return {
        profileVisibility: 'public',
        showEmail: false,
        showPhone: false,
        showActivity: true,
        dataSharing: true,
        personalizedAds: true
      };
    } catch (error) {
      logger.error('Error in getPrivacySettings:', error);
      return {};
    }
  }
}

module.exports = new SettingsService();