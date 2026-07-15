// services/delivery-otp.service.js - OTP Verification Service
const crypto = require('crypto');
const { addJob } = require('../jobs');
const logger = require('../config/logger');

class DeliveryOTPService {
  constructor() {
    this.otpStore = new Map(); // In production, use Redis
    this.otpExpiryMinutes = 5;
  }

  /**
   * Generate OTP for delivery
   */
  generateOTP(length = 6) {
    return Math.floor(Math.random() * Math.pow(10, length)).toString().padStart(length, '0');
  }

  /**
   * Create and send OTP for delivery
   */
  async createDeliveryOTP(deliveryId, customerPhone, options = {}) {
    const otp = this.generateOTP(options.length || 6);
    const expiresAt = new Date(Date.now() + (options.expiryMinutes || this.otpExpiryMinutes) * 60 * 1000);
    
    // Store OTP
    this.otpStore.set(deliveryId, {
      otp,
      expiresAt,
      attempts: 0,
      maxAttempts: options.maxAttempts || 3,
      verified: false,
      createdAt: new Date()
    });
    
    // Auto-cleanup after expiry
    setTimeout(() => {
      if (this.otpStore.has(deliveryId) && !this.otpStore.get(deliveryId).verified) {
        this.otpStore.delete(deliveryId);
      }
    }, (options.expiryMinutes || this.otpExpiryMinutes) * 60 * 1000);
    
    // Send OTP via SMS
    await addJob('sms', 'send', {
      to: customerPhone,
      message: `Your RentEase delivery OTP is ${otp}. Valid for ${options.expiryMinutes || this.otpExpiryMinutes} minutes.`
    });
    
    // Send via WhatsApp if available
    if (options.whatsappEnabled) {
      await addJob('whatsapp', 'send', {
        to: customerPhone,
        message: `🔐 *Delivery OTP*\n\nYour OTP for delivery #${deliveryId} is:\n*${otp}*\n\nValid for ${options.expiryMinutes || this.otpExpiryMinutes} minutes.`
      });
    }
    
    return {
      sent: true,
      expiresAt,
      method: 'sms'
    };
  }

  /**
   * Verify OTP for delivery completion
   */
  async verifyDeliveryOTP(deliveryId, otp, customerId = null) {
    const storedData = this.otpStore.get(deliveryId);
    
    if (!storedData) {
      return {
        verified: false,
        error: 'OTP not found or expired',
        code: 'OTP_NOT_FOUND'
      };
    }
    
    if (storedData.verified) {
      return {
        verified: false,
        error: 'OTP already used',
        code: 'OTP_ALREADY_USED'
      };
    }
    
    if (new Date() > storedData.expiresAt) {
      this.otpStore.delete(deliveryId);
      return {
        verified: false,
        error: 'OTP has expired',
        code: 'OTP_EXPIRED'
      };
    }
    
    storedData.attempts++;
    if (storedData.attempts > storedData.maxAttempts) {
      this.otpStore.delete(deliveryId);
      return {
        verified: false,
        error: 'Maximum attempts exceeded',
        code: 'MAX_ATTEMPTS_EXCEEDED'
      };
    }
    
    if (storedData.otp === otp) {
      storedData.verified = true;
      storedData.verifiedAt = new Date();
      this.otpStore.set(deliveryId, storedData);
      
      return {
        verified: true,
        attempts: storedData.attempts,
        verifiedAt: storedData.verifiedAt
      };
    }
    
    return {
      verified: false,
      attemptsRemaining: storedData.maxAttempts - storedData.attempts,
      error: 'Invalid OTP',
      code: 'INVALID_OTP'
    };
  }

  /**
   * Resend OTP for delivery
   */
  async resendOTP(deliveryId, customerPhone, options = {}) {
    const existingData = this.otpStore.get(deliveryId);
    
    if (existingData && existingData.verified) {
      return {
        resent: false,
        error: 'Delivery already completed',
        code: 'ALREADY_COMPLETED'
      };
    }
    
    // Delete existing OTP
    this.otpStore.delete(deliveryId);
    
    // Create new OTP
    return await this.createDeliveryOTP(deliveryId, customerPhone, options);
  }

  /**
   * Generate delivery completion link with OTP
   */
  generateDeliveryLink(deliveryId, baseUrl) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    // Store token
    this.otpStore.set(`link_${deliveryId}`, {
      token,
      expiresAt,
      deliveryId
    });
    
    return {
      link: `${baseUrl}/delivery/complete/${deliveryId}?token=${token}`,
      expiresAt
    };
  }

  /**
   * Verify delivery completion link
   */
  async verifyDeliveryLink(deliveryId, token) {
    const storedData = this.otpStore.get(`link_${deliveryId}`);
    
    if (!storedData || storedData.token !== token) {
      return { verified: false, error: 'Invalid link' };
    }
    
    if (new Date() > storedData.expiresAt) {
      this.otpStore.delete(`link_${deliveryId}`);
      return { verified: false, error: 'Link expired' };
    }
    
    this.otpStore.delete(`link_${deliveryId}`);
    return { verified: true };
  }
}

module.exports = new DeliveryOTPService();