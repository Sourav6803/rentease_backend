const jwt = require('jsonwebtoken');
const crypto = require('crypto');
// const { User, Vendor, Admin } = require('../../models');
const { Vendor, Admin, Address } = require('../models/index');
const  Encryption  = require('../utils/encryption');
const User = require("../models/User.model")
const  AppError  = require('../utils/AppError');
const { sendEmail } = require('./email.service');
const { sendSMS } = require('./sms.service');
const { addJob } = require('../jobs');
const { eventEmitter, EVENTS } = require('../events');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const emailService = require('./email.service');
const mongoose = require('mongoose');

class AuthService {
  constructor() {
    this.encryption = Encryption;
    this.redisClient = getRedisClient();
  }

  async register(userData) {
    try {
      // Check if user already exists
      const existingUser = await User.findOne({
        $or: [
          { email: userData.email.toLowerCase() },
          { phone: userData.phone },
        ],
      });

      if (existingUser) {
        if (existingUser.email === userData.email.toLowerCase()) {
          throw new AppError("Email already registered", 409);
        }
        if (existingUser.phone === userData.phone) {
          throw new AppError("Phone number already registered", 409);
        }
      }

      // Hash password
      const hashedPassword = await this.encryption.hashPassword(
        userData.password,
      );

      // Generate email verification token
      const emailVerificationToken = this.generateToken();

      // Create user object
      const userObj = {
        email: userData.email.toLowerCase(),
        phone: userData.phone,
        password: hashedPassword,
        profile: {
          firstName: userData.firstName || userData.name?.split(" ")[0],
          lastName:
            userData.lastName || userData.name?.split(" ").slice(1).join(" "),
        },
        role: userData.role || "user",
        verification: {
          email: false,
          phone: false,
          emailVerificationToken,
          emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
        status: {
          isActive: true,
          isBlocked: false,
        },
      };

      // Create user
      const user = await User.create(userObj);
      console.log("🔍 user created with ID:", user._id);

      // Create vendor profile if role is vendor
      if (userData.role === "vendor") {
        try {
          await Vendor.create({
            user: user._id,
            business: {
              name:
                userData.businessName ||
                `${user.profile.firstName} ${user.profile.lastName}'s Store`,
            },
            verification: {
              status: "pending",
            },
            status: {
              isActive: true,
              isOnboarded: false,
            },
          });
          console.log("✅ Vendor profile created");
        } catch (vendorError) {
          console.error("❌ Error creating vendor profile:", vendorError);
          // Don't throw - we still want to return user even if vendor creation fails
        }
      }

      // Remove sensitive data
      const userResponse = user.toObject();
      delete userResponse.password;
      delete userResponse.verification.emailVerificationToken;

      // Send verification email (don't await - let it run in background)
      try {
        // Don't await this - fire and forget
        this.sendVerificationEmail(
          user.email,
          emailVerificationToken,
          user.profile.firstName,
        ).catch((emailError) =>
          console.error("❌ Email sending failed:", emailError),
        );
      } catch (emailError) {
        console.error("❌ Error initiating email send:", emailError);
        // Continue even if email fails
      }

      // Emit registered event (don't await - let it run in background)
      try {
        console.log("📡 Emitting registered event...");
        // Make sure eventEmitter.emit doesn't expect a callback with 'next'
        eventEmitter.emit(EVENTS.USER.REGISTERED, {
          userId: user._id,
          email: user.email,
          phone: user.phone,
          role: user.role,
        });
        console.log("📡 Event emitted");
      } catch (eventError) {
        console.error("❌ Error emitting event:", eventError);
        // Continue even if event emission fails
      }

      return {
        user: userResponse,
        message: "Registration successful. Please verify your email.",
      };
    } catch (error) {
      console.error("❌ Registration error:", error);
      logger.error("Registration error:", error);
      throw error;
    }
  }

  /**
   * Login user
   */
  async login(credentials, ipAddress, userAgent) {
    try {
      const { email, phone, password } = credentials;

      // Find user by email or phone
      const user = await User.findOne({
        $or: [{ email: email?.toLowerCase() }, { phone: phone }],
      }).select("+password +security.loginAttempts +security.lockUntil");

      if (!user) {
        throw new AppError("Invalid credentials", 401);
      }

      console.log("user-->", user?.role)

      console.log("🔍 User found for login Id:", user._id, "email:", user.email);

      // Check if account is locked
      if (user.security?.lockUntil && user.security.lockUntil > new Date()) {
        const remainingTime = Math.ceil(
          (user.security.lockUntil - new Date()) / 1000 / 60,
        );
        throw new AppError(
          `Account is locked. Try again in ${remainingTime} minutes`,
          401,
        );
      }

      // Verify password
      const isPasswordValid = await this.encryption.comparePassword(
        password,
        user.password,
      );
      
      console.log("isPasswordValid--->", isPasswordValid)

      if (!isPasswordValid) {
        await this.handleFailedLogin(user);
        throw new AppError("Invalid credentials", 401);
      }

      // Check if user is active
      if (!user.status.isActive || user.status.isBlocked) {
        throw new AppError(
          "Account is deactivated. Please contact support.",
          403,
        );
      }

      // Reset login attempts on successful login
      user.security = {
        ...user.security,
        loginAttempts: 0,
        lockUntil: null,
      };
      await user.save();

      // Generate tokens
      const tokens = await this.generateAuthTokens(user);
      console.log("tokens-->", tokens);

      // Save refresh token
      await this.saveRefreshToken(
        user._id,
        tokens.refreshToken,
        ipAddress,
        userAgent,
      );

      // Update last login
      user.stats.lastActive = new Date();
      user.stats.lastLogin = new Date();
      await user.save();

      // Get user role-specific data
      let roleData = null;
      if (user.role === "vendor") {
        roleData = await Vendor.findOne({ user: user._id });
      } else if (user.role === "admin" || user.role === "super-admin") {
        roleData = await Admin.findOne({ user: user._id });
      }

      console.log("🔍roledata-->", roleData)

      // Emit login event
      eventEmitter.emit(EVENTS.USER.LOGGED_IN, {
        userId: user._id,
        email: user.email,
        ipAddress,
        userAgent,
      });

      return {
        user: this.sanitizeUser(user),
        roleData: this.sanitizeRoleData(roleData),
        tokens,
      };
    } catch (error) {
      logger.error("Login error:", error);
      throw error;
    }
  }

  /**
   * Handle failed login attempt
   */
  async handleFailedLogin(user) {
    console.log("🔍 from handleFailedLogin -->", user?._id);
    const attempts = (user.security?.loginAttempts || 0) + 1;
    const maxAttempts = 5;

    user.security = {
      ...user.security,
      loginAttempts: attempts,
    };

    if (attempts >= maxAttempts) {
      user.security.lockUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      // Notify user about lock
      await addJob("email", "send", {
        to: user.email,
        subject: "Account Locked",
        template: "account-locked",
        data: {
          name: user.profile.firstName,
          unlockTime: user.security.lockUntil,
        },
      });
    }

    await user.save();

    // Emit failed login event
    // eventEmitter.emit(EVENTS.USER.LOGIN_FAILED, {
    //   userId: user._id,
    //   email: user.email,
    //   attempts,
    // });
  }

  /**
   * Generate auth tokens
   */
  async generateAuthTokens(user) {
    const accessToken = jwt.sign(
      {
        id: user._id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m" },
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d" },
    );

    return { accessToken, refreshToken };
  }

  /**
   * Save refresh token
   */
  async saveRefreshToken(userId, token, ipAddress, userAgent) {
    const decoded = jwt.decode(token);

    await User.findByIdAndUpdate(userId, {
      $push: {
        "security.refreshTokens": {
          token,
          ipAddress,
          userAgent,
          expiresAt: new Date(decoded.exp * 1000),
          createdAt: new Date(),
        },
      },
    });

    // Store in Redis for quick invalidation
    if (this.redisClient) {
      await this.redisClient.setex(
        `refresh:${token}`,
        7 * 24 * 60 * 60, // 7 days
        userId.toString(),
      );
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken, ipAddress, userAgent) {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

      // Check if token exists in Redis
      if (this.redisClient) {
        const storedUserId = await this.redisClient.get(
          `refresh:${refreshToken}`,
        );
        if (!storedUserId || storedUserId !== decoded.id) {
          throw new AppError("Invalid refresh token", 401);
        }
      }

      // Find user with this refresh token
      const user = await User.findOne({
        _id: decoded.id,
        "security.refreshTokens.token": refreshToken,
      });

      if (!user) {
        throw new AppError("Invalid refresh token", 401);
      }

      // Check if user is active
      if (!user.status.isActive || user.status.isBlocked) {
        throw new AppError("Account is deactivated", 403);
      }

      // Generate new tokens
      const tokens = await this.generateAuthTokens(user);

      // Remove old refresh token
      await User.updateOne(
        { _id: user._id },
        { $pull: { "security.refreshTokens": { token: refreshToken } } },
      );

      // Save new refresh token
      await this.saveRefreshToken(
        user._id,
        tokens.refreshToken,
        ipAddress,
        userAgent,
      );

      // Remove old token from Redis
      if (this.redisClient) {
        await this.redisClient.del(`refresh:${refreshToken}`);
      }

      return tokens;
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        throw new AppError("Refresh token expired", 401);
      }
      if (error.name === "JsonWebTokenError") {
        throw new AppError("Invalid refresh token", 401);
      }
      throw error;
    }
  }

  /**
   * Logout user
   */
  async logout(userId, refreshToken) {
    try {
      // Remove refresh token from database
      await User.updateOne(
        { _id: userId },
        { $pull: { "security.refreshTokens": { token: refreshToken } } },
      );

      // Remove from Redis
      if (this.redisClient) {
        await this.redisClient.del(`refresh:${refreshToken}`);

        // Blacklist access token (if provided)
        const authHeader = arguments[2]; // Access token passed from controller
        if (authHeader) {
          const token = authHeader.replace("Bearer ", "");
          const decoded = jwt.decode(token);
          if (decoded && decoded.exp) {
            const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
            if (expiresIn > 0) {
              await this.redisClient.setex(
                `blacklist:${token}`,
                expiresIn,
                "true",
              );
            }
          }
        }
      }

      // Emit logout event
      eventEmitter.emit(EVENTS.USER.LOGGED_OUT, {
        userId,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error("Logout error:", error);
      throw error;
    }
  }

  /**
   * Logout from all devices
   */
  async logoutAll(userId) {
    try {
      // Get all refresh tokens
      const user = await User.findById(userId).select("security.refreshTokens");

      if (user && user.security?.refreshTokens) {
        // Remove all tokens from Redis
        if (this.redisClient) {
          const pipeline = this.redisClient.pipeline();
          user.security.refreshTokens.forEach((t) => {
            pipeline.del(`refresh:${t.token}`);
          });
          await pipeline.exec();
        }
      }

      // Clear all refresh tokens from database
      await User.updateOne(
        { _id: userId },
        { $set: { "security.refreshTokens": [] } },
      );

      // Emit event
      eventEmitter.emit("user:logout-all", { userId });
    } catch (error) {
      logger.error("Logout all error:", error);
      throw error;
    }
  }

  /**
   * Verify email
   */
  async verifyEmail(token) {
    try {
      const user = await User.findOne({
        "verification.emailVerificationToken": token,
        "verification.emailVerificationExpires": { $gt: new Date() },
      });

      if (!user) {
        throw new AppError("Invalid or expired verification token", 400);
      }

      user.verification.email = true;
      user.verification.emailVerificationToken = undefined;
      user.verification.emailVerificationExpires = undefined;
      await user.save();

      // Emit event
      eventEmitter.emit(EVENTS.USER.EMAIL_VERIFIED, {
        userId: user._id,
        email: user.email,
        firstTime: true,
      });

      return { message: "Email verified successfully" };
    } catch (error) {
      logger.error("Email verification error:", error);
      throw error;
    }
  }

  /**
   * Send verification email
   */
  async sendVerificationEmail(email, token, name) {
    try {
      const verificationUrl = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
      console.log("🔍sending verification email ", email, token, name);
      // await addJob('email', 'send', {
      //   to: email,
      //   subject: 'Verify Your Email - RentEase',
      //   template: 'email-verification',
      //   data: {
      //     name,
      //     verificationUrl,
      //     validity: '24 hours',
      //   },
      // });

      // Create a mock user object for email service
      const user = {
        email,
        profile: { firstName: name },
      };
      await emailService.sendVerificationEmail(user, token);
    } catch (error) {
      logger.error("Send verification email error:", error);
      // Don't throw - non-critical error
    }
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(email) {
    try {
      const user = await User.findOne({ email: email.toLowerCase() });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      if (user.verification.email) {
        throw new AppError("Email already verified", 400);
      }

      // Generate new token
      const token = this.generateToken();

      user.verification.emailVerificationToken = token;
      user.verification.emailVerificationExpires = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      );
      await user.save();

      // Send email
      await this.sendVerificationEmail(
        user.email,
        token,
        user.profile.firstName,
      );

      return { message: "Verification email sent" };
    } catch (error) {
      logger.error("Resend verification error:", error);
      throw error;
    }
  }

  /**
   * Send phone OTP
   */
  async sendPhoneOTP(phone) {
    try {
      const user = await User.findOne({ phone });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      if (user.verification.phone) {
        throw new AppError("Phone already verified", 400);
      }

      // Generate OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store OTP in Redis
      if (this.redisClient) {
        await this.redisClient.setex(
          `otp:${phone}`,
          10 * 60, // 10 minutes
          JSON.stringify({ otp, attempts: 0 }),
        );
      } else {
        // Fallback to database
        user.verification.phoneOTP = otp;
        user.verification.phoneOTPExpires = expiresAt;
        await user.save();
      }

      // Send SMS
      await sendSMS({
        to: phone,
        message: `Your RentEase verification OTP is: ${otp}. Valid for 10 minutes.`,
      });

      return { message: "OTP sent successfully" };
    } catch (error) {
      logger.error("Send OTP error:", error);
      throw error;
    }
  }

  /**
   * Verify phone OTP
   */
  async verifyPhoneOTP(phone, otp) {
    try {
      let isValid = false;

      // Check in Redis first
      if (this.redisClient) {
        const data = await this.redisClient.get(`otp:${phone}`);
        if (data) {
          const { otp: storedOtp, attempts } = JSON.parse(data);

          if (attempts >= 3) {
            await this.redisClient.del(`otp:${phone}`);
            throw new AppError(
              "Too many failed attempts. Request new OTP.",
              400,
            );
          }

          if (storedOtp === otp) {
            isValid = true;
            await this.redisClient.del(`otp:${phone}`);
          } else {
            await this.redisClient.setex(
              `otp:${phone}`,
              10 * 60,
              JSON.stringify({ otp: storedOtp, attempts: attempts + 1 }),
            );
          }
        }
      } else {
        // Fallback to database
        const user = await User.findOne({
          phone,
          "verification.phoneOTP": otp,
          "verification.phoneOTPExpires": { $gt: new Date() },
        });

        if (user) {
          isValid = true;
          user.verification.phone = true;
          user.verification.phoneOTP = undefined;
          user.verification.phoneOTPExpires = undefined;
          await user.save();
        }
      }

      if (!isValid) {
        throw new AppError("Invalid or expired OTP", 400);
      }

      // Update user verification status if not already updated
      if (isValid && !this.redisClient) {
        await User.updateOne(
          { phone },
          {
            $set: { "verification.phone": true },
            $unset: {
              "verification.phoneOTP": "",
              "verification.phoneOTPExpires": "",
            },
          },
        );
      }

      // Emit event
      eventEmitter.emit(EVENTS.USER.PHONE_VERIFIED, {
        userId: (await User.findOne({ phone }))._id,
        phone,
      });

      return { message: "Phone verified successfully" };
    } catch (error) {
      logger.error("Verify OTP error:", error);
      throw error;
    }
  }

  /**
   * Forgot password
   */
  async forgotPassword(email) {
    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      // console.log("user-->", user);

      if (!user) {
        // Return success even if user not found (security)
        return { message: "If email exists, password reset link will be sent" };
      }

      // Generate reset token
      const resetToken = this.generateToken();
      const resetTokenHash = this.encryption.hash(resetToken);
      console.log("resetToken-->", resetToken);
      console.log("resetTokenHash-->", resetTokenHash);

      user.security.passwordResetToken = resetTokenHash;
      user.security.passwordResetExpires = new Date(
        Date.now() + 15 * 60 * 1000,
      ); // 15 minutes
      await user.save();

      console.log("process.env.CLIENT_URL-->", process.env.CLIENT_URL)

      // Send reset email
      const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;

      console.log("resetUrl11-->", resetUrl);

      await addJob("email", "send", {
        to: user.email,
        subject: "Password Reset - RentEase",
        template: "password-reset",
        data: {
          name: user.profile.firstName,
          email: user.email,
          resetUrl,
          expiryTime: "10 minutes",
          year: new Date().getFullYear(),
        },
      });

      console.log("resetUrl22-->", resetUrl);

      return { message: "If email exists, password reset link will be sent" };
    } catch (error) {
      logger.error("Forgot password error:", error);
      throw error;
    }
  }

  /**
   * Reset password
   */
  async resetPassword(token, newPassword) {
    try {
      console.log("Received token:", token);
      console.log("Received token length:", token?.length);
      const tokenHash = this.encryption.hash(token);

      const user = await User.findOne({
        "security.passwordResetToken": tokenHash,
        "security.passwordResetExpires": { $gt: new Date() },
      }).select('+password +security.passwordResetToken +security.passwordResetExpires +security.passwordHistory');

       // Also log what's stored in the database
      // const user = await User.findOne({
      //   "security.passwordResetToken": { $exists: true }
      // });
      // console.log("user-->", user)

      if (!user) {
        throw new AppError("Invalid or expired reset token", 400);
      }

      // Check if new password is different from old
      const isSamePassword = await this.encryption.comparePassword(
        newPassword,
        user.password,
      );

      if (isSamePassword) {
        throw new AppError(
          "New password must be different from current password",
          400,
        );
      }

      // Check password history (prevent reuse of last 5 passwords)
      if (user.security?.passwordHistory) {
        for (const history of user.security.passwordHistory) {
          if (
            await this.encryption.comparePassword(newPassword, history.password)
          ) {
            throw new AppError("Cannot reuse recent passwords", 400);
          }
        }
      }

      // Hash new password
      const hashedPassword = await this.encryption.hashPassword(newPassword);

      console.log("hashedPassword-->", hashedPassword)
      // Store old password in history
      const passwordHistory = user.security?.passwordHistory || [];
      passwordHistory.push({
        password: user.password,
        changedAt: new Date(),
      });

      console.log("passwordHistory-->", passwordHistory)
      // Keep only last 5 passwords
      if (passwordHistory.length > 5) {
        passwordHistory.shift();
      }

      // Update user
      user.password = hashedPassword;
      user.security.passwordResetToken = undefined;
      user.security.passwordResetExpires = undefined;
      user.security.passwordHistory = passwordHistory;
      user.security.passwordLastChanged = new Date();

      // Invalidate all refresh tokens
      user.security.refreshTokens = [];

      await user.save();

      // Invalidate all sessions in Redis
      if (this.redisClient) {
        // Clear all refresh tokens
        const keys = await this.redisClient.keys(`refresh:*`);
        if (keys.length > 0) {
          await this.redisClient.del(keys);
        }
      }

      // Send confirmation email
      await addJob("email", "send", {
        to: user.email,
        subject: "Password Changed - RentEase",
        template: "password-changed",
        data: {
          name: user.profile.firstName,
          time: new Date().toLocaleString(),
        },
      });

      // Emit event
      eventEmitter.emit(EVENTS.USER.PASSWORD_CHANGED, {
        userId: user._id,
        email: user.email,
      });

      return { message: "Password reset successfully" };
    } catch (error) {
      logger.error("Reset password error:", error);
      throw error;
    }
  }

  /**
   * Change password
   */
  async changePassword(userId, currentPassword, newPassword) {
    try {
      const user = await User.findById(userId).select(
        "+password +security.passwordHistory",
      );

      if (!user) {
        throw new AppError("User not found", 404);
      }

      // Verify current password
      const isValid = await this.encryption.comparePassword(
        currentPassword,
        user.password,
      );
      if (!isValid) {
        throw new AppError("Current password is incorrect", 401);
      }

      // Check if new password is different
      if (currentPassword === newPassword) {
        throw new AppError(
          "New password must be different from current password",
          400,
        );
      }

      // Check password history
      if (user.security?.passwordHistory) {
        for (const history of user.security.passwordHistory) {
          if (
            await this.encryption.comparePassword(newPassword, history.password)
          ) {
            throw new AppError("Cannot reuse recent passwords", 400);
          }
        }
      }

      // Hash new password
      const hashedPassword = await this.encryption.hashPassword(newPassword);

      // Store old password in history
      const passwordHistory = user.security?.passwordHistory || [];
      passwordHistory.push({
        password: user.password,
        changedAt: new Date(),
      });

      // Keep only last 5 passwords
      if (passwordHistory.length > 5) {
        passwordHistory.shift();
      }

      // Update user
      user.password = hashedPassword;
      user.security.passwordHistory = passwordHistory;
      user.security.passwordLastChanged = new Date();

      // Optionally invalidate all other sessions except current
      if (user.security?.refreshTokens) {
        // Keep current session? This depends on requirements
        // For now, we'll keep all sessions, but you might want to invalidate others
      }

      await user.save();

      // Send confirmation email
      await addJob("email", "send", {
        to: user.email,
        subject: "Password Changed - RentEase",
        template: "password-changed",
        data: {
          name: user.profile.firstName,
          time: new Date().toLocaleString(),
        },
      });

      // Emit event
      eventEmitter.emit(EVENTS.USER.PASSWORD_CHANGED, {
        userId: user._id,
        email: user.email,
      });

      return { message: "Password changed successfully" };
    } catch (error) {
      logger.error("Change password error:", error);
      throw error;
    }
  }

  /**
   * Validate token
   */
  async validateToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Check if token is blacklisted
      if (this.redisClient) {
        const isBlacklisted = await this.redisClient.get(`blacklist:${token}`);
        if (isBlacklisted) {
          return { valid: false, reason: "Token has been revoked" };
        }
      }

      // Check if user exists
      const user = await User.findById(decoded.id);
      if (!user) {
        return { valid: false, reason: "User not found" };
      }

      // Check if user is active
      if (!user.status.isActive || user.status.isBlocked) {
        return { valid: false, reason: "Account is deactivated" };
      }

      return {
        valid: true,
        user: this.sanitizeUser(user),
        decoded,
      };
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return { valid: false, reason: "Token expired" };
      }
      if (error.name === "JsonWebTokenError") {
        return { valid: false, reason: "Invalid token" };
      }
      logger.error("Token validation error:", error);
      return { valid: false, reason: "Token validation failed" };
    }
  }

  /**
   * Social login (Google, Facebook)
   */
  async socialLogin(provider, profile, ipAddress, userAgent) {
    try {
      const { email, id, name, photo } = profile;

      // Check if user exists
      let user = await User.findOne({
        $or: [{ email }, { [`social.${provider}Id`]: id }],
      });

      if (!user) {
        // Create new user
        const nameParts = name.split(" ");
        const hashedPassword = await this.encryption.hashPassword(
          crypto.randomBytes(16).toString("hex"),
        );

        user = await User.create({
          email,
          phone: null, // Will need to be added later
          password: hashedPassword,
          profile: {
            firstName: nameParts[0],
            lastName: nameParts.slice(1).join(" "),
            avatar: photo,
          },
          social: {
            [provider]: {
              id,
              email,
              profile: JSON.stringify(profile),
            },
          },
          verification: {
            email: true, // Email is verified by provider
            phone: false,
          },
          status: {
            isActive: true,
            isBlocked: false,
          },
        });

        // Emit registered event
        eventEmitter.emit(EVENTS.USER.REGISTERED, {
          userId: user._id,
          email: user.email,
          provider,
        });
      } else {
        // Update social info if not present
        if (!user.social || !user.social[provider]) {
          await User.updateOne(
            { _id: user._id },
            {
              $set: {
                [`social.${provider}`]: {
                  id,
                  email,
                  profile: JSON.stringify(profile),
                },
              },
            },
          );
        }
      }

      // Generate tokens
      const tokens = await this.generateAuthTokens(user);

      // Save refresh token
      await this.saveRefreshToken(
        user._id,
        tokens.refreshToken,
        ipAddress,
        userAgent,
      );

      // Update last login
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            "stats.lastActive": new Date(),
            "stats.lastLogin": new Date(),
          },
        },
      );

      // Emit login event
      eventEmitter.emit(EVENTS.USER.LOGGED_IN, {
        userId: user._id,
        email: user.email,
        provider,
        ipAddress,
        userAgent,
      });

      return {
        user: this.sanitizeUser(user),
        tokens,
      };
    } catch (error) {
      logger.error("Social login error:", error);
      throw error;
    }
  }

  /**
   * Generate random token
   */
  generateToken(length = 32) {
    return crypto.randomBytes(length).toString("hex");
  }

  /**
   * Sanitize user object (remove sensitive data)
   */
  sanitizeUser(user) {
    const userObj = user.toObject ? user.toObject() : user;
    delete userObj.password;
    delete userObj.security?.refreshTokens;
    delete userObj.security?.passwordResetToken;
    delete userObj.security?.passwordResetExpires;
    delete userObj.verification?.emailVerificationToken;
    delete userObj.verification?.emailVerificationExpires;
    delete userObj.verification?.phoneOTP;
    delete userObj.verification?.phoneOTPExpires;
    return userObj;
  }

  /**
   * Sanitize role data
   */
  sanitizeRoleData(data) {
    if (!data) return null;
    const dataObj = data.toObject ? data.toObject() : data;
    delete dataObj.bankDetails?.accountNumber;
    delete dataObj.bankDetails?.confirmAccountNumber;
    return dataObj;
  }

  /**
   * Get user by ID
   */
  async getUserById(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError("User not found", 404);
    }
    return this.sanitizeUser(user);
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email) {
    const user = await User.findOne({ email: email.toLowerCase() });
    return user ? this.sanitizeUser(user) : null;
  }

  /**
   * Check if user exists
   */
  async userExists(email, phone) {
    const query = [];
    if (email) query.push({ email: email.toLowerCase() });
    if (phone) query.push({ phone });

    if (query.length === 0) return false;

    const user = await User.findOne({ $or: query });
    return !!user;
  }

  /**
   * Update last active timestamp
   */
  async updateLastActive(userId) {
    await User.updateOne(
      { _id: userId },
      { $set: { "stats.lastActive": new Date() } },
    );
  }

  /**
   * Get active sessions for user
   */
  async getUserSessions(userId) {
    const user = await User.findById(userId).select("security.refreshTokens");

    if (!user || !user.security?.refreshTokens) {
      return [];
    }

    // Filter out expired tokens
    const now = new Date();
    const activeSessions = user.security.refreshTokens.filter(
      (t) => t.expiresAt > now,
    );

    return activeSessions.map((session) => ({
      id: session.token.substring(0, 10) + "...",
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      isCurrent: false, // Will be set by controller
    }));
  }

  /**
   * Revoke specific session
   */
  async revokeSession(userId, tokenIdentifier) {
    // Find the token (partial match)
    const user = await User.findById(userId).select("security.refreshTokens");

    if (!user || !user.security?.refreshTokens) {
      throw new AppError("Session not found", 404);
    }

    const token = user.security.refreshTokens.find((t) =>
      t.token.startsWith(tokenIdentifier.replace("...", "")),
    );

    if (!token) {
      throw new AppError("Session not found", 404);
    }

    // Remove from database
    await User.updateOne(
      { _id: userId },
      { $pull: { "security.refreshTokens": { token: token.token } } },
    );

    // Remove from Redis
    if (this.redisClient) {
      await this.redisClient.del(`refresh:${token.token}`);
    }
  }

  /**
 * Register vendor
 */
  async registerVendor(vendorData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        firstName,
        lastName,
        email,
        phone,
        password,
        businessName,
        businessType,
        gstin,
        panNumber,
        address,
        bankDetails,
        documents,
        ipAddress,
        userAgent
      } = vendorData;

      // Check if user already exists
      const existingUser = await User.findOne({
        $or: [
          { email: email.toLowerCase() },
          { phone }
        ]
      }).session(session);

      if (existingUser) {
        if (existingUser.email === email.toLowerCase()) {
          throw new AppError('Email already registered', 409);
        }
        if (existingUser.phone === phone) {
          throw new AppError('Phone number already registered', 409);
        }
      }

      // Hash password
      const hashedPassword = await this.encryption.hashPassword(password);

      // Generate email verification token
      const emailVerificationToken = this.generateToken();

      // Create user object
      const userObj = {
        email: email.toLowerCase(),
        phone,
        password: hashedPassword,
        profile: {
          firstName,
          lastName,
        },
        role: 'vendor',
        verification: {
          email: false,
          phone: false,
          emailVerificationToken,
          emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        status: {
          isActive: true,
          isBlocked: false,
        },
        metadata: {
          createdBy: null,
          ipAddress,
          userAgent
        }
      };

      // Create user
      const user = await User.create([userObj], { session });

      console.log("user-> register vendor", user)

      const [addressDoc] = await Address.create(
        [
          {
            user: user[0]._id,
            type: 'other',
            addressLine1: address.addressLine1,
            city: address.city,
            state: address.state,
            pincode: address.pincode,
            country: address.country || 'India',
          },
        ],
        { session }
      );

      // Create vendor profile
      const vendorId = this.generateVendorId();

      console.log("vendorId-> register vendor", vendorId)

      const vendorObj = {
        user: user[0]._id,
        vendorId,
        business: {
          name: businessName,
          type: businessType,
          gstin: gstin || null,
          panNumber: panNumber || null,
          registrationDate: new Date()
        },
        contact: {
          primaryPhone: phone,
          primaryEmail: email.toLowerCase(),
          supportEmail: `support@${businessName.toLowerCase().replace(/\s/g, '')}.com`
        },
        addresses: {
          registeredOffice: addressDoc._id,
          serviceableCities:
            address?.city && address?.state
              ? [{ city: address.city, state: address.state, isActive: true }]
              : []
        },
        bankDetails: bankDetails ? (() => {
          const accountEncStr = this.encryption.encryptToString(
            bankDetails.accountNumber
          );
          return {
            accountHolderName: bankDetails.accountHolderName,
            accountNumber: accountEncStr,
            confirmAccountNumber: accountEncStr,
            ifscCode: bankDetails.ifscCode,
            bankName: bankDetails.bankName,
            branchName: bankDetails.branchName || '',
            accountType: bankDetails.accountType,
            upiId: bankDetails.upiId || '',
            verified: false,
          };
        })() : null,
        verification: {
          status: 'pending',
          documents: documents?.map((doc) => ({
            type: doc.type,
            url: doc.url,
          })) || []
        },
        commission: {
          rate: 10,
          type: 'percentage'
        },
        subscription: {
          plan: 'basic',
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days trial
          autoRenew: false,
          limits: {
            maxProducts: 50,
            maxRentalsPerMonth: 100,
            maxInventoryItems: 200,
            prioritySupport: false,
            analyticsAccess: false
          }
        },
        status: {
          isActive: true,
          isBlocked: false,
          isOnboarded: false
        },
        metadata: {
          createdBy: user[0]._id,
          ipAddress,
          userAgent
        }
      };

      const vendor = await Vendor.create([vendorObj], { session });

      await session.commitTransaction();

      // Remove sensitive data
      const userResponse = user[0].toObject();
      delete userResponse.password;
      delete userResponse.verification.emailVerificationToken;

      console.log("before email verification")

      // Send verification email
      await this.sendVerificationEmail(user[0].email, emailVerificationToken, user[0].profile.firstName);

      // Send vendor registration notification to admin
      // await addJob('notification', 'create', {
      //   role: 'admin',
      //   type: 'in_app',
      //   title: 'New Vendor Registration',
      //   content: `${businessName} has registered as a vendor and is awaiting approval.`,
      //   data: {
      //     vendorId: vendor[0]._id,
      //     vendorName: businessName,
      //     userId: user[0]._id
      //   },
      //   priority: 'high'
      // });

      // Emit event
      // eventEmitter.emit(EVENTS.VENDOR.REGISTERED, {
      //   vendorId: vendor[0].vendorId,
      //   userId: user[0]._id,
      //   businessName,
      //   email: user[0].email,
      //   phone: user[0].phone,
      //   ownerName: `${firstName} ${lastName}`
      // });

      console.log("after email verification")

      return {
        user: userResponse,
        vendor: vendor[0],
        message: 'Vendor registration successful. Please verify your email and wait for approval.'
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in registerVendor:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Generate unique vendor ID
   */
  generateVendorId() {
    const prefix = 'VEN';
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `${prefix}${timestamp}${random}`;
  }

  /**
   * Complete vendor profile after approval
   */
  async completeVendorProfile(vendorId, profileData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const vendor = await Vendor.findOne({ vendorId }).session(session);
      
      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      // Update business details
      if (profileData.business) {
        vendor.business = { ...vendor.business, ...profileData.business };
      }

      // Update contact details
      if (profileData.contact) {
        vendor.contact = { ...vendor.contact, ...profileData.contact };
      }

      // Update addresses
      if (profileData.addresses) {
        vendor.addresses = { ...vendor.addresses, ...profileData.addresses };
      }

      // Update bank details
      if (profileData.bankDetails) {
        const {
          accountNumber: plainAccount,
          confirmAccountNumber: _omitConfirm,
          ...restBank
        } = profileData.bankDetails;
        vendor.bankDetails = {
          ...vendor.bankDetails,
          ...restBank,
          ...(plainAccount != null && plainAccount !== ''
            ? {
                accountNumber: this.encryption.encryptToString(plainAccount),
                confirmAccountNumber: this.encryption.encryptToString(plainAccount),
              }
            : {}),
        };
      }

      // Update settings
      if (profileData.settings) {
        vendor.settings = { ...vendor.settings, ...profileData.settings };
      }

      await vendor.save({ session });

      await session.commitTransaction();

      return vendor;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in completeVendorProfile:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Upload vendor documents
   */
  async uploadVendorDocuments(vendorId, documents) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const vendor = await Vendor.findOne({ vendorId }).session(session);
      
      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      vendor.verification.documents.push(...documents.map(doc => ({
        type: doc.type,
        url: doc.url,
        documentNumber: doc.documentNumber,
        uploadedAt: new Date()
      })));

      await vendor.save({ session });

      await session.commitTransaction();

      return vendor.verification.documents;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in uploadVendorDocuments:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Check vendor registration status
   */
  // async getVendorRegistrationStatus(userId) {
  //   try {
  //     const vendor = await Vendor.findOne({ user: userId })
  //       .select('verification.status verification.rejectionReason status.isOnboarded')
  //       .lean();

  //     if (!vendor) {
  //       return { registered: false };
  //     }

  //     return {
  //       registered: true,
  //       status: vendor.verification.status,
  //       rejectionReason: vendor.verification.rejectionReason,
  //       isOnboarded: vendor.status.isOnboarded
  //     };
  //   } catch (error) {
  //     logger.error('Error in getVendorRegistrationStatus:', error);
  //     throw error;
  //   }
  // }

  /**
 * Get vendor registration status (including approval status)
 */
  async getVendorRegistrationStatus(userId) {
    try {
      const vendor = await Vendor.findOne({ user: userId })
        .select('verification.status verification.rejectionReason status.isOnboarded')
        .lean();

      if (!vendor) {
        return { registered: false };
      }

      return {
        registered: true,
        status: vendor.verification.status,
        rejectionReason: vendor.verification.rejectionReason,
        isOnboarded: vendor.status.isOnboarded,
        // Add helpful messages for each status
        message: this.getStatusMessage(vendor.verification.status)
      };
    } catch (error) {
      logger.error('Error in getVendorRegistrationStatus:', error);
      throw error;
    }
  }

  /**
   * Get status message for vendor
   */
  getStatusMessage(status) {
    const messages = {
      pending: 'Your application is under review. We will notify you once approved.',
      verified: 'Your account is verified! You can now start selling.',
      rejected: 'Your application was not approved. Please check the rejection reason.',
      suspended: 'Your account has been suspended. Please contact support.'
    };
    return messages[status] || 'Status unknown';
  }
}

module.exports = new AuthService();