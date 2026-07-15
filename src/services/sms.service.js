// services/smsService.js
const twilio = require('twilio');
const crypto = require('crypto');

class SMSService {
  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
    this.otpStore = new Map();
    this.enabled = false;

    if (accountSid && authToken && accountSid.startsWith('AC')) {
      try {
        this.client = twilio(accountSid, authToken);
        this.enabled = true;
      } catch (error) {
        console.warn('Twilio initialization failed:', error.message);
        this.client = null;
      }
    } else {
      this.client = null;
    }
  }

  isReady() {
    if (!this.enabled || !this.client) {
      throw new Error('SMS service is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables.');
    }
    return true;
  }

  async sendMessage(to, body, options = {}) {
    this.isReady();
    const message = await this.client.messages.create({
      body,
      from: this.fromNumber,
      to,
      ...options
    });
    return { success: true, sid: message.sid };
  }

  /**
   * Generate and send OTP for login
   */
  async sendLoginOTP(phoneNumber) {
    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + (10 * 60 * 1000); // 10 minutes expiry
    
    // Store OTP (use Redis/DB in production)
    this.otpStore.set(phoneNumber, {
      otp: otp,
      expiresAt: expiresAt,
      attempts: 0
    });
    
    // Send OTP via SMS
    const messageBody = `Your login OTP is: ${otp}. Valid for 10 minutes.`;
    await this.sendMessage(phoneNumber, messageBody);
    
    return { 
      success: true, 
      message: "OTP sent successfully",
      expiresIn: "10 minutes"
    };
  }

  /**
   * Verify OTP during login
   */
  verifyOTP(phoneNumber, userEnteredOTP) {
    const storedData = this.otpStore.get(phoneNumber);
    
    if (!storedData) {
      return { success: false, error: "OTP not found or expired" };
    }
    
    // Check expiration
    if (Date.now() > storedData.expiresAt) {
      this.otpStore.delete(phoneNumber);
      return { success: false, error: "OTP has expired" };
    }
    
    // Check attempts (max 3 attempts)
    if (storedData.attempts >= 3) {
      this.otpStore.delete(phoneNumber);
      return { success: false, error: "Too many failed attempts" };
    }
    
    // Verify OTP
    if (storedData.otp === userEnteredOTP) {
      this.otpStore.delete(phoneNumber); // Clear on successful verification
      return { success: true, message: "OTP verified successfully" };
    } else {
      storedData.attempts++;
      this.otpStore.set(phoneNumber, storedData);
      return { success: false, error: "Invalid OTP" };
    }
  }

  /**
   * Send transaction alert
   */
  async sendTransactionAlert(phoneNumber, amount, transactionType, balance) {
    this.isReady();
    const message = `${transactionType} of ₹${amount} completed successfully. Your balance: ₹${balance}`;
    return await this.sendMessage(phoneNumber, message);
  }

  async sendOrderConfirmation(phoneNumber, orderId, items, total) {
    this.isReady();
    const message = `Order #${orderId} confirmed! Total: ₹${total}. Will be delivered soon.`;
    return await this.sendMessage(phoneNumber, message);
  }

  async sendPasswordResetOTP(phoneNumber) {
    this.isReady();
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + (15 * 60 * 1000);

    this.otpStore.set(`reset_${phoneNumber}`, {
      otp,
      expiresAt,
      attempts: 0
    });

    const messageBody = `Password reset OTP: ${otp}. Valid for 15 minutes.`;
    await this.sendMessage(phoneNumber, messageBody);

    return { success: true, message: "Reset OTP sent" };
  }

  async getBalance() {
    this.isReady();
    const balance = await this.client.balance.fetch();
    return { balance: Number(balance.balance), currency: balance.currency };
  }
}

module.exports = new SMSService();
