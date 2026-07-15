// services/admin-settings.service.js
const Admin = require('../models/Admin.model');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

class AdminSettingsService {
  async getSettings(adminId) {
    try {
      const admin = await Admin.findById(adminId)
        .select('profile email phone preferences security status updatedAt')
        .lean();

      if (!admin) {
        throw new AppError('Admin not found', 404);
      }

      const settings = {
        account: {
          name: `${admin.profile?.firstName || ''} ${admin.profile?.lastName || ''}`.trim(),
          email: admin.email,
          phone: admin.phone || '',
          username: admin.email?.split('@')[0],
          bio: admin.profile?.bio || '',
          avatar: admin.profile?.avatar || null,
          department: admin.profile?.department || '',
          designation: admin.profile?.designation || ''
        },
        notifications: {
          email: {
            marketing: admin.preferences?.notifications?.email ?? true,
            orders: admin.preferences?.notifications?.email ?? true,
            reminders: admin.preferences?.notifications?.email ?? true,
            promotions: admin.preferences?.notifications?.email ?? false,
            newsletter: admin.preferences?.notifications?.email ?? false
          },
          push: {
            enabled: admin.preferences?.notifications?.push ?? true,
            orders: admin.preferences?.notifications?.push ?? true,
            promotions: admin.preferences?.notifications?.push ?? false,
            reminders: admin.preferences?.notifications?.push ?? true
          },
          sms: {
            enabled: admin.preferences?.notifications?.sms ?? true,
            orders: admin.preferences?.notifications?.sms ?? true,
            otp: admin.preferences?.notifications?.sms ?? true
          }
        },
        privacy: {
          profileVisibility: 'public',
          showEmail: false,
          showPhone: false,
          showActivity: true,
          dataSharing: true,
          personalizedAds: true
        },
        appearance: {
          theme: admin.preferences?.appearance?.theme || 'system',
          compactView: admin.preferences?.appearance?.compactView ?? false,
          reducedMotion: admin.preferences?.appearance?.reducedMotion ?? false,
          fontSize: admin.preferences?.appearance?.fontSize || 'medium',
          sidebarStyle: admin.preferences?.appearance?.sidebarStyle || 'default',
          colorScheme: admin.preferences?.appearance?.colorScheme || 'blue'
        },
        language: {
          preferred: admin.preferences?.language || 'en',
          dateFormat: admin.preferences?.dateFormat || 'DD/MM/YYYY',
          timezone: admin.preferences?.timezone || 'Asia/Kolkata',
          currency: admin.preferences?.currency || 'INR'
        },
        security: {
          twoFactorEnabled: admin.security?.twoFactorEnabled || false,
          loginAlerts: true,
          lastPasswordChange: admin.updatedAt || null
        }
      };

      return { settings };
    } catch (error) {
      logger.error('Error in getSettings:', error);
      throw error;
    }
  }

  async updateAccountSettings(adminId, data) {
    try {
      const updateFields = {};

      if (data.name) {
        const nameParts = data.name.trim().split(' ');
        updateFields['profile.firstName'] = nameParts[0] || '';
        updateFields['profile.lastName'] = nameParts.slice(1).join(' ') || '';
      }

      if (data.email) {
        updateFields.email = data.email;
      }

      if (data.phone) {
        updateFields.phone = data.phone;
      }

      if (data.bio !== undefined) {
        updateFields['profile.bio'] = data.bio;
      }

      if (data.avatar !== undefined) {
        updateFields['profile.avatar'] = data.avatar;
      }

      if (data.department !== undefined) {
        updateFields['profile.department'] = data.department;
      }

      if (data.designation !== undefined) {
        updateFields['profile.designation'] = data.designation;
      }

      const admin = await Admin.findByIdAndUpdate(
        adminId,
        { $set: updateFields },
        { new: true, runValidators: true }
      ).select('profile email phone');

      if (!admin) {
        throw new AppError('Admin not found', 404);
      }

      return {
        account: {
          name: `${admin.profile?.firstName || ''} ${admin.profile?.lastName || ''}`.trim(),
          email: admin.email,
          phone: admin.phone || '',
          username: admin.email?.split('@')[0],
          bio: admin.profile?.bio || '',
          avatar: admin.profile?.avatar || null,
          department: admin.profile?.department || '',
          designation: admin.profile?.designation || ''
        }
      };
    } catch (error) {
      logger.error('Error in updateAccountSettings:', error);
      throw error;
    }
  }

  async updateNotificationSettings(adminId, data) {
    try {
      const admin = await Admin.findById(adminId);
      if (!admin) {
        throw new AppError('Admin not found', 404);
      }

      const currentPrefs = admin.preferences?.notifications || {};

      if (data.email && typeof data.email === 'object') {
        currentPrefs.email = { ...currentPrefs.email, ...data.email };
      }

      if (data.push && typeof data.push === 'object') {
        currentPrefs.push = { ...currentPrefs.push, ...data.push };
      }

      if (data.sms && typeof data.sms === 'object') {
        currentPrefs.sms = { ...currentPrefs.sms, ...data.sms };
      }

      admin.preferences = admin.preferences || {};
      admin.preferences.notifications = currentPrefs;
      await admin.save();

      return currentPrefs;
    } catch (error) {
      logger.error('Error in updateNotificationSettings:', error);
      throw error;
    }
  }

  async updatePrivacySettings(adminId, data) {
    try {
      const admin = await Admin.findById(adminId);
      if (!admin) {
        throw new AppError('Admin not found', 404);
      }

      admin.preferences = admin.preferences || {};
      admin.preferences.privacy = data;
      await admin.save();

      return data;
    } catch (error) {
      logger.error('Error in updatePrivacySettings:', error);
      throw error;
    }
  }

  async updateAppearanceSettings(adminId, data) {
    try {
      const admin = await Admin.findById(adminId);
      if (!admin) {
        throw new AppError('Admin not found', 404);
      }

      admin.preferences = admin.preferences || {};
      admin.preferences.appearance = data;
      await admin.save();

      return data;
    } catch (error) {
      logger.error('Error in updateAppearanceSettings:', error);
      throw error;
    }
  }

  async updateLanguageSettings(adminId, data) {
    try {
      const admin = await Admin.findById(adminId);
      if (!admin) {
        throw new AppError('Admin not found', 404);
      }

      admin.preferences = admin.preferences || {};
      admin.preferences.language = data.preferred || admin.preferences.language || 'en';
      admin.preferences.dateFormat = data.dateFormat || admin.preferences.dateFormat || 'DD/MM/YYYY';
      admin.preferences.timezone = data.timezone || admin.preferences.timezone || 'Asia/Kolkata';
      admin.preferences.currency = data.currency || admin.preferences.currency || 'INR';
      await admin.save();

      return {
        preferred: admin.preferences.language,
        dateFormat: admin.preferences.dateFormat,
        timezone: admin.preferences.timezone,
        currency: admin.preferences.currency
      };
    } catch (error) {
      logger.error('Error in updateLanguageSettings:', error);
      throw error;
    }
  }

  async updateSecuritySettings(adminId, data) {
    try {
      const updateData = {};

      if (data.twoFactorEnabled !== undefined) {
        updateData['security.twoFactorEnabled'] = data.twoFactorEnabled;
      }

      const admin = await Admin.findByIdAndUpdate(
        adminId,
        { $set: updateData },
        { new: true }
      );

      if (!admin) {
        throw new AppError('Admin not found', 404);
      }

      return {
        twoFactorEnabled: admin.security?.twoFactorEnabled || false,
        loginAlerts: true,
        lastPasswordChange: admin.updatedAt
      };
    } catch (error) {
      logger.error('Error in updateSecuritySettings:', error);
      throw error;
    }
  }
}

module.exports = new AdminSettingsService();
