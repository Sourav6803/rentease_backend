const AdminAuthService = require('../../services/admin-auth.service');
const catchAsync  = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const  {AppError}  = require('../../utils/AppError');
const logger = require('../../config/logger');
const jwt = require('jsonwebtoken');

class AdminAuthController {
  /**
   * Register new admin (Super Admin only)
   */
  registerAdmin = catchAsync(async (req, res) => {
    // Check if current user is super admin
    if (req.admin?.role !== 'super_admin') {
      throw new AppError('Only super admins can create new admins', 403);
    }

    const result = await AdminAuthService.registerAdmin(req.body, req.admin._id);
    
    return ApiResponse.success(res, 201, result.message, {
      admin: result.admin
    });
  });

  /**
   * Admin login
   */
  login = catchAsync(async (req, res) => {
    const { email, phone, password } = req.body;
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    if ((!email && !phone) || !password) {
      throw new AppError('Please provide email/phone and password', 400);
    }

    const result = await AdminAuthService.loginAdmin(
      { email, phone, password },
      ipAddress,
      userAgent
    );

    // Set cookies for tokens
    if (result.tokens) {
      this.setTokenCookies(res, result.tokens);
      req.admin = result.admin; 
    }

    return ApiResponse.success(res, 200, 'Login successful', result);
  });

  /**
   * Verify 2FA
   */
  verify2FA = catchAsync(async (req, res) => {
    const { adminId, otp } = req.body;

    if (!adminId || !otp) {
      throw new AppError('Admin ID and OTP are required', 400);
    }

    const result = await AdminAuthService.verify2FA(adminId, otp);

    if (result.tokens) {
      this.setTokenCookies(res, result.tokens);
    }

    return ApiResponse.success(res, 200, '2FA verified successfully', result);
  });

  /**
   * Change password
   */
  changePassword = catchAsync(async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword) {
      throw new AppError('New password is required', 400);
    }

    const result = await AdminAuthService.changePassword(
      req.admin._id,
      currentPassword,
      newPassword
    );

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

    const result = await AdminAuthService.forgotPassword(email);

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

    const result = await AdminAuthService.resetPassword(token, password);

    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Verify email
   */
  verifyEmail = catchAsync(async (req, res) => {
    const { token } = req.params;

    if (!token) {
      throw new AppError('Verification token is required', 400);
    }

    const result = await AdminAuthService.verifyEmail(token);

    return ApiResponse.success(res, 200, result.message);
  });

  /**
   * Logout
   */
  logout = catchAsync(async (req, res) => {
    const { refreshToken } = req.body;

    await AdminAuthService.logoutAdmin(req.admin._id, refreshToken);

    this.clearTokenCookies(res);

    return ApiResponse.success(res, 200, 'Logged out successfully');
  });

  /**
   * Get current admin profile
   */
  getProfile = catchAsync(async (req, res) => {
    const profile = await AdminAuthService.getAdminProfile(req.admin._id);

    return ApiResponse.success(res, 200, 'Profile retrieved successfully', { profile });
  });

  /**
   * Update admin profile
   */
  updateProfile = catchAsync(async (req, res) => {
    const profile = await AdminAuthService.updateAdminProfile(req.admin._id, req.body);

    return ApiResponse.success(res, 200, 'Profile updated successfully', { profile });
  });

  /**
   * Refresh token
   */
  refreshToken = catchAsync(async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new AppError('Refresh token is required', 400);
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    const admin = await Admin.findById(decoded.id);
    if (!admin) {
      throw new AppError('Invalid refresh token', 401);
    }

    // Generate new tokens
    const tokens = await AdminAuthService.generateAuthTokens(admin);

    this.setTokenCookies(res, tokens);

    return ApiResponse.success(res, 200, 'Token refreshed successfully', { tokens });
  });

  /**
   * Set token cookies
   */
  setTokenCookies(res, tokens) {
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('adminAccessToken', tokens.accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 15 * 60 * 1000,
      // path: '/api/v1/admin'
    });

    res.cookie('adminRefreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      // path: '/api/v1/admin/auth/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
  }

  /**
   * Clear token cookies
   */
  clearTokenCookies(res) {
    res.clearCookie('adminAccessToken');
    res.clearCookie('adminRefreshToken');
  }
}

module.exports = new AdminAuthController();
