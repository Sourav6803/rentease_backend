const { Admin, User } = require('../models');
const  AppError  = require('../utils/AppError');
const { Encryption } = require('../utils/encryption');
const { addJob } = require('../jobs');
const { eventEmitter, EVENTS } = require('../events');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

class AdminAuthService {
  constructor() {
    this.encryption = Encryption;
    this.redisClient = getRedisClient();
  }

  /**
   * Register new admin (Super Admin only)
   */
  async registerAdmin(adminData, createdBy) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        email,
        phone,
        password,
        profile,
        role,
        permissions,
        department
      } = adminData;

      // Check if admin already exists
      const existingAdmin = await Admin.findOne({
        $or: [
          { email: email.toLowerCase() },
          { phone: phone }
        ]
      }).session(session);

      if (existingAdmin) {
        if (existingAdmin.email === email.toLowerCase()) {
          throw new AppError('Email already registered', 409);
        }
        if (existingAdmin.phone === phone) {
          throw new AppError('Phone number already registered', 409);
        }
      }

      // Generate employee ID
      const employeeId = await this.generateEmployeeId(department);

      // Create admin directly (without User model for now - can be linked later)
      const adminObj = {
        email: email.toLowerCase(),
        phone,
        password,
        profile: {
          firstName: profile.firstName,
          lastName: profile.lastName,
          avatar: profile.avatar,
          department: profile.department || department,
          designation: profile.designation,
          employeeId,
          joiningDate: new Date(),
          reportingTo: profile.reportingTo
        },
        role: role || this.getDefaultRoleForDepartment(department),
        permissions: permissions || {},
        access: {
          twoFactorEnabled: false,
          sessionTimeout: 60,
          maxSessions: 3,
          requirePasswordChange: true,
          passwordLastChanged: new Date()
        },
        security: {
          emailVerified: false,
          phoneVerified: false,
          failedLoginAttempts: 0
        },
        status: {
          isActive: true,
          isBlocked: false
        },
        metadata: {
          createdBy
        }
      };

      const admin = await Admin.create([adminObj], { session });

      // Create linked User if needed (for consistency)
      // Optional: You can create a User record with role 'admin'
      const userObj = {
        email: email.toLowerCase(),
        phone,
        password,
        profile: {
          firstName: profile.firstName,
          lastName: profile.lastName,
          avatar: profile.avatar
        },
        role: 'admin',
        verification: {
          email: true,
          phone: true
        },
        status: {
          isActive: true,
          isBlocked: false
        }
      };

      const user = await User.create([userObj], { session });
      
      // Link admin to user
      admin[0].user = user[0]._id;
      await admin[0].save({ session });

      await session.commitTransaction();

      // Generate email verification token
      const verificationToken = this.generateToken();
      admin[0].security.emailVerificationToken = verificationToken;
      admin[0].security.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await admin[0].save();

      // Send welcome email with verification link
      await this.sendWelcomeEmail(admin[0], verificationToken);

      // Log admin creation
      await admin[0].logAction('ADMIN_CREATED', 'Admin', admin[0]._id, {
        createdBy: createdBy?.toString(),
        role: admin[0].role,
        department: admin[0].profile.department
      });

      // Remove sensitive data
      const adminResponse = admin[0].toObject();
      delete adminResponse.password;
      delete adminResponse.access.twoFactorSecret;
      delete adminResponse.access.backupCodes;
      delete adminResponse.security.passwordResetToken;

      return {
        admin: adminResponse,
        message: 'Admin created successfully. Please verify your email to activate your account.'
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in registerAdmin:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Admin Login
   */
  async loginAdmin(credentials, ipAddress, userAgent) {
    try {
      const { email, phone, password } = credentials;

      // Find admin by email or phone
      const admin = await Admin.findOne({
        $or: [
          { email: email?.toLowerCase() },
          { phone: phone }
        ]
      }).select('+password +security.failedLoginAttempts +security.lockUntil +access.twoFactorSecret');

      if (!admin) {
        throw new AppError('Invalid credentials', 401);
      }

    //   Check if account is locked
      if (admin.isLocked()) {
        const remainingTime = Math.ceil((admin.security.lockUntil - new Date()) / 1000 / 60);
        throw new AppError(`Account is locked. Try again in ${remainingTime} minutes`, 401);
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(
        password,
        admin.password
      );

      if (!isPasswordValid) {
        admin.incrementFailedLogins();
        await admin.save();
        
        // Record failed login
        admin.recordLogin(ipAddress, userAgent, false, 'Invalid password');
        await admin.save();
        
        throw new AppError('Invalid credentials', 401);
      }

      // Check if account is active
      if (!admin.status.isActive || admin.status.isBlocked) {
        throw new AppError('Account is deactivated. Please contact super admin.', 403);
      }

      // Check if email is verified
      if (!admin.security.emailVerified) {
        // Resend verification email
        const verificationToken = this.generateToken();
        admin.security.emailVerificationToken = verificationToken;
        admin.security.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await admin.save();
        
        await this.sendVerificationEmail(admin, verificationToken);
        
        throw new AppError('Please verify your email before logging in. A new verification link has been sent.', 403);
      }

      // Check if password change is required
      if (admin.access.requirePasswordChange) {
        // Generate temporary token for password change
        const tempToken = jwt.sign(
          { id: admin._id, purpose: 'password_change' },
          process.env.JWT_SECRET,
          { expiresIn: '1h' }
        );
        
        throw new AppError('Password change required. Please set a new password.', 403, {
          requirePasswordChange: true,
          tempToken
        });
      }

      // Reset login attempts on successful login
      admin.security.failedLoginAttempts = 0;
      admin.security.lockUntil = null;
      admin.activity.lastActive = new Date();
      
      // Record successful login
      admin.recordLogin(ipAddress, userAgent, true);
      await admin.save();

      // Check if 2FA is enabled
      if (admin.access.twoFactorEnabled) {
        // Generate and send OTP
        const otp = this.generateOTP();
        await this.send2FAOTP(admin, otp);
        
        // Store OTP in Redis
        if (this.redisClient) {
          await this.redisClient.setex(
            `2fa:${admin._id}`,
            300, // 5 minutes
            otp
          );
        }
        
        return {
          requireTwoFactor: true,
          adminId: admin._id,
          message: 'Two-factor authentication required. Please enter the OTP sent to your email.'
        };
      }

      // Generate tokens
      const tokens = await this.generateAuthTokens(admin);

      // Save refresh token
      await this.saveRefreshToken(admin._id, tokens.refreshToken, ipAddress, userAgent);

      // Prepare admin response
      const adminResponse = await this.prepareAdminResponse(admin);

      // Log admin login
      await admin.logAction('ADMIN_LOGIN', 'Admin', admin._id, {
        ipAddress,
        userAgent
      });

      return {
        admin: adminResponse,
        tokens,
        redirectUrl: this.getRedirectUrl(admin.role)
      };
    } catch (error) {
      logger.error('Error in loginAdmin:', error);
      throw error;
    }
  }

  /**
   * Verify 2FA OTP
   */
  async verify2FA(adminId, otp) {
    try {
      // Verify OTP from Redis
      let isValid = false;
      
      if (this.redisClient) {
        const storedOtp = await this.redisClient.get(`2fa:${adminId}`);
        if (storedOtp === otp) {
          isValid = true;
          await this.redisClient.del(`2fa:${adminId}`);
        }
      }

      if (!isValid) {
        throw new AppError('Invalid or expired OTP', 400);
      }

      const admin = await Admin.findById(adminId);
      if (!admin) {
        throw new AppError('Admin not found', 404);
      }

      // Generate tokens after successful 2FA
      const tokens = await this.generateAuthTokens(admin);
      const adminResponse = await this.prepareAdminResponse(admin);

      return {
        admin: adminResponse,
        tokens,
        redirectUrl: this.getRedirectUrl(admin.role)
      };
    } catch (error) {
      logger.error('Error in verify2FA:', error);
      throw error;
    }
  }

  /**
   * Change password (first login)
   */
  async changePassword(adminId, currentPassword, newPassword) {
    try {
      const admin = await Admin.findById(adminId).select('+password +access.passwordHistory');

      if (!admin) {
        throw new AppError('Admin not found', 404);
      }

      // If this is a password change request (first login)
      if (admin.access.requirePasswordChange) {
        const isReused = await admin.checkPasswordHistory(newPassword);
        if (isReused) {
          throw new AppError('Cannot reuse a previous password', 400);
        }

        const hashedPassword = await bcrypt.hash(newPassword, 12);
        admin.password = hashedPassword;
        admin.access.requirePasswordChange = false;
        admin.access.passwordLastChanged = new Date();
        
        admin.access.passwordHistory.push({
          password: hashedPassword,
          changedAt: new Date()
        });
        
        await admin.save();
        
        return { message: 'Password changed successfully. Please log in again.' };
      }

      // Normal password change (verify current password)
      const isValid = await admin.comparePassword(currentPassword);
      if (!isValid) {
        throw new AppError('Current password is incorrect', 401);
      }

      // Check password history
      const isReused = await admin.checkPasswordHistory(newPassword);
      if (isReused) {
        throw new AppError('Cannot reuse a previous password', 400);
      }

      admin.password = newPassword;
      admin.access.passwordLastChanged = new Date();
      
      // Add to password history
      admin.access.passwordHistory.push({
        password: admin.password,
        changedAt: new Date()
      });
      
      // Keep only last 5 passwords
      if (admin.access.passwordHistory.length > 5) {
        admin.access.passwordHistory = admin.access.passwordHistory.slice(-5);
      }
      
      await admin.save();

      // Log password change
      await admin.logAction('PASSWORD_CHANGED', 'Admin', admin._id, {});

      return { message: 'Password changed successfully' };
    } catch (error) {
      logger.error('Error in changePassword:', error);
      throw error;
    }
  }

  /**
   * Forgot password
   */
  async forgotPassword(email) {
    try {
      const admin = await Admin.findOne({ email: email.toLowerCase() });

      if (!admin) {
        // Return success even if admin not found for security
        return { message: 'If the email exists, a reset link has been sent.' };
      }

      // Generate reset token
      const resetToken = this.generateToken();
      const resetTokenHash = this.encryption.hash(resetToken);

      admin.security.passwordResetToken = resetTokenHash;
      admin.security.passwordResetExpires = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour
      await admin.save();

      // Send reset email
      await this.sendPasswordResetEmail(admin, resetToken);

      return { message: 'If the email exists, a reset link has been sent.' };
    } catch (error) {
      logger.error('Error in forgotPassword:', error);
      throw error;
    }
  }

  /**
   * Reset password
   */
  async resetPassword(token, newPassword) {
    try {
      const tokenHash = this.encryption.hash(token);

      const admin = await Admin.findOne({
        'security.passwordResetToken': tokenHash,
        'security.passwordResetExpires': { $gt: new Date() }
      }).select('+password +access.passwordHistory');

      if (!admin) {
        throw new AppError('Invalid or expired reset token', 400);
      }

      // Check if password is in history
      const isReused = await admin.checkPasswordHistory(newPassword);
      if (isReused) {
        throw new AppError('Cannot reuse a previous password', 400);
      }

      // Update password
      admin.password = newPassword;
      admin.security.passwordResetToken = undefined;
      admin.security.passwordResetExpires = undefined;
      admin.access.passwordLastChanged = new Date();
      
      // Add to password history
      admin.access.passwordHistory.push({
        password: admin.password,
        changedAt: new Date()
      });
      
      // Keep only last 5 passwords
      if (admin.access.passwordHistory.length > 5) {
        admin.access.passwordHistory = admin.access.passwordHistory.slice(-5);
      }
      
      await admin.save();

      // Log password reset
      await admin.logAction('PASSWORD_RESET', 'Admin', admin._id, {});

      return { message: 'Password reset successfully. Please log in with your new password.' };
    } catch (error) {
      logger.error('Error in resetPassword:', error);
      throw error;
    }
  }

  /**
   * Logout admin
   */
  async logoutAdmin(adminId, refreshToken) {
    try {
      // Remove refresh token from database
      await Admin.updateOne(
        { _id: adminId },
        { $pull: { 'activity.refreshTokens': { token: refreshToken } } }
      );

      // Remove from Redis
      if (this.redisClient) {
        await this.redisClient.del(`refresh:${refreshToken}`);
      }

      return { message: 'Logged out successfully' };
    } catch (error) {
      logger.error('Error in logoutAdmin:', error);
      throw error;
    }
  }

  /**
   * Verify email
   */
  async verifyEmail(token) {
    try {
      const admin = await Admin.findOne({
        'security.emailVerificationToken': token,
        'security.emailVerificationExpires': { $gt: new Date() }
      });

      if (!admin) {
        throw new AppError('Invalid or expired verification token', 400);
      }

      admin.security.emailVerified = true;
      admin.security.emailVerificationToken = undefined;
      admin.security.emailVerificationExpires = undefined;
      await admin.save();

      // Link admin to user if not already linked
      if (!admin.user) {
        const user = await User.findOne({ email: admin.email });
        if (user) {
          admin.user = user._id;
          await admin.save();
        }
      }

      return { message: 'Email verified successfully' };
    } catch (error) {
      logger.error('Error in verifyEmail:', error);
      throw error;
    }
  }

  /**
   * Get admin profile
   */
  async getAdminProfile(adminId) {
    try {
      const admin = await Admin.findById(adminId)
        .populate('user', 'email phone profile')
        .populate('profile.reportingTo', 'profile.firstName profile.lastName email')
        .lean();

      if (!admin) {
        throw new AppError('Admin not found', 404);
      }

      return admin;
    } catch (error) {
      logger.error('Error in getAdminProfile:', error);
      throw error;
    }
  }

  /**
   * Update admin profile
   */
  async updateAdminProfile(adminId, updateData) {
    try {
      const admin = await Admin.findById(adminId);

      if (!admin) {
        throw new AppError('Admin not found', 404);
      }

      const { profile, preferences } = updateData;

      if (profile) {
        admin.profile = { ...admin.profile, ...profile };
      }

      if (preferences) {
        admin.preferences = { ...admin.preferences, ...preferences };
      }

      admin.metadata.updatedBy = adminId;
      await admin.save();

      return admin;
    } catch (error) {
      logger.error('Error in updateAdminProfile:', error);
      throw error;
    }
  }

  /**
   * Generate employee ID
   */
  async generateEmployeeId(department) {
    const deptCode = {
      super_admin: 'SA',
      operations: 'OPS',
      customer_support: 'CS',
      vendor_management: 'VM',
      finance: 'FIN',
      inventory: 'INV',
      marketing: 'MKT',
      technical: 'TECH',
      legal: 'LEG',
      hr: 'HR'
    };

    const prefix = deptCode[department] || 'ADM';
    const count = await Admin.countDocuments({ 'profile.department': department }) + 1;
    const sequential = String(count).padStart(4, '0');
    
    return `${prefix}${sequential}`;
  }

  /**
   * Get default role for department
   */
  getDefaultRoleForDepartment(department) {
    const roleMap = {
      super_admin: 'super_admin',
      operations: 'operations_manager',
      customer_support: 'support_manager',
      vendor_management: 'vendor_manager',
      finance: 'finance_manager',
      inventory: 'inventory_manager',
      marketing: 'content_manager',
      technical: 'admin',
      legal: 'auditor',
      hr: 'admin'
    };
    return roleMap[department] || 'admin';
  }

  /**
   * Get redirect URL based on role
   */
  getRedirectUrl(role) {
    const redirectMap = {
      super_admin: '/admin/dashboard',
      admin: '/admin/dashboard',
      operations_manager: '/admin/operations',
      support_manager: '/admin/support',
      vendor_manager: '/admin/vendors',
      finance_manager: '/admin/finance',
      inventory_manager: '/admin/inventory',
      content_manager: '/admin/content',
      analytics_viewer: '/admin/analytics',
      auditor: '/admin/audit'
    };
    return redirectMap[role] || '/admin/dashboard';
  }

  /**
   * Prepare admin response (remove sensitive data)
   */
  async prepareAdminResponse(admin) {
    const adminObj = admin.toObject();
    delete adminObj.password;
    delete adminObj.access.twoFactorSecret;
    delete adminObj.access.backupCodes;
    delete adminObj.security.passwordResetToken;
    delete adminObj.security.emailVerificationToken;
    
    return adminObj;
  }

  /**
   * Generate auth tokens
   */
  async generateAuthTokens(admin) {
    const accessToken = jwt.sign(
      { 
        id: admin._id,
        email: admin.email,
        role: admin.role,
        type: 'admin'
      },
      process.env.JWT_SECRET,
      // { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' }
      { expiresIn: '7d' }
    );

    const refreshToken = jwt.sign(
      { id: admin._id, type: 'admin' },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );

    return { accessToken, refreshToken };
  }

  /**
   * Save refresh token
   */
  async saveRefreshToken(adminId, token, ipAddress, userAgent) {
    const decoded = jwt.decode(token);
    
    await Admin.findByIdAndUpdate(adminId, {
      $push: {
        'activity.refreshTokens': {
          token,
          ipAddress,
          userAgent,
          expiresAt: new Date(decoded.exp * 1000),
          createdAt: new Date()
        }
      }
    });

    // Store in Redis for quick invalidation
    if (this.redisClient) {
      await this.redisClient.setex(
        `refresh:${token}`,
        7 * 24 * 60 * 60,
        adminId.toString()
      );
    }
  }

  /**
   * Generate random token
   */
  generateToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate OTP
   */
  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Send welcome email
   */
  async sendWelcomeEmail(admin, token) {
    const verificationUrl = `${process.env.ADMIN_URL}/verify-email?token=${token}`;
    
    await addJob('email', 'send', {
      to: admin.email,
      subject: 'Welcome to RentEase Admin Portal',
      template: 'admin-welcome',
      data: {
        name: `${admin.profile.firstName} ${admin.profile.lastName}`,
        email: admin.email,
        verificationUrl,
        tempPassword: '********',
        loginUrl: `${process.env.ADMIN_URL}/login`
      }
    });
  }

  /**
   * Send verification email
   */
  async sendVerificationEmail(admin, token) {
    const verificationUrl = `${process.env.ADMIN_URL}/verify-email?token=${token}`;
    
    await addJob('email', 'send', {
      to: admin.email,
      subject: 'Verify Your Email - RentEase Admin',
      template: 'admin-verification',
      data: {
        name: `${admin.profile.firstName} ${admin.profile.lastName}`,
        verificationUrl
      }
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(admin, token) {
    const resetUrl = `${process.env.ADMIN_URL}/reset-password?token=${token}`;
    
    await addJob('email', 'send', {
      to: admin.email,
      subject: 'Reset Your Password - RentEase Admin',
      template: 'admin-password-reset',
      data: {
        name: `${admin.profile.firstName} ${admin.profile.lastName}`,
        resetUrl,
        validity: '1 hour'
      }
    });
  }

  /**
   * Send 2FA OTP
   */
  async send2FAOTP(admin, otp) {
    await addJob('email', 'send', {
      to: admin.email,
      subject: 'Your 2FA Verification Code - RentEase Admin',
      template: 'admin-2fa',
      data: {
        name: `${admin.profile.firstName} ${admin.profile.lastName}`,
        otp,
        validity: '5 minutes'
      }
    });
  }
}

module.exports = new AdminAuthService();