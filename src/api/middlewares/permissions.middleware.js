const AppError = require('../../utils/AppError');
const catchAsync = require('../../utils/catchAsync');
const Vendor = require('../../models/Vendor.model');
// const Vendor = require('../models/Vendor.model');

// Restrict to specific roles
const normalizeRole = (role) => role?.toLowerCase().replace(/-/g, '_');

const restrictTo = (...roles) => {
  return (req, res, next) => {
    const userRole = normalizeRole(req.admin?.role || req.userRole || req.user?.role || req.vendor?.user?.role);
    const allowedRoles = roles.map(normalizeRole);
    if (!userRole || !allowedRoles.includes(userRole)) {
      return next(new AppError('You do not have permission to perform this action.', 403));
    }
    next();
  };
};

// Check if user is owner of resource
const isOwner = (model, idField = 'id') => {
  return catchAsync(async (req, res, next) => {
    const resourceId = req.params[idField];
    const Model = require(`../models/${model}.model`);
    
    const resource = await Model.findById(resourceId);
    
    if (!resource) {
      return next(new AppError('Resource not found', 404));
    }

    // Check if user is owner or admin
    const isAdmin = req.userRole === 'admin' || req.userRole === 'super_admin';
    const isOwner = resource.user?.toString() === req.userId?.toString() ||
                   resource.vendor?.toString() === req.userId?.toString();

    if (!isOwner && !isAdmin) {
      return next(new AppError('You do not have permission to access this resource.', 403));
    }

    req.resource = resource;
    next();
  });
};

// Check vendor permissions
const vendorPermission = (action) => {
  return catchAsync(async (req, res, next) => {
    if (req.userRole !== 'vendor') {
      return next(new AppError('Vendor access required', 403));
    }

    // Get vendor details from database
    
    const vendor = await Vendor.findOne({ user: req.userId });

    if (!vendor) {
      return next(new AppError('Vendor profile not found', 404));
    }

    if (!vendor.status.isActive) {
      return next(new AppError('Your vendor account is not active', 403));
    }

    // Check specific vendor permissions
    const permissions = {
      'add_product': vendor.subscription.plan !== 'basic',
      'manage_inventory': vendor.subscription.plan !== 'basic',
      'view_analytics': vendor.subscription.plan !== 'basic',
      'create_discount': vendor.subscription.plan === 'premium' || vendor.subscription.plan === 'enterprise'
    };

    if (permissions[action] === false) {
      return next(new AppError('Your current plan does not allow this action', 403));
    }

    req.vendor = vendor;
    next();
  });
};

// Admin permission check
const adminPermission = (resource, action) => {
  return catchAsync(async (req, res, next) => {
    if (!req.admin) {
      return next(new AppError('Admin access required', 403));
    }

    const hasPermission = req.admin.hasPermission(resource, action);
    
    if (!hasPermission) {
      return next(new AppError('You do not have permission to perform this action admin permission', 403));
    }

    next();
  });
};

// Rate limit based on user role
const roleBasedRateLimit = (limits) => {
  return (req, res, next) => {
    const role = req.userRole || 'guest';
    const limit = limits[role] || limits.default || 100;
    
    req.rateLimit = {
      max: limit,
      windowMs: 15 * 60 * 1000 // 15 minutes
    };
    
    next();
  };
};

// Check if user can modify resource
const canModify = (resourceType) => {
  return catchAsync(async (req, res, next) => {
    const resourceId = req.params.id;
    const Model = require(`../models/${resourceType}.model`);
    
    const resource = await Model.findById(resourceId);
    
    if (!resource) {
      return next(new AppError(`${resourceType} not found`, 404));
    }

    // Check modification permissions
    const canModify = 
      req.userRole === 'admin' ||
      req.userRole === 'super_admin' ||
      (resource.user && resource.user.toString() === req.userId) ||
      (resource.vendor && resource.vendor.toString() === req.userId);

    if (!canModify) {
      return next(new AppError('You cannot modify this resource', 403));
    }

    req.resource = resource;
    next();
  });
};

// Check resource visibility
const checkVisibility = (model, publicFields = []) => {
  return catchAsync(async (req, res, next) => {
    const resourceId = req.params.id;
    const Model = require(`../models/${model}.model`);
    
    const resource = await Model.findById(resourceId);
    
    if (!resource) {
      return next(new AppError('Resource not found', 404));
    }

    // Check if resource is public or user has access
    const isPublic = resource.status?.isPublic || false;
    const isOwner = resource.user?.toString() === req.userId;
    const isAdmin = req.userRole === 'admin' || req.userRole === 'super_admin';

    if (!isPublic && !isOwner && !isAdmin) {
      return next(new AppError('You do not have access to this resource', 403));
    }

    // Filter fields for public access
    if (isPublic && !isOwner && !isAdmin && publicFields.length > 0) {
      const filteredResource = {};
      publicFields.forEach(field => {
        if (resource[field]) {
          filteredResource[field] = resource[field];
        }
      });
      req.resource = filteredResource;
    } else {
      req.resource = resource;
    }

    next();
  });
};

module.exports = {
  restrictTo,
  isOwner,
  vendorPermission,
  adminPermission,
  roleBasedRateLimit,
  canModify,
  checkVisibility
};