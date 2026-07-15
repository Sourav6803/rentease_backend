// const { AuthService } = require('../../services/auth.service');
const AuthService = require("../../services/auth.service")
const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const { validate } = require('../middlewares/validation.middleware');
const { authValidations } = require('../middlewares/validation.middleware');
const { AppError } = require('../../utils/AppError');
const logger = require('../../config/logger');

/** Map multer/Cloudinary `req.vendorDocuments` to `{ type, url }[]` for registerVendor. */
function mapVendorUploadsToDocuments(vendorDocuments) {
  if (!vendorDocuments || typeof vendorDocuments !== 'object') return [];
  const keyToType = {
    gstCertificate: 'gst_certificate',
    panCard: 'pan_card',
    businessProof: 'business_registration',
    addressProof: 'address_proof',
    bankStatement: 'bank_statement',
  };
  return Object.entries(keyToType).flatMap(([field, type]) => {
    const entry = vendorDocuments[field];
    return entry && entry.url ? [{ type, url: entry.url }] : [];
  });
}

class AuthController {
  /**
   * Register new user
   */
  register = catchAsync(async (req, res) => {
    const userData = req.body;
    const result = await AuthService.register(userData);
    
    return ApiResponse.success(res, 201, 'Registration successful', {
      user: result.user,
      message: result.message,
    });
  });

  /**
   * Login user
   */
  login = catchAsync(async (req, res) => {
    const credentials = req.body;
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    const result = await AuthService.login(credentials, ipAddress, userAgent);

    // Set cookies
    this.setTokenCookies(res, result.tokens);

    return ApiResponse.success(res, 200, 'Login successful', {
      user: result.user,
      roleData: result.roleData,
      tokens: result.tokens,
    });
  });

  /**
   * Refresh access token
   */
  refreshToken = catchAsync(async (req, res) => {
    const { refreshToken } = req.body;
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    if (!refreshToken) {
      throw new AppError('Refresh token is required', 400);
    }

    const tokens = await AuthService.refreshToken(refreshToken, ipAddress, userAgent);

    // Update cookies
    this.setTokenCookies(res, tokens);

    return ApiResponse.success(res, 200, 'Token refreshed', { tokens });
  });

  /**
   * Logout user
   */
  logout = catchAsync(async (req, res) => {
    const { refreshToken } = req.body;
    const accessToken = req.headers.authorization;

    await AuthService.logout(req.user._id, refreshToken, accessToken);

    // Clear cookies
    this.clearTokenCookies(res);

    return ApiResponse.success(res, 200, 'Logout successful');
  });

  /**
   * Logout from all devices
   */
  logoutAll = catchAsync(async (req, res) => {
    await AuthService.logoutAll(req.user._id);

    // Clear cookies
    this.clearTokenCookies(res);

    return ApiResponse.success(res, 200, 'Logged out from all devices');
  });

  /**
   * Verify email
   */
  verifyEmail = catchAsync(async (req, res) => {
    const { token } = req.params;
    
    if (!token) {
      throw new AppError('Verification token is required', 400);
    }

    const result = await AuthService.verifyEmail(token);

    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Resend verification email
   */
  resendVerificationEmail = catchAsync(async (req, res) => {
    const { email } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400);
    }

    const result = await AuthService.resendVerificationEmail(email);

    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Send phone OTP
   */
  sendPhoneOTP = catchAsync(async (req, res) => {
    const { phone } = req.body;

    if (!phone) {
      throw new AppError('Phone number is required', 400);
    }

    const result = await AuthService.sendPhoneOTP(phone);

    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Verify phone OTP
   */
  verifyPhoneOTP = catchAsync(async (req, res) => {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      throw new AppError('Phone and OTP are required', 400);
    }

    const result = await AuthService.verifyPhoneOTP(phone, otp);

    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Forgot password
   */
  forgotPassword = catchAsync(async (req, res) => {
    const { email } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400);
    }

    const result = await AuthService.forgotPassword(email);

    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Reset password
   */
  resetPassword = catchAsync(async (req, res) => {
    const { token, password } = req.body;

    if (!token || !password) {
      throw new AppError('Token and password are required', 400);
    }

    const result = await AuthService.resetPassword(token, password);

    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Change password
   */
  changePassword = catchAsync(async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new AppError('Current password and new password are required', 400);
    }

    const result = await AuthService.changePassword(
      req.user._id,
      currentPassword,
      newPassword
    );

    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Validate token
   */
  validateToken = catchAsync(async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      throw new AppError('Token is required', 400);
    }

    const result = await AuthService.validateToken(token);

    return ApiResponse.success(res, 200, 'Token validation complete', result);
  });

  /**
   * Social login (Google)
   */
  googleLogin = catchAsync(async (req, res) => {
    // This endpoint would be called after OAuth redirect
    const { code } = req.query;
    
    if (!code) {
      throw new AppError('Authorization code is required', 400);
    }

    // Exchange code for profile (implement based on your OAuth flow)
    const profile = await this.getGoogleProfile(code);
    
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    const result = await AuthService.socialLogin('google', profile, ipAddress, userAgent);

    this.setTokenCookies(res, result.tokens);

    // Redirect to frontend with tokens (or return JSON for API)
    if (req.accepts('html')) {
      const redirectUrl = `${process.env.CLIENT_URL}/auth/social-callback?token=${result.tokens.accessToken}&refreshToken=${result.tokens.refreshToken}`;
      return res.redirect(redirectUrl);
    }

    return ApiResponse.success(res, 200, 'Google login successful', result);
  });

  /**
   * Social login (Facebook)
   */
  facebookLogin = catchAsync(async (req, res) => {
    const { accessToken } = req.body;

    if (!accessToken) {
      throw new AppError('Access token is required', 400);
    }

    // Get profile from Facebook
    const profile = await this.getFacebookProfile(accessToken);
    
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    const result = await AuthService.socialLogin('facebook', profile, ipAddress, userAgent);

    this.setTokenCookies(res, result.tokens);

    return ApiResponse.success(res, 200, 'Facebook login successful', result);
  });

  /**
   * Get current user
   */
  getCurrentUser = catchAsync(async (req, res) => {
    const user = await AuthService.getUserById(req.user._id);
    
    return ApiResponse.success(res, 200, 'User retrieved', { user });
  });

  /**
   * Get user sessions
   */
  getUserSessions = catchAsync(async (req, res) => {
    const sessions = await AuthService.getUserSessions(req.user._id);
    
    // Mark current session
    const currentToken = req.headers.authorization?.replace('Bearer ', '');
    const sessionsWithCurrent = sessions.map(session => ({
      ...session,
      isCurrent: session.id === currentToken?.substring(0, 10) + '...',
    }));

    return ApiResponse.success(res, 200, 'Sessions retrieved', { sessions: sessionsWithCurrent });
  });

  /**
   * Revoke session
   */
  revokeSession = catchAsync(async (req, res) => {
    const { sessionId } = req.params;

    if (!sessionId) {
      throw new AppError('Session ID is required', 400);
    }

    await AuthService.revokeSession(req.user._id, sessionId);

    return ApiResponse.success(res, 200, 'Session revoked successfully');
  });

  /**
   * Set token cookies
   */
  setTokenCookies(res, tokens) {
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: '/api/v1/auth/refresh-token',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }

  /**
   * Clear token cookies
   */
  clearTokenCookies(res) {
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
  }

  /**
   * Get Google profile (implement based on your OAuth setup)
   */
  async getGoogleProfile(code) {
    // Implement Google OAuth token exchange
    // This is a placeholder - implement actual OAuth flow
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      photo: payload.picture,
    };
  }

  /**
   * Get Facebook profile (implement based on your OAuth setup)
   */
  async getFacebookProfile(accessToken) {
    // Implement Facebook profile fetch
    // This is a placeholder - implement actual Facebook API call
    const axios = require('axios');
    
    const response = await axios.get(
      `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`
    );

    return {
      id: response.data.id,
      email: response.data.email,
      name: response.data.name,
      photo: response.data.picture?.data?.url,
    };
  }

  /**
 * Register vendor
 */
  registerVendor = catchAsync(async (req, res) => {
    const documentsFromUploads = mapVendorUploadsToDocuments(req.vendorDocuments);

    const vendorData = {
      ...req.body,
      documents: documentsFromUploads,
      role: 'vendor',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    };

    const result = await AuthService.registerVendor(vendorData);
    
    return ApiResponse.success(res, 201, 'Vendor registration successful. Please wait for verification.', {
      user: result.user,
      vendor: result.vendor,
      message: result.message
    });
  });
}

module.exports = new AuthController();