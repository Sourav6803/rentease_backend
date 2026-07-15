const { validationResult, body, param, query } = require('express-validator');
const AppError = require('../../utils/AppError');
const mongoose = require('mongoose');
const { SUPPORT_TICKET_TYPES, SUPPORT_PRIORITIES, SUPPORT_STATUSES } = require('../../config/constants');

// Validation result handler
const validate = (validations) => {
  return async (req, res, next) => {
    
    // Ensure validations is an array
    let validationArray = validations;
    if (!Array.isArray(validations)) {
      // console.log('⚠️ Validations is not an array, converting to array');
      validationArray = [validations];
    }
    
    try {
      // Run all validations
      for (let validation of validationArray) {
        if (typeof validation === 'function') {
          await validation.run(req);
        } else {
          console.log('⚠️ Validation is not a function:', validation);
        }
      }
      
      const errors = validationResult(req);
      // console.log('✅ Validation results:', errors.isEmpty() ? 'No errors' : 'Errors found');
      
      if (errors.isEmpty()) {
        // console.log('✅ Validation passed');
        return next();
      }

      const extractedErrors = errors.array().map(err => ({
        field: err.path,
        message: err.msg
      }));
      console.log('❌ Validation errors:', extractedErrors);

      return next(new AppError('Validation failed', 400, extractedErrors));
    } catch (error) {
      console.error('❌ Validation middleware error:', error);
      return next(error);
    }
  };
};

// Common validation rules
const commonValidators = {
  // Email validation
  email: body('email')
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail()
    .toLowerCase(),

  // Password validation
  password: body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number')
    .matches(/[@$!%*?&]/).withMessage('Password must contain at least one special character'),

  // Phone validation
  phone: body('phone')
    .matches(/^[6-9]\d{9}$/).withMessage('Please provide a valid Indian phone number'),

  // Name validation
  name: body('name')
    .trim()
    .isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s]+$/).withMessage('Name can only contain letters and spaces'),

  // MongoDB ObjectId validation
  objectId: (field) => param(field)
    .custom(value => mongoose.Types.ObjectId.isValid(value))
    .withMessage(`Invalid ${field} format`),

  // Pagination validation
  pagination: [
    query('page')
      .optional()
      .isInt({ min: 1 }).withMessage('Page must be a positive integer')
      .toInt(),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
      .toInt(),
    query('sort')
      .optional()
      .isString().withMessage('Sort must be a string')
  ],

  // Date validation
  date: (field) => body(field)
    .optional()
    .isISO8601().withMessage(`Invalid date format for ${field}`)
    .toDate(),

  // Enum validation
  enum: (field, values) => body(field)
    .isIn(values).withMessage(`${field} must be one of: ${values.join(', ')}`),

  // Number validation
  number: (field, options = {}) => body(field)
    .optional()
    .isNumeric().withMessage(`${field} must be a number`)
    .custom(value => {
      if (options.min !== undefined && value < options.min) {
        throw new Error(`${field} must be at least ${options.min}`);
      }
      if (options.max !== undefined && value > options.max) {
        throw new Error(`${field} must not exceed ${options.max}`);
      }
      return true;
    })
};

// Auth validations
const authValidations = {

  register: [
    body('email')
      .notEmpty().withMessage('Email is required')
      .isEmail().withMessage('Please provide a valid email')
      .normalizeEmail(),
    
    body('password')
      .notEmpty().withMessage('Password is required')
      .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    
    body('phone')
      .optional()
      .isMobilePhone('any').withMessage('Please provide a valid phone number'),
  ],

  login: [
    body('email').optional().isEmail().withMessage('Valid email required'),
    body('phone').optional().matches(/^[6-9]\d{9}$/).withMessage('Valid phone required'),
    body('password').notEmpty().withMessage('Password is required'),
    body().custom((value, { req }) => {
      if (!req.body.email && !req.body.phone) {
        throw new Error('Either email or phone is required');
      }
      return true;
    })
  ],

  verifyOtp: validate([
    commonValidators.phone.notEmpty().withMessage('Phone is required'),
    body('otp')
      .isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
      .isNumeric().withMessage('OTP must contain only numbers')
  ]),

  forgotPassword: validate([
    commonValidators.email.notEmpty().withMessage('Email is required')
  ]),

  resetPassword: validate([
    body('token').notEmpty().withMessage('Token is required'),
    commonValidators.password.notEmpty().withMessage('Password is required'),
    body('confirmPassword')
      .notEmpty().withMessage('Confirm password is required')
      .custom((value, { req }) => value === req.body.password)
      .withMessage('Passwords do not match')
  ]),

  changePassword: validate([
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    commonValidators.password.notEmpty().withMessage('New password is required'),
    body('confirmPassword')
      .notEmpty().withMessage('Confirm password is required')
      .custom((value, { req }) => value === req.body.password)
      .withMessage('Passwords do not match')
  ])
};

// User validations
const userValidations = {
  updateProfile: [
    body("profile.firstName")
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage("First name must be between 2 and 50 characters")
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage("First name can only contain letters and spaces"),

    body("profile.lastName")
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage("Last name must be between 2 and 50 characters")
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage("Last name can only contain letters and spaces"),

    body("profile.dateOfBirth")
      .optional()
      .isISO8601()
      .withMessage("Invalid date format")
      .toDate(),

    body("profile.gender")
      .optional()
      .isIn(["male", "female", "other"])
      .withMessage("Invalid gender"),

    body("email")
      .optional()
      .isEmail()
      .withMessage("Please provide a valid email")
      .normalizeEmail(),

    body("phone")
      .optional()
      .matches(/^[6-9]\d{9}$/)
      .withMessage("Please provide a valid Indian phone number"),
  ],

  addAddress: [
    body("addressType")
      .optional()
      .isIn(["home", "work", "other"])
      .withMessage("Invalid address type"),

    body("addressLine1")
      .notEmpty()
      .withMessage("Address line 1 is required")
      .trim()
      .isLength({ min: 3, max: 100 })
      .withMessage("Address must be between 3 and 100 characters"),

    body("addressLine2")
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage("Address line 2 must not exceed 100 characters"),

    // body("area")
    //   .notEmpty()
    //   .withMessage("Area is required")
    //   .trim()
    //   .isLength({ min: 2, max: 50 }),

    body("city")
      .notEmpty()
      .withMessage("City is required")
      .trim()
      .isLength({ min: 2, max: 50 }),

    body("state")
      .notEmpty()
      .withMessage("State is required")
      .trim()
      .isLength({ min: 2, max: 50 }),

    body("pincode")
      .notEmpty()
      .withMessage("Pincode is required")
      .matches(/^[1-9][0-9]{5}$/)
      .withMessage("Please provide a valid Indian pincode"),

    body("contactDetails.name")
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 }),

    body("contactDetails.phone")
      .notEmpty()
      .withMessage("Phone number is required"),
      // .matches(/^[6-9]\d{9}$/)
      // .withMessage("Please provide a valid Indian phone number"),

    body("isDefault")
      .optional()
      .isBoolean()
      .withMessage("isDefault must be a boolean"),
  ],

  updateAddress: [
    body("addressType").optional().isIn(["home", "work", "other"]),

    body("addressLine1").optional().trim().isLength({ min: 3, max: 100 }),

    body("addressLine2").optional().trim().isLength({ max: 100 }),

    body("area").optional().trim().isLength({ min: 2, max: 50 }),

    body("city").optional().trim().isLength({ min: 2, max: 50 }),

    body("state").optional().trim().isLength({ min: 2, max: 50 }),

    body("pincode")
      .optional()
      .matches(/^[1-9][0-9]{5}$/),

    body("contactDetails.phone")
      .optional()
      .matches(/^[6-9]\d{9}$/),

    body("isDefault").optional().isBoolean(),
  ],

  updateNotifications: [
    body("email").optional().isBoolean(),
    body("sms").optional().isBoolean(),
    body("push").optional().isBoolean(),
  ],

  deleteAccount: [
    body("password").notEmpty().withMessage("Password is required"),
  ],

  // Admin validations
  updateRole: [
    body("role")
      .notEmpty()
      .withMessage("Role is required")
      .isIn(["user", "vendor", "admin", "super-admin"])
      .withMessage("Invalid role"),
  ],

  blockUser: [
    body("reason")
      .optional()
      .isString()
      .isLength({ max: 500 })
      .withMessage("Reason must not exceed 500 characters"),
  ],
};

const categoryValidations = {
  createCategory: [
    body('name')
      .notEmpty()
      .withMessage('Category name is required')
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Category name must be between 2 and 50 characters'),
    
    body('description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Description must not exceed 500 characters'),
    
    body('parent')
      .optional()
      .isMongoId()
      .withMessage('Invalid parent category ID'),
    
    body('image.url')
      .optional()
      .isURL()
      .withMessage('Invalid image URL'),
    
    body('displayOrder')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Display order must be a positive integer'),
    
    body('attributes')
      .optional()
      .isArray()
      .withMessage('Attributes must be an array'),
    
    body('attributes.*.name')
      .if(body('attributes').exists())
      .notEmpty()
      .withMessage('Attribute name is required'),
    
    body('attributes.*.type')
      .if(body('attributes').exists())
      .isIn(['text', 'number', 'boolean', 'select', 'multiselect'])
      .withMessage('Invalid attribute type'),
    
    body('attributes.*.options')
      .if(body('attributes.*.type').isIn(['select', 'multiselect']))
      .isArray({ min: 1 })
      .withMessage('Options are required for select/multiselect attributes'),
    
    body('isFeatured')
      .optional()
      .isBoolean()
      .withMessage('isFeatured must be a boolean'),
  ],

  updateCategory: [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Category name must be between 2 and 50 characters'),
    
    body('description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Description must not exceed 500 characters'),
    
    body('parent')
      .optional()
      .isMongoId()
      .withMessage('Invalid parent category ID'),
    
    body('image.url')
      .optional()
      .isURL()
      .withMessage('Invalid image URL'),
    
    body('displayOrder')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Display order must be a positive integer'),
    
    body('attributes')
      .optional()
      .isArray()
      .withMessage('Attributes must be an array'),
    
    body('isActive')
      .optional()
      .isBoolean()
      .withMessage('isActive must be a boolean'),
    
    body('isFeatured')
      .optional()
      .isBoolean()
      .withMessage('isFeatured must be a boolean'),
  ],

  toggleStatus: [
    body('isActive')
      .notEmpty()
      .withMessage('isActive is required')
      .isBoolean()
      .withMessage('isActive must be a boolean'),
  ],

  reorder: [
    body('orderedIds')
      .notEmpty()
      .withMessage('Ordered IDs are required')
      .isArray()
      .withMessage('Ordered IDs must be an array'),
    
    body('orderedIds.*')
      .isMongoId()
      .withMessage('Invalid category ID in ordered list'),
  ],

  bulkUpdate: [
    body('updates')
      .notEmpty()
      .withMessage('Updates are required')
      .isArray()
      .withMessage('Updates must be an array'),
    
    body('updates.*.id')
      .notEmpty()
      .withMessage('Category ID is required for each update')
      .isMongoId()
      .withMessage('Invalid category ID'),
  ],

  import: [
    body('categories')
      .notEmpty()
      .withMessage('Categories are required')
      .isArray({ min: 1 })
      .withMessage('Categories must be a non-empty array'),
    
    body('categories.*.name')
      .notEmpty()
      .withMessage('Category name is required for each category'),
  ],
};

// Product validations
const productValidations = {
  createProduct: [
    body('basicInfo.name')
      .notEmpty()
      .withMessage('Product name is required')
      .trim()
      .isLength({ min: 3, max: 100 })
      .withMessage('Product name must be between 3 and 100 characters'),
    
    body('basicInfo.description')
      .optional()
      .trim()
      .isLength({ max: 2000 })
      .withMessage('Description must not exceed 2000 characters'),
    
    body('basicInfo.brand')
      .optional()
      .trim()
      .isLength({ max: 50 })
      .withMessage('Brand name must not exceed 50 characters'),
    
    body('category')
      .notEmpty()
      .withMessage('Category is required')
      .isMongoId()
      .withMessage('Invalid category ID'),
    
    body('pricing.monthlyRent')
      .notEmpty()
      .withMessage('Monthly rent is required')
      .isFloat({ min: 0 })
      .withMessage('Monthly rent must be a positive number'),
    
    body('pricing.securityDeposit')
      .notEmpty()
      .withMessage('Security deposit is required')
      .isFloat({ min: 0 })
      .withMessage('Security deposit must be a positive number'),
    
    body('pricing.deliveryCharges')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Delivery charges must be a positive number'),
    
    body('pricing.rentalOptions')
      .optional()
      .isArray()
      .withMessage('Rental options must be an array'),
    
    body('pricing.rentalOptions.*.months')
      .if(body('pricing.rentalOptions').exists())
      .isInt({ min: 1, max: 12 })
      .withMessage('Rental months must be between 1 and 12'),
    
    body('pricing.rentalOptions.*.discount')
      .if(body('pricing.rentalOptions').exists())
      .isFloat({ min: 0, max: 100 })
      .withMessage('Discount must be between 0 and 100'),
    
    body('inventory.totalQuantity')
      .notEmpty()
      .withMessage('Total quantity is required')
      .isInt({ min: 1 })
      .withMessage('Total quantity must be at least 1'),
    
    body('condition')
      .notEmpty()
      .withMessage('Condition is required')
      .isIn(['new', 'like-new', 'good', 'fair', 'refurbished'])
      .withMessage('Invalid condition'),
    
    body('specifications')
      .optional()
      .isObject()
      .withMessage('Specifications must be an object'),
    
    body('media.images')
      .optional()
      .isArray()
      .withMessage('Images must be an array'),
    
    body('rentalTerms.minRentalMonths')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Minimum rental months must be at least 1'),
    
    body('rentalTerms.maxRentalMonths')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Maximum rental months must be at least 1'),
    
    body('tags')
      .optional()
      .isArray()
      .withMessage('Tags must be an array'),
    
    body('generateDescription')
      .optional()
      .isBoolean()
      .withMessage('generateDescription must be a boolean'),
  ],

  updateProduct: [
    body('basicInfo.name')
      .optional()
      .trim()
      .isLength({ min: 3, max: 100 }),
    
    body('basicInfo.description')
      .optional()
      .trim()
      .isLength({ max: 2000 }),
    
    body('category')
      .optional()
      .isMongoId(),
    
    body('pricing.monthlyRent')
      .optional()
      .isFloat({ min: 0 }),
    
    body('pricing.securityDeposit')
      .optional()
      .isFloat({ min: 0 }),
    
    body('inventory.totalQuantity')
      .optional()
      .isInt({ min: 1 }),
    
    body('condition')
      .optional()
      .isIn(['new', 'like-new', 'good', 'fair', 'refurbished']),
    
    body('status.isActive')
      .optional()
      .isBoolean(),
    
    body('status.isFeatured')
      .optional()
      .isBoolean(),
  ],

  generateDescription: [
    body('name')
      .notEmpty()
      .withMessage('Product name is required'),
    body('category')
      .notEmpty()
      .withMessage('Category is required'),
    body('brand')
      .optional(),
    body('specifications')
      .optional(),
  ],

  bulkUpdate: [
    body('updates')
      .isArray({ min: 1 })
      .withMessage('Updates must be a non-empty array'),
    
    body('updates.*.id')
      .notEmpty()
      .withMessage('Product ID is required for each update')
      .isMongoId()
      .withMessage('Invalid product ID'),
  ],

  updateStock: [
    body('quantity')
      .notEmpty()
      .withMessage('Quantity is required')
      .isInt({ min: 1 })
      .withMessage('Quantity must be a positive integer'),
    
    body('operation')
      .notEmpty()
      .withMessage('Operation is required')
      .isIn(['add', 'remove'])
      .withMessage('Operation must be either add or remove'),
  ],

  toggleFeatured: [
    body('isFeatured')
      .notEmpty()
      .withMessage('isFeatured is required')
      .isBoolean()
      .withMessage('isFeatured must be a boolean'),
  ],

  rejectProduct: [
    body('reason')
      .notEmpty()
      .withMessage('Rejection reason is required')
      .trim()
      .isLength({ min: 10, max: 500 })
      .withMessage('Reason must be between 10 and 500 characters'),
  ],

  importProducts: [
    body('products')
      .isArray({ min: 1 })
      .withMessage('Products must be a non-empty array'),
    
    body('products.*.basicInfo.name')
      .notEmpty()
      .withMessage('Product name is required for each product'),
    
    body('products.*.vendorId')
      .notEmpty()
      .withMessage('Vendor ID is required for each product')
      .isMongoId()
      .withMessage('Invalid vendor ID'),
  ],
};

// Rental validations
const rentalValidations = {
  createRental: [
    body("productId")
      .notEmpty()
      .withMessage("Product ID is required")
      .isMongoId()
      .withMessage("Invalid product ID"),

    body("addressId")
      .notEmpty()
      .withMessage("Address ID is required")
      .isMongoId()
      .withMessage("Invalid address ID"),

    body("startDate")
      .notEmpty()
      .withMessage("Start date is required")
      .isISO8601()
      .withMessage("Invalid start date format")
      .custom((value) => {
        if (new Date(value) < new Date()) {
          throw new Error("Start date must be in the future");
        }
        return true;
      }),

    body("tenureMonths")
      .notEmpty()
      .withMessage("Tenure months is required")
      .isInt({ min: 1, max: 12 })
      .withMessage("Tenure must be between 1 and 12 months"),

    body("deliverySlot")
      .optional()
      .isString()
      .withMessage("Invalid delivery slot"),

    body("couponCode")
      .optional()
      .isString()
      .withMessage("Invalid coupon code")
      .trim()
      .toUpperCase(),

    body("specialRequests")
      .optional()
      .isString()
      .isLength({ max: 500 })
      .withMessage("Special requests must not exceed 500 characters"),
  ],

  // validation.middleware.js - Add cart-based rental validation

  // New validation for cart-based rental
  createRentalFromCart: [
    body('cartId')
      .notEmpty()
      .withMessage('Cart ID is required')
      .isMongoId()
      .withMessage('Invalid cart ID'),
    body('addressId')
      .notEmpty()
      .withMessage('Address ID is required')
      .isMongoId()
      .withMessage('Invalid address ID'),
    body('deliverySlot')
      .optional()
      .isString()
      .withMessage('Invalid delivery slot format'),
    body('specialRequests')
      .optional()
      .isString()
      // .maxLength(500)
      .withMessage('Special requests cannot exceed 500 characters'),
  ],
  
  // Keep original for backward compatibility
  createRental: [
    body('productId')
      .notEmpty()
      .withMessage('Product ID is required')
      .isMongoId()
      .withMessage('Invalid product ID'),
    body('addressId')
      .notEmpty()
      .withMessage('Address ID is required')
      .isMongoId()
      .withMessage('Invalid address ID'),
    body('startDate')
      .notEmpty()
      .withMessage('Start date is required')
      .isISO8601()
      .withMessage('Invalid start date format')
      .custom(value => {
        const startDate = new Date(value);
        if (startDate < new Date()) {
          throw new Error('Start date cannot be in the past');
        }
        return true;
      }),
    body('tenureMonths')
      .notEmpty()
      .withMessage('Tenure months is required')
      .isInt({ min: 1, max: 12 })
      .withMessage('Tenure must be between 1 and 12 months')
      .toInt(),
    body('deliverySlot')
      .optional()
      .isString(),
    body('specialRequests')
      .optional()
      .isString(),
      // .maxLength(500),
    body('couponCode')
      .optional()
      .isString()
      .isLength({ min: 3, max: 50 })
  ],
  
  cancelRental: [
    body('reason')
      .notEmpty()
      .withMessage('Cancellation reason is required')
      .isString()
      .isLength({ min: 5, max: 500 })
      .withMessage('Reason must be between 5 and 500 characters')
  ],
  
  extendRental: [
    body('extensionMonths')
      .notEmpty()
      .withMessage('Extension months is required')
      .isInt({ min: 1, max: 6 })
      .withMessage('Extension must be between 1 and 6 months')
      .toInt()
  ],
  
  approveExtension: [
    body('extensionIndex')
      .notEmpty()
      .withMessage('Extension index is required')
      .isInt({ min: 0 })
      .toInt()
  ],
  
  markDelivered: [
    body('proof')
      .optional()
      .isURL()
      .withMessage('Invalid proof URL'),
    body('notes')
      .optional()
      .isString()
      // .maxLength(500)
  ],
  
  initiateReturn: [
    body('returnDate')
      .notEmpty()
      .withMessage('Return date is required')
      .isISO8601()
      .withMessage('Invalid return date format')
      .custom(value => {
        const returnDate = new Date(value);
        if (returnDate < new Date()) {
          throw new Error('Return date cannot be in the past');
        }
        return true;
      }),
    body('returnSlot')
      .optional()
      .isString(),
    body('condition')
      .optional()
      .isIn(['good', 'fair', 'damaged'])
      .withMessage('Invalid condition'),
    body('images')
      .optional()
      .isArray()
      .withMessage('Images must be an array'),
    body('notes')
      .optional()
      .isString()
      // .maxLength(500)
  ],
  
  completeReturn: [
    body('condition')
      .notEmpty()
      .withMessage('Condition is required')
      .isIn(['good', 'fair', 'damaged'])
      .withMessage('Invalid condition'),
    body('damages')
      .optional()
      .isArray(),
    body('images')
      .optional()
      .isArray(),
    body('notes')
      .optional()
      .isString()
      // .maxLength(500)
  ],
  
  forceComplete: [
    body('reason')
      .notEmpty()
      .withMessage('Reason is required')
      .isString()
      .isLength({ min: 10, max: 500 })
  ]
,

  // cancelRental: [
  //   body("reason")
  //     .notEmpty()
  //     .withMessage("Cancellation reason is required")
  //     .isString()
  //     .isLength({ min: 5, max: 500 })
  //     .withMessage("Reason must be between 5 and 500 characters"),
  // ],

  // extendRental: [
  //   body("extensionMonths")
  //     .notEmpty()
  //     .withMessage("Extension months are required")
  //     .isInt({ min: 1, max: 6 })
  //     .withMessage("Extension must be between 1 and 6 months"),
  // ],

  // approveExtension: [
  //   body("extensionIndex")
  //     .notEmpty()
  //     .withMessage("Extension index is required")
  //     .isInt({ min: 0 })
  //     .withMessage("Invalid extension index"),
  // ],

  // initiateReturn: [
  //   body("returnDate")
  //     .notEmpty()
  //     .withMessage("Return date is required")
  //     .isISO8601()
  //     .withMessage("Invalid return date format")
  //     .custom((value, { req }) => {
  //       if (new Date(value) < new Date()) {
  //         throw new Error("Return date must be in the future");
  //       }
  //       return true;
  //     }),

  //   body("returnSlot").optional().isString(),

  //   body("condition")
  //     .optional()
  //     .isIn(["excellent", "good", "fair", "poor", "damaged"])
  //     .withMessage("Invalid condition"),

  //   body("images").optional().isArray(),

  //   body("notes").optional().isString().isLength({ max: 500 }),
  // ],

  // completeReturn: [
  //   body("condition")
  //     .notEmpty()
  //     .withMessage("Return condition is required")
  //     .isIn(["excellent", "good", "fair", "poor", "damaged"])
  //     .withMessage("Invalid condition"),

  //   body("damages").optional().isArray(),

  //   body("damages.*.description")
  //     .if(body("damages").exists())
  //     .notEmpty()
  //     .withMessage("Damage description is required"),

  //   body("damages.*.charge")
  //     .if(body("damages").exists())
  //     .optional()
  //     .isFloat({ min: 0 })
  //     .withMessage("Damage charge must be a positive number"),

  //   body("images").optional().isArray(),

  //   body("notes").optional().isString().isLength({ max: 500 }),
  // ],

  // markDelivered: [
  //   body("proof.signature").optional(),
  //   body("proof.photos").optional().isArray(),
  //   body("proof.otp").optional().isString().isLength({ min: 4, max: 6 }),
  //   body("notes").optional().isString(),
  // ],

  // forceComplete: [
  //   body("reason")
  //     .notEmpty()
  //     .withMessage("Reason is required for force completion")
  //     .isString()
  //     .isLength({ min: 10, max: 500 }),
  // ],
};

// Payment validations
const paymentValidations = {
  initiatePayment: [
    body('rentalId')
      .notEmpty()
      .withMessage('Rental ID is required')
      .isMongoId()
      .withMessage('Invalid rental ID'),
    
    body('amount')
      .notEmpty()
      .withMessage('Amount is required')
      .isFloat({ min: 1 })
      .withMessage('Amount must be greater than 0'),
    
    body('paymentType')
      .notEmpty()
      .withMessage('Payment type is required')
      .isIn(['security_deposit', 'rent', 'delivery', 'extension', 'full', 'damage_charge'])
      .withMessage('Invalid payment type'),
    
    body('paymentMethod')
      .notEmpty()
      .withMessage('Payment method is required')
      .isIn(['credit_card', 'debit_card', 'upi', 'net_banking', 'wallet', 'cash'])
      .withMessage('Invalid payment method'),
    
    body('gateway')
      .optional()
      .isIn(['razorpay', 'stripe'])
      .withMessage('Invalid payment gateway'),
  ],

  verifyPayment: [
    body('gateway')
      .notEmpty()
      .withMessage('Gateway is required'),
    
    body('orderId')
      .if(body('gateway').equals('razorpay'))
      .notEmpty()
      .withMessage('Order ID is required'),
    
    body('paymentId')
      .if(body('gateway').equals('razorpay'))
      .notEmpty()
      .withMessage('Payment ID is required'),
    
    body('signature')
      .if(body('gateway').equals('razorpay'))
      .notEmpty()
      .withMessage('Signature is required'),

    body('paymentIntentId')
      .if(body('gateway').equals('stripe'))
      .notEmpty()
      .withMessage('Payment intent ID is required for Stripe'),
  ],

  addPaymentMethod: [
    body('paymentMethodId')
      .notEmpty()
      .withMessage('Payment method ID is required'),
    
    body('type')
      .optional()
      .isIn(['card', 'upi', 'netbanking'])
      .withMessage('Invalid payment method type'),
    
    body('setDefault')
      .optional()
      .isBoolean()
      .withMessage('setDefault must be a boolean'),
  ],

  processRefund: [
    body('amount')
      .optional()
      .isFloat({ min: 1 })
      .withMessage('Refund amount must be greater than 0'),
    
    body('reason')
      .notEmpty()
      .withMessage('Refund reason is required')
      .isString()
      .isLength({ min: 5, max: 500 })
      .withMessage('Reason must be between 5 and 500 characters'),
  ],
};

// Maintenance validations
const maintenanceValidations = {
  createRequest: [
    body("rentalId")
      .notEmpty()
      .withMessage("Rental ID is required")
      .isMongoId()
      .withMessage("Invalid rental ID"),

    body("issueType")
      .notEmpty()
      .withMessage("Issue type is required")
      .isIn([
        "not_working",
        "damaged",
        "cleaning",
        "replacement",
        "installation",
        "uninstallation",
        "repair",
        "parts_replacement",
        "technical_issue",
        "electrical_issue",
        "plumbing_issue",
        "other",
      ])
      .withMessage("Invalid issue type"),

    body("description")
      .notEmpty()
      .withMessage("Description is required")
      .isString()
      .isLength({ min: 10, max: 1000 })
      .withMessage("Description must be between 10 and 1000 characters"),

    body("priority")
      .optional()
      .isIn(["low", "medium", "high", "urgent", "emergency"])
      .withMessage("Invalid priority"),

    body("scheduledDate")
      .optional()
      .isISO8601()
      .withMessage("Invalid scheduled date format")
      .custom((value) => {
        if (new Date(value) < new Date()) {
          throw new Error("Scheduled date must be in the future");
        }
        return true;
      }),

    body("attachments")
      .optional()
      .isArray()
      .withMessage("Attachments must be an array"),
  ],

  assignTechnician: [
    body("technicianId")
      .notEmpty()
      .withMessage("Technician ID is required")
      .isMongoId()
      .withMessage("Invalid technician ID"),
  ],

  scheduleVisit: [
    body("scheduledDate")
      .notEmpty()
      .withMessage("Scheduled date is required")
      .isISO8601()
      .withMessage("Invalid scheduled date format")
      .custom((value) => {
        if (new Date(value) < new Date()) {
          throw new Error("Scheduled date must be in the future");
        }
        return true;
      }),

    body("scheduledSlot")
      .optional()
      .isString()
      .withMessage("Invalid scheduled slot"),

    body("notes")
      .optional()
      .isString()
      .isLength({ max: 500 })
      .withMessage("Notes must not exceed 500 characters"),
  ],

  startWork: [
    body("findings")
      .optional()
      .isString()
      .isLength({ max: 1000 })
      .withMessage("Findings must not exceed 1000 characters"),

    body("images").optional().isArray().withMessage("Images must be an array"),
  ],

  completeWork: [
    body("resolution")
      .notEmpty()
      .withMessage("Resolution description is required")
      .isString()
      .isLength({ min: 10, max: 1000 })
      .withMessage("Resolution must be between 10 and 1000 characters"),

    body("partsUsed")
      .optional()
      .isArray()
      .withMessage("Parts used must be an array"),

    body("partsUsed.*.name")
      .if(body("partsUsed").exists())
      .notEmpty()
      .withMessage("Part name is required"),

    body("partsUsed.*.partNumber")
      .if(body("partsUsed").exists())
      .optional()
      .isString(),

    body("partsUsed.*.quantity")
      .if(body("partsUsed").exists())
      .isInt({ min: 1 })
      .withMessage("Quantity must be at least 1"),

    body("partsUsed.*.cost")
      .if(body("partsUsed").exists())
      .isFloat({ min: 0 })
      .withMessage("Cost must be a positive number"),

    body("cost.labour")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("Labour cost must be a positive number"),

    body("cost.travel")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("Travel cost must be a positive number"),

    body("images").optional().isArray(),

    body("notes").optional().isString().isLength({ max: 500 }),
  ],

  addParts: [
    body("parts")
      .isArray({ min: 1 })
      .withMessage("Parts must be a non-empty array"),

    body("parts.*.name").notEmpty().withMessage("Part name is required"),

    body("parts.*.quantity")
      .isInt({ min: 1 })
      .withMessage("Quantity must be at least 1"),

    body("parts.*.cost")
      .isFloat({ min: 0 })
      .withMessage("Cost must be a positive number"),
  ],

  addFeedback: [
    body("rating")
      .notEmpty()
      .withMessage("Rating is required")
      .isInt({ min: 1, max: 5 })
      .withMessage("Rating must be between 1 and 5"),

    body("comment")
      .optional()
      .isString()
      .isLength({ max: 500 })
      .withMessage("Comment must not exceed 500 characters"),

    body("serviceQuality").optional().isInt({ min: 1, max: 5 }),

    body("timeliness").optional().isInt({ min: 1, max: 5 }),

    body("professionalism").optional().isInt({ min: 1, max: 5 }),
  ],

  cancelRequest: [
    body("reason")
      .notEmpty()
      .withMessage("Cancellation reason is required")
      .isString()
      .isLength({ min: 5, max: 500 })
      .withMessage("Reason must be between 5 and 500 characters"),
  ],
};

// Review validations
const reviewValidations = {
  createReview: [
    body("rentalId")
      .notEmpty()
      .withMessage("Rental ID is required")
      .isMongoId()
      .withMessage("Invalid rental ID"),

    body("ratings.overall")
      .notEmpty()
      .withMessage("Overall rating is required")
      .isInt({ min: 1, max: 5 })
      .withMessage("Rating must be between 1 and 5"),

    body("ratings.product.quality").optional().isInt({ min: 1, max: 5 }),

    body("ratings.product.condition").optional().isInt({ min: 1, max: 5 }),

    body("ratings.product.valueForMoney").optional().isInt({ min: 1, max: 5 }),

    body("ratings.vendor.communication").optional().isInt({ min: 1, max: 5 }),

    body("ratings.vendor.deliveryTimeliness")
      .optional()
      .isInt({ min: 1, max: 5 }),

    body("ratings.vendor.professionalism").optional().isInt({ min: 1, max: 5 }),

    body("title")
      .notEmpty()
      .withMessage("Title is required")
      .isString()
      .isLength({ min: 3, max: 100 })
      .withMessage("Title must be between 3 and 100 characters"),

    body("content")
      .notEmpty()
      .withMessage("Review content is required")
      .isString()
      .isLength({ min: 10, max: 2000 })
      .withMessage("Content must be between 10 and 2000 characters"),

    body("pros").optional().isArray().withMessage("Pros must be an array"),

    body("pros.*").if(body("pros").exists()).isString().isLength({ max: 100 }),

    body("cons").optional().isArray().withMessage("Cons must be an array"),

    body("cons.*").if(body("cons").exists()).isString().isLength({ max: 100 }),

    body("images")
      .optional()
      .isArray()
      .withMessage("Images must be an array")
      .custom((images) => {
        if (images && images.length > 5) {
          throw new Error("Maximum 5 images allowed");
        }
        return true;
      }),
  ],

  updateReview: [
    body("ratings.overall").optional().isInt({ min: 1, max: 5 }),

    body("title").optional().isString().isLength({ min: 3, max: 100 }),

    body("content").optional().isString().isLength({ min: 10, max: 2000 }),

    body("pros").optional().isArray(),

    body("cons").optional().isArray(),

    body("images")
      .optional()
      .isArray()
      .custom((images) => {
        if (images && images.length > 5) {
          throw new Error("Maximum 5 images allowed");
        }
        return true;
      }),
  ],

  reportReview: [
    body("reason")
      .notEmpty()
      .withMessage("Report reason is required")
      .isString()
      .isLength({ min: 5, max: 500 })
      .withMessage("Reason must be between 5 and 500 characters"),
  ],

  addResponse: [
    body("content")
      .notEmpty()
      .withMessage("Response content is required")
      .isString()
      .isLength({ min: 2, max: 500 })
      .withMessage("Response must be between 2 and 500 characters"),
  ],

  moderateReview: [
    body("status")
      .notEmpty()
      .withMessage("Moderation status is required")
      .isIn(["approved", "rejected", "flagged"])
      .withMessage("Invalid moderation status"),

    body("reason")
      .if(body("status").equals("rejected"))
      .notEmpty()
      .withMessage("Rejection reason is required")
      .isString()
      .isLength({ min: 5, max: 500 }),

    body("notes").optional().isString().isLength({ max: 500 }),
  ],

  bulkModerate: [
    body("reviewIds")
      .isArray({ min: 1 })
      .withMessage("Review IDs must be a non-empty array"),

    body("reviewIds.*").isMongoId().withMessage("Invalid review ID"),

    body("status")
      .notEmpty()
      .withMessage("Moderation status is required")
      .isIn(["approved", "rejected"])
      .withMessage("Invalid moderation status"),

    body("reason")
      .if(body("status").equals("rejected"))
      .optional()
      .isString()
      .isLength({ max: 500 }),
  ],
};

const inventoryValidations = {
  createItems: [
    body('productId')
      .notEmpty()
      .withMessage('Product ID is required')
      .isMongoId()
      .withMessage('Invalid product ID'),
    
    body('quantity')
      .notEmpty()
      .withMessage('Quantity is required')
      .isInt({ min: 1, max: 1000 })
      .withMessage('Quantity must be between 1 and 1000'),
    
    body('purchaseInfo.date')
      .optional()
      .isISO8601()
      .withMessage('Invalid purchase date'),
    
    body('purchaseInfo.price')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Price must be a positive number'),
    
    body('purchaseInfo.from')
      .optional()
      .isString()
      .isLength({ max: 200 }),
    
    body('purchaseInfo.warrantyExpiry')
      .optional()
      .isISO8601()
      .withMessage('Invalid warranty expiry date'),
    
    body('location.city')
      .optional()
      .isString()
      .isLength({ max: 100 }),
    
    body('location.warehouse')
      .optional()
      .isString()
      .isLength({ max: 50 }),
  ],

  updateItem: [
    body('location.city')
      .optional()
      .isString()
      .isLength({ max: 100 }),
    
    body('location.warehouse')
      .optional()
      .isString()
      .isLength({ max: 50 }),
    
    body('location.shelf')
      .optional()
      .isString()
      .isLength({ max: 20 }),
    
    body('condition.status')
      .optional()
      .isIn(['new', 'excellent', 'good', 'fair', 'poor', 'damaged'])
      .withMessage('Invalid condition status'),
    
    body('condition.notes')
      .optional()
      .isString()
      .isLength({ max: 500 }),
    
    body('purchaseInfo.price')
      .optional()
      .isFloat({ min: 0 }),
    
    body('purchaseInfo.warrantyExpiry')
      .optional()
      .isISO8601(),
  ],

  updateStatus: [
    body('status')
      .notEmpty()
      .withMessage('Status is required')
      .isIn(['available', 'rented', 'maintenance', 'damaged', 'retired'])
      .withMessage('Invalid status'),
    
    body('reason')
      .optional()
      .isString()
      .isLength({ max: 500 }),
  ],

  transfer: [
    body('toLocation.city')
      .optional()
      .isString()
      .isLength({ max: 100 }),
    
    body('toLocation.warehouse')
      .optional()
      .isString()
      .isLength({ max: 50 }),
    
    body('toLocation.shelf')
      .optional()
      .isString()
      .isLength({ max: 20 }),
    
    body('reason')
      .optional()
      .isString()
      .isLength({ max: 500 }),
  ],

  scheduleMaintenance: [
    body('inventoryIds')
      .isArray({ min: 1 })
      .withMessage('Inventory IDs must be a non-empty array'),
    
    body('inventoryIds.*')
      .isMongoId()
      .withMessage('Invalid inventory ID'),
    
    body('scheduledDate')
      .notEmpty()
      .withMessage('Scheduled date is required')
      .isISO8601()
      .withMessage('Invalid date format')
      .custom(value => {
        if (new Date(value) < new Date()) {
          throw new Error('Scheduled date must be in the future');
        }
        return true;
      }),
    
    body('type')
      .notEmpty()
      .withMessage('Maintenance type is required')
      .isIn(['preventive', 'corrective', 'inspection', 'calibration'])
      .withMessage('Invalid maintenance type'),
    
    body('notes')
      .optional()
      .isString()
      .isLength({ max: 500 }),
  ],

  audit: [
    body('productId')
      .notEmpty()
      .withMessage('Product ID is required')
      .isMongoId()
      .withMessage('Invalid product ID'),
    
    body('expectedCount')
      .notEmpty()
      .withMessage('Expected count is required')
      .isInt({ min: 0 }),
    
    body('actualCount')
      .notEmpty()
      .withMessage('Actual count is required')
      .isInt({ min: 0 }),
    
    body('discrepancies')
      .optional()
      .isArray(),
    
    body('discrepancies.*.sku')
      .if(body('discrepancies').exists())
      .notEmpty()
      .withMessage('SKU is required for discrepancy'),
    
    body('discrepancies.*.action')
      .if(body('discrepancies').exists())
      .isIn(['mark_lost', 'update_condition', 'adjust_location'])
      .withMessage('Invalid action'),
    
    body('notes')
      .optional()
      .isString()
      .isLength({ max: 1000 }),
  ],

  bulkImport: [
    body('items')
      .isArray({ min: 1 })
      .withMessage('Items must be a non-empty array'),
    
    body('items.*.productId')
      .notEmpty()
      .withMessage('Product ID is required for each item')
      .isMongoId(),
    
    body('items.*.quantity')
      .isInt({ min: 1, max: 1000 })
      .withMessage('Quantity must be between 1 and 1000'),
  ],
};

const vendorValidations = {

  registerVendor: [
    // Personal Information
    body('firstName')
      .notEmpty()
      .withMessage('First name is required')
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('First name must be between 2 and 50 characters')
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('First name can only contain letters and spaces'),
    
    body('lastName')
      .notEmpty()
      .withMessage('Last name is required')
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Last name must be between 2 and 50 characters')
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('Last name can only contain letters and spaces'),
    
    body('email')
      .notEmpty()
      .withMessage('Email is required')
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail()
      .toLowerCase(),
    
    body('phone')
      .notEmpty()
      .withMessage('Phone number is required')
      .matches(/^[6-9]\d{9}$/)
      .withMessage('Please provide a valid Indian phone number'),
    
    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/[A-Z]/)
      .withMessage('Password must contain at least one uppercase letter')
      .matches(/[a-z]/)
      .withMessage('Password must contain at least one lowercase letter')
      .matches(/[0-9]/)
      .withMessage('Password must contain at least one number')
      .matches(/[@$!%*?&]/)
      .withMessage('Password must contain at least one special character'),
    
    body('confirmPassword')
      .notEmpty()
      .withMessage('Confirm password is required')
      .custom((value, { req }) => value === req.body.password)
      .withMessage('Passwords do not match'),
    
    // Business Information
    body('businessName')
      .notEmpty()
      .withMessage('Business name is required')
      .trim()
      .isLength({ min: 3, max: 100 })
      .withMessage('Business name must be between 3 and 100 characters'),
    
    body('businessType')
      .notEmpty()
      .withMessage('Business type is required')
      .isIn(['individual', 'partnership', 'private_limited', 'public_limited', 'llp', 'sole_proprietorship'])
      .withMessage('Invalid business type'),
    
    body('gstin')
      .optional()
      .matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/)
      .withMessage('Please provide a valid GSTIN'),
    
    body('panNumber')
      .optional()
      .matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
      .withMessage('Please provide a valid PAN number'),
    
    // Address
    body('address.addressLine1')
      .notEmpty()
      .withMessage('Address line 1 is required')
      .trim(),
    
    body('address.city')
      .notEmpty()
      .withMessage('City is required')
      .trim(),
    
    body('address.state')
      .notEmpty()
      .withMessage('State is required')
      .trim(),
    
    body('address.pincode')
      .notEmpty()
      .withMessage('Pincode is required')
      .matches(/^[1-9][0-9]{5}$/)
      .withMessage('Please provide a valid Indian pincode'),
    
    // Bank Details
    body('bankDetails.accountHolderName')
      .notEmpty()
      .withMessage('Account holder name is required')
      .trim(),
    
    body('bankDetails.accountNumber')
      .notEmpty()
      .withMessage('Account number is required')
      .isLength({ min: 9, max: 18 })
      .withMessage('Account number must be between 9 and 18 digits')
      .isNumeric()
      .withMessage('Account number must contain only numbers'),
    
    body('bankDetails.confirmAccountNumber')
      .notEmpty()
      .withMessage('Confirm account number is required')
      .custom((value, { req }) => value === req.body.bankDetails.accountNumber)
      .withMessage('Account numbers do not match'),
    
    body('bankDetails.ifscCode')
      .notEmpty()
      .withMessage('IFSC code is required')
      .matches(/^[A-Z]{4}0[A-Z0-9]{6}$/)
      .withMessage('Please provide a valid IFSC code'),
    
    body('bankDetails.bankName')
      .notEmpty()
      .withMessage('Bank name is required')
      .trim(),
    
    body('bankDetails.accountType')
      .optional()
      .isIn(['savings', 'current'])
      .withMessage('Account type must be savings or current'),
    
    // Terms & Conditions (multipart sends "true"/"false" strings)
    body('termsAccepted')
      .custom((value) => value === true || value === 'true')
      .withMessage('You must accept the terms and conditions'),

    body('dataProcessingAccepted')
      .optional()
      .custom((value) => {
        if (value === undefined || value === null || value === '') return true;
        return value === true || value === 'true' || value === false || value === 'false';
      })
      .withMessage('Invalid data processing acceptance value'),
  ],

  completeProfile: [
    body('business.description')
      .optional()
      .isString()
      .isLength({ max: 1000 })
      .withMessage('Description must not exceed 1000 characters'),
    
    body('business.website')
      .optional()
      .isURL()
      .withMessage('Please provide a valid URL'),
    
    body('contact.supportPhone')
      .optional()
      .matches(/^[6-9]\d{9}$/)
      .withMessage('Please provide a valid Indian phone number'),
    
    body('contact.supportEmail')
      .optional()
      .isEmail()
      .withMessage('Please provide a valid email'),
    
    body('addresses.serviceableCities')
      .optional()
      .isArray(),
    
    body('addresses.serviceablePincodes')
      .optional()
      .isArray(),
    
    body('settings.autoConfirmBookings')
      .optional()
      .isBoolean(),
    
    body('settings.instantBooking')
      .optional()
      .isBoolean(),
    
    body('settings.advanceNotice')
      .optional()
      .isInt({ min: 1, max: 72 }),
    
    body('settings.minRentalDuration')
      .optional()
      .isInt({ min: 1, max: 12 }),
  ],

  uploadDocuments: [
    body('documents')
      .isArray({ min: 1 })
      .withMessage('At least one document is required'),
    
    body('documents.*.type')
      .isIn(['gst_certificate', 'pan_card', 'business_registration', 'address_proof', 'bank_statement'])
      .withMessage('Invalid document type'),
    
    body('documents.*.documentNumber')
      .optional()
      .isString(),
  ],

  updateProfile: [
    body('business.name')
      .optional()
      .trim()
      .isLength({ min: 3, max: 100 })
      .withMessage('Business name must be between 3 and 100 characters'),
    
    body('business.description')
      .optional()
      .trim()
      .isLength({ max: 1000 })
      .withMessage('Description must not exceed 1000 characters'),
    
    body('business.website')
      .optional()
      .isURL()
      .withMessage('Please provide a valid URL'),
    
    body('contact.primaryPhone')
      .optional()
      .matches(/^[6-9]\d{9}$/)
      .withMessage('Please provide a valid Indian phone number'),
    
    body('contact.supportEmail')
      .optional()
      .isEmail()
      .withMessage('Please provide a valid email'),
    
    body('addresses.serviceableCities')
      .optional()
      .isArray()
      .withMessage('Serviceable cities must be an array'),
    
    body('addresses.serviceablePincodes')
      .optional()
      .isArray()
      .withMessage('Serviceable pincodes must be an array')
      .custom((pincodes) => {
        if (pincodes) {
          const pincodeRegex = /^[1-9][0-9]{5}$/;
          for (const pincode of pincodes) {
            if (!pincodeRegex.test(pincode)) {
              throw new Error(`Invalid pincode: ${pincode}`);
            }
          }
        }
        return true;
      }),
  ],

  bankDetails: [
    body('accountHolderName')
      .notEmpty()
      .withMessage('Account holder name is required')
      .trim()
      .isLength({ min: 3, max: 100 }),
    
    body('accountNumber')
      .notEmpty()
      .withMessage('Account number is required')
      .isLength({ min: 9, max: 18 })
      .withMessage('Account number must be between 9 and 18 digits')
      .isNumeric()
      .withMessage('Account number must contain only numbers'),
    
    body('confirmAccountNumber')
      .notEmpty()
      .withMessage('Please confirm account number')
      .custom((value, { req }) => value === req.body.accountNumber)
      .withMessage('Account numbers do not match'),
    
    body('ifscCode')
      .notEmpty()
      .withMessage('IFSC code is required')
      .matches(/^[A-Z]{4}0[A-Z0-9]{6}$/)
      .withMessage('Please provide a valid IFSC code'),
    
    body('bankName')
      .notEmpty()
      .withMessage('Bank name is required')
      .trim(),
    
    body('accountType')
      .optional()
      .isIn(['savings', 'current'])
      .withMessage('Account type must be savings or current'),
    
    body('upiId')
      .optional()
      .matches(/^[\w\.\-]+@[\w\-]+$/)
      .withMessage('Please provide a valid UPI ID'),
  ],

  updateSubscription: [
    body('plan')
      .notEmpty()
      .withMessage('Plan is required')
      .isIn(['basic', 'standard', 'premium', 'enterprise'])
      .withMessage('Invalid plan'),
  ],

  payoutSchedule: [
    body('schedule')
      .notEmpty()
      .withMessage('Payout schedule is required')
      .isIn(['daily', 'weekly', 'biweekly', 'monthly'])
      .withMessage('Invalid payout schedule'),
  ],

  businessHours: [
    body('businessHours')
      .isArray()
      .withMessage('Business hours must be an array'),
    
    body('businessHours.*.day')
      .notEmpty()
      .withMessage('Day is required')
      .isIn(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
    
    body('businessHours.*.isOpen')
      .isBoolean()
      .withMessage('isOpen must be a boolean'),
    
    body('businessHours.*.openTime')
      .if(body('businessHours.*.isOpen').equals('true'))
      .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
      .withMessage('Please provide a valid time in HH:MM format'),
    
    body('businessHours.*.closeTime')
      .if(body('businessHours.*.isOpen').equals('true'))
      .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
      .withMessage('Please provide a valid time in HH:MM format'),
  ],

  notificationPreferences: [
    body('email.newRentals')
      .optional()
      .isBoolean(),
    body('email.cancellations')
      .optional()
      .isBoolean(),
    body('email.maintenanceRequests')
      .optional()
      .isBoolean(),
    body('email.payments')
      .optional()
      .isBoolean(),
    body('email.dailyDigest')
      .optional()
      .isBoolean(),
  ],

  replyToReview: [
    body('reply')
      .notEmpty()
      .withMessage('Reply is required')
      .trim()
      .isLength({ min: 2, max: 500 })
      .withMessage('Reply must be between 2 and 500 characters'),
  ],

  analytics: [
    query('startDate')
      .notEmpty()
      .withMessage('Start date is required')
      .isISO8601()
      .withMessage('Invalid start date format'),
    
    query('endDate')
      .notEmpty()
      .withMessage('End date is required')
      .isISO8601()
      .withMessage('Invalid end date format')
      .custom((value, { req }) => {
        if (new Date(value) < new Date(req.query.startDate)) {
          throw new Error('End date must be after start date');
        }
        return true;
      }),
  ],

  // Admin validations
  // approveVendor: [
  //   body('commission')
  //     .optional()
  //     .isFloat({ min: 0, max: 100 })
  //     .withMessage('Commission must be between 0 and 100'),
  // ],

  rejectVendor: [
    body('reason')
      .notEmpty()
      .withMessage('Rejection reason is required')
      .trim()
      .isLength({ min: 10, max: 500 })
      .withMessage('Reason must be between 10 and 500 characters'),
  ],

  suspendVendor: [
    body('reason')
      .notEmpty()
      .withMessage('Suspension reason is required')
      .trim()
      .isLength({ min: 10, max: 500 })
      .withMessage('Reason must be between 10 and 500 characters'),
  ],

  approveVendor: [
    body('commissionRate')
      .optional()
      .isFloat({ min: 0, max: 100 })
      .withMessage('Commission rate must be between 0 and 100'),
    
    body('notes')
      .optional()
      .isString()
      .isLength({ max: 500 })
      .withMessage('Notes must not exceed 500 characters'),
    
    body('sendEmail')
      .optional()
      .isBoolean()
  ],

  rejectVendor: [
    body('reason')
      .notEmpty()
      .withMessage('Rejection reason is required')
      .isString()
      .isLength({ min: 10, max: 500 })
      .withMessage('Reason must be between 10 and 500 characters'),
    
    body('notes')
      .optional()
      .isString()
      .isLength({ max: 500 }),
    
    body('sendEmail')
      .optional()
      .isBoolean()
  ],

  suspendVendor: [
    body('reason')
      .notEmpty()
      .withMessage('Suspension reason is required')
      .isString()
      .isLength({ min: 10, max: 500 })
      .withMessage('Reason must be between 10 and 500 characters'),
    
    body('duration')
      .optional()
      .isString(),
    
    body('notes')
      .optional()
      .isString()
      .isLength({ max: 500 }),
    
    body('sendEmail')
      .optional()
      .isBoolean()
  ],

  reinstateVendor: [
    body('notes')
      .optional()
      .isString()
      .isLength({ max: 500 }),
    
    body('sendEmail')
      .optional()
      .isBoolean()
  ],

  updateCommission: [
    body('rate')
      .optional()
      .isFloat({ min: 0, max: 100 })
      .withMessage('Commission rate must be between 0 and 100'),
    
    body('type')
      .optional()
      .isIn(['percentage', 'fixed'])
      .withMessage('Commission type must be percentage or fixed'),
    
    body('fixedAmount')
      .if(body('type').equals('fixed'))
      .isFloat({ min: 0 })
      .withMessage('Fixed amount must be a positive number'),
    
    body('monthlyCap')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Monthly cap must be a positive number'),
    
    body('specialRates')
      .optional()
      .isArray()
  ],

  verifyDocument: [
    body('verified')
      .isBoolean()
      .withMessage('Verified must be a boolean'),
    
    body('remarks')
      .optional()
      .isString()
      .isLength({ max: 500 })
      .withMessage('Remarks must not exceed 500 characters')
  ]
};

const deliveryValidations = {
  createDelivery: [
    body('type')
      .notEmpty()
      .withMessage('Delivery type is required')
      .isIn(['delivery', 'pickup', 'exchange', 'return'])
      .withMessage('Invalid delivery type'),
    
    body('scheduledDate')
      .notEmpty()
      .withMessage('Scheduled date is required')
      .isISO8601()
      .withMessage('Invalid date format')
      .custom(value => {
        if (new Date(value) < new Date()) {
          throw new Error('Scheduled date must be in the future');
        }
        return true;
      }),
    
    body('scheduledSlot')
      .optional()
      .isString()
      .isIn(['Morning (9 AM - 12 PM)', 'Afternoon (12 PM - 3 PM)', 'Evening (3 PM - 6 PM)', 'Night (6 PM - 9 PM)'])
      .withMessage('Invalid time slot'),
    
    body('addressId')
      .optional()
      .isMongoId()
      .withMessage('Invalid address ID'),
    
    body('items')
      .optional()
      .isArray(),
    
    body('notes')
      .optional()
      .isString()
      .isLength({ max: 500 }),
  ],

  assignDelivery: [
    body('deliveryPersonId')
      .notEmpty()
      .withMessage('Delivery person ID is required')
      .isMongoId()
      .withMessage('Invalid delivery person ID'),
    
    body('vehicle.type')
      .optional()
      .isIn(['bike', 'car', 'van', 'truck'])
      .withMessage('Invalid vehicle type'),
    
    body('vehicle.number')
      .optional()
      .isString()
      .matches(/^[A-Z]{2}[0-9]{1,2}[A-Z]{1,2}[0-9]{4}$/)
      .withMessage('Invalid vehicle number format'),
  ],

  startDelivery: [
    body('location.lat')
      .notEmpty()
      .withMessage('Latitude is required')
      .isFloat({ min: -90, max: 90 }),
    
    body('location.lng')
      .notEmpty()
      .withMessage('Longitude is required')
      .isFloat({ min: -180, max: 180 }),
    
    body('notes')
      .optional()
      .isString()
      .isLength({ max: 200 }),
  ],

  updateLocation: [
    body('lat')
      .notEmpty()
      .withMessage('Latitude is required')
      .isFloat({ min: -90, max: 90 }),
    
    body('lng')
      .notEmpty()
      .withMessage('Longitude is required')
      .isFloat({ min: -180, max: 180 }),
  ],

  markDelivered: [
    body('signature')
      .optional()
      .isString(),
    
    body('photos')
      .optional()
      .isArray()
      .withMessage('Maximum 5 photos allowed'),
    
    body('otp')
      .optional()
      .isString()
      .isLength({ min: 4, max: 6 })
      .isNumeric()
      .withMessage('OTP must be numeric'),
    
    body('notes')
      .optional()
      .isString()
      .isLength({ max: 200 }),
  ],

  markFailed: [
    body('reason')
      .notEmpty()
      .withMessage('Failure reason is required')
      .isIn(['customer_not_available', 'wrong_address', 'damaged_item', 'vehicle_issue', 'other'])
      .withMessage('Invalid failure reason'),
    
    body('notes')
      .optional()
      .isString()
      .isLength({ max: 500 }),
    
    body('reschedule')
      .optional()
      .isObject(),
    
    body('reschedule.date')
      .if(body('reschedule').exists())
      .notEmpty()
      .isISO8601(),
    
    body('reschedule.slot')
      .if(body('reschedule').exists())
      .optional()
      .isString(),
  ],

  reschedule: [
    body('newDate')
      .notEmpty()
      .withMessage('New date is required')
      .isISO8601()
      .custom(value => {
        if (new Date(value) < new Date()) {
          throw new Error('New date must be in the future');
        }
        return true;
      }),
    
    body('newSlot')
      .optional()
      .isString(),
    
    body('reason')
      .notEmpty()
      .withMessage('Reschedule reason is required')
      .isString()
      .isLength({ min: 5, max: 500 }),
  ],
};

const searchValidations = {
  searchProducts: [
    query("q").optional().isString().trim(),

    query("page").optional().isInt({ min: 1 }).toInt(),

    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),

    query("minPrice").optional().isFloat({ min: 0 }).toFloat(),

    query("maxPrice").optional().isFloat({ min: 0 }).toFloat(),

    query("rating").optional().isFloat({ min: 0, max: 5 }).toFloat(),

    query("sort")
      .optional()
      .isIn([
        "relevance",
        "price_asc",
        "price_desc",
        "rating_desc",
        "newest",
        "popularity",
      ]),
  ],

  advancedSearch: [
    body("q").optional().isString().trim(),

    body("filters").optional().isObject(),

    body("page").optional().isInt({ min: 1 }),

    body("limit").optional().isInt({ min: 1, max: 100 }),
  ],

  searchVendors: [
    query("q").optional().isString().trim(),

    query("city").optional().isString(),

    query("rating").optional().isFloat({ min: 0, max: 5 }),

    query("verified").optional().isBoolean(),
  ],
};

const adminValidations = {
  createAdmin: [
    body('email')
      .notEmpty()
      .withMessage('Email is required')
      .isEmail()
      .withMessage('Invalid email format')
      .normalizeEmail(),
    
    body('phone')
      .notEmpty()
      .withMessage('Phone number is required')
      .matches(/^[6-9]\d{9}$/)
      .withMessage('Invalid Indian phone number'),
    
    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/[A-Z]/)
      .withMessage('Password must contain at least one uppercase letter')
      .matches(/[a-z]/)
      .withMessage('Password must contain at least one lowercase letter')
      .matches(/[0-9]/)
      .withMessage('Password must contain at least one number')
      .matches(/[@$!%*?&]/)
      .withMessage('Password must contain at least one special character'),
    
    body('profile.firstName')
      .notEmpty()
      .withMessage('First name is required')
      .isLength({ min: 2, max: 50 }),
    
    body('profile.lastName')
      .notEmpty()
      .withMessage('Last name is required')
      .isLength({ min: 2, max: 50 }),
    
    body('profile.department')
      .notEmpty()
      .withMessage('Department is required')
      .isIn(['super_admin', 'operations', 'customer_support', 'vendor_management', 'finance', 'technical', 'legal', 'hr'])
      .withMessage('Invalid department'),
    
    body('profile.designation')
      .optional()
      .isString()
      .isLength({ max: 100 }),
    
    body('profile.employeeId')
      .optional()
      .isString()
      .isLength({ max: 50 }),
    
    body('role')
      .notEmpty()
      .withMessage('Role is required')
      .isIn(['super_admin', 'admin', 'operations_manager', 'support_manager', 'finance_manager'])
      .withMessage('Invalid role'),
    
    body('permissions')
      .optional()
      .isObject()
  ],

  updateAdmin: [
    body('profile.firstName')
      .optional()
      .isLength({ min: 2, max: 50 }),
    
    body('profile.lastName')
      .optional()
      .isLength({ min: 2, max: 50 }),
    
    body('profile.department')
      .optional()
      .isIn(['super_admin', 'operations', 'customer_support', 'vendor_management', 'finance', 'technical', 'legal', 'hr']),
    
    body('profile.designation')
      .optional()
      .isString()
      .isLength({ max: 100 }),
    
    body('role')
      .optional()
      .isIn(['super_admin', 'admin', 'operations_manager', 'support_manager', 'finance_manager']),
    
    body('permissions')
      .optional()
      .isObject(),
    
    body('status.isActive')
      .optional()
      .isBoolean()
  ],
  registerAdmin: [
    body('email')
      .notEmpty()
      .withMessage('Email is required')
      .isEmail()
      .withMessage('Invalid email format')
      .normalizeEmail(),
    
    body('phone')
      .notEmpty()
      .withMessage('Phone number is required')
      .matches(/^[6-9]\d{9}$/)
      .withMessage('Please provide a valid Indian phone number'),
    
    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/[A-Z]/)
      .withMessage('Password must contain at least one uppercase letter')
      .matches(/[a-z]/)
      .withMessage('Password must contain at least one lowercase letter')
      .matches(/[0-9]/)
      .withMessage('Password must contain at least one number')
      .matches(/[@$!%*?&]/)
      .withMessage('Password must contain at least one special character'),
    
    body('profile.firstName')
      .notEmpty()
      .withMessage('First name is required')
      .isLength({ min: 2, max: 50 }),
    
    body('profile.lastName')
      .notEmpty()
      .withMessage('Last name is required')
      .isLength({ min: 2, max: 50 }),
    
    body('profile.department')
      .notEmpty()
      .withMessage('Department is required')
      .isIn(['super_admin', 'operations', 'customer_support', 'vendor_management', 'finance', 'inventory', 'marketing', 'technical', 'legal', 'hr'])
      .withMessage('Invalid department'),
    
    body('role')
      .optional()
      .isIn(['super_admin', 'admin', 'operations_manager', 'support_manager', 'vendor_manager', 'finance_manager', 'inventory_manager', 'content_manager', 'analytics_viewer', 'auditor'])
      .withMessage('Invalid role'),
  ],

  login: [
    body('email')
      .optional()
      .isEmail(),
    
    body('phone')
      .optional()
      .matches(/^[6-9]\d{9}$/),
    
    body('password')
      .notEmpty()
      .withMessage('Password is required'),
    
    body().custom((value, { req }) => {
      if (!req.body.email && !req.body.phone) {
        throw new Error('Either email or phone is required');
      }
      return true;
    }),
  ],

  verify2FA: [
    body('adminId')
      .notEmpty()
      .withMessage('Admin ID is required')
      .isMongoId()
      .withMessage('Invalid admin ID'),
    
    body('otp')
      .notEmpty()
      .withMessage('OTP is required')
      .isLength({ min: 6, max: 6 })
      .withMessage('OTP must be 6 digits')
      .isNumeric()
      .withMessage('OTP must be numeric'),
  ],

  changePassword: [
    body('currentPassword')
      .optional()
      .isString(),
    
    body('newPassword')
      .notEmpty()
      .withMessage('New password is required')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/[A-Z]/)
      .withMessage('Password must contain at least one uppercase letter')
      .matches(/[a-z]/)
      .withMessage('Password must contain at least one lowercase letter')
      .matches(/[0-9]/)
      .withMessage('Password must contain at least one number')
      .matches(/[@$!%*?&]/)
      .withMessage('Password must contain at least one special character'),
    
    body('confirmPassword')
      .notEmpty()
      .withMessage('Confirm password is required')
      .custom((value, { req }) => value === req.body.newPassword)
      .withMessage('Passwords do not match'),
  ],

  forgotPassword: [
    body('email')
      .notEmpty()
      .withMessage('Email is required')
      .isEmail()
      .withMessage('Invalid email format'),
  ],

  resetPassword: [
    body('token')
      .notEmpty()
      .withMessage('Reset token is required'),
    
    body('password')
      .notEmpty()
      .withMessage('New password is required')
      .isLength({ min: 8 }),
    
    body('confirmPassword')
      .notEmpty()
      .withMessage('Confirm password is required')
      .custom((value, { req }) => value === req.body.password)
      .withMessage('Passwords do not match'),
  ],

  logout: [
    body('refreshToken')
      .optional()
      .isString(),
  ],

  refreshToken: [
    body('refreshToken')
      .notEmpty()
      .withMessage('Refresh token is required')
      .isString(),
  ],

  updateAdminProfile: [
    body('profile.firstName')
      .optional()
      .isLength({ min: 2, max: 50 }),
    
    body('profile.lastName')
      .optional()
      .isLength({ min: 2, max: 50 }),
    
    body('profile.avatar')
      .optional()
      .isURL(),
    
    body('profile.designation')
      .optional()
      .isString()
      .isLength({ max: 100 }),
    
    body('preferences.language')
      .optional()
      .isIn(['en', 'hi', 'ta', 'te', 'kn']),
    
    body('preferences.theme')
      .optional()
      .isIn(['light', 'dark', 'system']),
    
    body('preferences.timezone')
      .optional()
      .isString(),
    
    body('preferences.notifications.email')
      .optional()
      .isBoolean(),
    
    body('preferences.notifications.push')
      .optional()
      .isBoolean(),
  ],
};


const discountValidations = {
  createDiscount: [
    body('name')
      .notEmpty()
      .withMessage('Discount name is required')
      .isString()
      .isLength({ min: 3, max: 100 })
      .withMessage('Name must be between 3 and 100 characters'),
    
    body('description')
      .optional()
      .isString()
      .isLength({ max: 500 })
      .withMessage('Description must not exceed 500 characters'),
    
    body('type')
      .notEmpty()
      .withMessage('Discount type is required')
      .isIn(['percentage', 'fixed', 'free_delivery', 'no_deposit', 'cashback', 'referral', 'festival', 'birthday', 'first_rental', 'return_customer'])
      .withMessage('Invalid discount type'),
    
    body('value')
      .if(body('type').isIn(['percentage', 'fixed', 'cashback']))
      .notEmpty()
      .withMessage('Discount value is required')
      .isFloat({ min: 0 })
      .withMessage('Value must be a positive number'),
    
    body('value')
      .if(body('type').equals('percentage'))
      .isFloat({ max: 100 })
      .withMessage('Percentage discount cannot exceed 100'),
    
    body('maxDiscountAmount')
      .if(body('type').equals('percentage'))
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Max discount amount must be a positive number'),
    
    body('minOrderValue')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Minimum order value must be a positive number'),
    
    body('code')
      .optional()
      .isString()
      .matches(/^[A-Z0-9]{4,12}$/)
      .withMessage('Discount code must be 4-12 alphanumeric characters'),
    
    body('applicableOn.type')
      .optional()
      .isIn(['all', 'category', 'product', 'vendor', 'rental_tenure', 'first_rental'])
      .withMessage('Invalid applicable type'),
    
    body('applicableOn.categoryIds')
      .if(body('applicableOn.type').equals('category'))
      .isArray({ min: 1 })
      .withMessage('Category IDs are required'),
    
    body('applicableOn.productIds')
      .if(body('applicableOn.type').equals('product'))
      .isArray({ min: 1 })
      .withMessage('Product IDs are required'),
    
    body('applicableOn.vendorIds')
      .if(body('applicableOn.type').equals('vendor'))
      .isArray({ min: 1 })
      .withMessage('Vendor IDs are required'),
    
    body('applicableOn.tenureMonths')
      .if(body('applicableOn.type').equals('rental_tenure'))
      .isArray({ min: 1 })
      .withMessage('Tenure months are required'),
    
    body('userEligibility.userType')
      .optional()
      .isIn(['all', 'new', 'existing', 'specific'])
      .withMessage('Invalid user type'),
    
    body('userEligibility.userIds')
      .if(body('userEligibility.userType').equals('specific'))
      .isArray({ min: 1 })
      .withMessage('User IDs are required'),
    
    body('userEligibility.minRentalsCompleted')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Minimum rentals must be a positive integer'),
    
    body('userEligibility.minAmountSpent')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Minimum amount spent must be a positive number'),
    
    body('usageLimits.perUser')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Per user limit must be a positive integer'),
    
    body('usageLimits.global')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Global limit must be a positive integer'),
    
    body('validity.startDate')
      .notEmpty()
      .withMessage('Start date is required')
      .isISO8601()
      .withMessage('Invalid start date format'),
    
    body('validity.endDate')
      .notEmpty()
      .withMessage('End date is required')
      .isISO8601()
      .withMessage('Invalid end date format')
      .custom((value, { req }) => {
        if (new Date(value) <= new Date(req.body.validity.startDate)) {
          throw new Error('End date must be after start date');
        }
        return true;
      }),
    
    body('stackable')
      .optional()
      .isBoolean()
      .withMessage('Stackable must be a boolean'),
    
    body('priority')
      .optional()
      .isInt({ min: 0, max: 100 })
      .withMessage('Priority must be between 0 and 100'),
    
    body('displayConditions.showOnCheckout')
      .optional()
      .isBoolean(),
    
    body('displayConditions.showOnProduct')
      .optional()
      .isBoolean(),
    
    body('displayConditions.autoApply')
      .optional()
      .isBoolean()
  ],

  updateDiscount: [
    body('name')
      .optional()
      .isString()
      .isLength({ min: 3, max: 100 }),
    
    body('description')
      .optional()
      .isString()
      .isLength({ max: 500 }),
    
    body('value')
      .optional()
      .isFloat({ min: 0 }),
    
    body('maxDiscountAmount')
      .optional()
      .isFloat({ min: 0 }),
    
    body('minOrderValue')
      .optional()
      .isFloat({ min: 0 }),
    
    body('validity.startDate')
      .optional()
      .isISO8601(),
    
    body('validity.endDate')
      .optional()
      .isISO8601(),
    
    body('status')
      .optional()
      .isIn(['active', 'inactive', 'disabled', 'expired'])
      .withMessage('Invalid status'),
    
    body('stackable')
      .optional()
      .isBoolean(),
    
    body('priority')
      .optional()
      .isInt({ min: 0, max: 100 })
  ],

  applyDiscount: [
    body('amount')
      .notEmpty()
      .withMessage('Order amount is required')
      .isFloat({ min: 0 })
      .withMessage('Amount must be a positive number'),
    
    body('productIds')
      .optional()
      .isArray()
      .withMessage('Product IDs must be an array'),
    
    body('rentalMonths')
      .optional()
      .isInt({ min: 1, max: 12 })
      .withMessage('Rental months must be between 1 and 12'),
    
    body('vendorId')
      .optional()
      .isMongoId()
      .withMessage('Invalid vendor ID'),
    
    body('rentalId')
      .optional()
      .isMongoId()
      .withMessage('Invalid rental ID')
  ],

  bulkCreate: [
    body('discounts')
      .isArray({ min: 1 })
      .withMessage('Discounts must be a non-empty array'),
    
    body('discounts.*.name')
      .notEmpty()
      .withMessage('Discount name is required for each discount'),
    
    body('discounts.*.type')
      .notEmpty()
      .withMessage('Discount type is required for each discount')
  ],

  import: [
    body('discounts')
      .isArray({ min: 1 })
      .withMessage('Discounts must be a non-empty array')
  ],

  toggleStatus: [
    body('status')
      .notEmpty()
      .withMessage('Status is required')
      .isIn(['active', 'inactive', 'disabled'])
      .withMessage('Invalid status')
  ]
};

const notificationValidations = {
  registerPushToken: [
    body('token')
      .notEmpty()
      .withMessage('Push token is required')
      .isString(),

    body('platform')
      .optional()
      .isIn(['web', 'android', 'ios'])
      .withMessage('Invalid platform'),

    body('deviceId')
      .optional()
      .isString()
      .isLength({ max: 200 })
      .withMessage('Invalid deviceId'),

    body('appVersion')
      .optional()
      .isString()
      .isLength({ max: 50 })
      .withMessage('Invalid appVersion')
  ],

  unregisterPushToken: [
    body('token')
      .notEmpty()
      .withMessage('Push token is required')
      .isString()
  ],

  broadcast: [
    body('title')
      .notEmpty()
      .withMessage('Title is required')
      .isString()
      .isLength({ min: 3, max: 200 }),
    
    body('content')
      .notEmpty()
      .withMessage('Content is required')
      .isObject(),
    
    body('content.text')
      .notEmpty()
      .withMessage('Content text is required')
      .isString(),
    
    body('type')
      .optional()
      .isIn(['in_app', 'push', 'email', 'sms'])
      .withMessage('Invalid notification type'),
    
    body('category')
      .optional()
      .isIn(['announcement', 'promotion', 'alert', 'update'])
      .withMessage('Invalid category'),
    
    body('target')
      .optional()
      .isIn(['all', 'users', 'vendors', 'specific'])
      .withMessage('Invalid target'),
    
    body('userIds')
      .if(body('target').equals('specific'))
      .isArray()
      .withMessage('User IDs must be an array'),
    
    body('priority')
      .optional()
      .isIn(['low', 'medium', 'high', 'urgent'])
      .withMessage('Invalid priority'),
    
    body('scheduledFor')
      .optional()
      .isISO8601()
      .withMessage('Invalid scheduled date')
      .custom(value => {
        if (new Date(value) < new Date()) {
          throw new Error('Scheduled date must be in the future');
        }
        return true;
      })
  ],

  updatePreferences: [
    body('notifications')
      .optional()
      .isObject()
      .withMessage('notifications must be an object'),

    body('notifications.email')
      .optional()
      .isBoolean()
      .withMessage('email must be a boolean'),

    body('notifications.sms')
      .optional()
      .isBoolean()
      .withMessage('sms must be a boolean'),

    body('notifications.push')
      .optional()
      .isBoolean()
      .withMessage('push must be a boolean')
  ]
};


const roleValidations = {
  createAdmin: [
    body('email')
      .notEmpty()
      .withMessage('Email is required')
      .isEmail()
      .withMessage('Invalid email format'),
    
    body('phone')
      .notEmpty()
      .withMessage('Phone number is required')
      .matches(/^[6-9]\d{9}$/)
      .withMessage('Invalid Indian phone number'),
    
    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
    
    body('profile.firstName')
      .notEmpty()
      .withMessage('First name is required'),
    
    body('profile.lastName')
      .notEmpty()
      .withMessage('Last name is required'),
    
    body('profile.department')
      .notEmpty()
      .withMessage('Department is required')
      .isIn(['operations', 'customer_support', 'vendor_management', 'finance', 'inventory', 'marketing', 'technical', 'legal', 'hr'])
      .withMessage('Invalid department'),
    
    body('role')
      .notEmpty()
      .withMessage('Role is required')
      .isIn(['admin', 'operations_manager', 'support_manager', 'vendor_manager', 'finance_manager', 'inventory_manager', 'content_manager', 'analytics_viewer', 'auditor'])
      .withMessage('Invalid role'),
  ],

  updateRole: [
    body('role')
      .notEmpty()
      .withMessage('Role is required')
      .isIn(['admin', 'operations_manager', 'support_manager', 'vendor_manager', 'finance_manager', 'inventory_manager', 'content_manager', 'analytics_viewer', 'auditor'])
      .withMessage('Invalid role'),
  ],

  updatePermissions: [
    body('permissions')
      .isObject()
      .withMessage('Permissions must be an object'),
  ],

  deactivateAdmin: [
    body('reason')
      .notEmpty()
      .withMessage('Deactivation reason is required')
      .isString()
      .isLength({ min: 10 })
      .withMessage('Reason must be at least 10 characters'),
  ],
};


// Support Ticket Validations
const supportTicketValidations = {
  getTicket: [
    param('ticketId')
      .isMongoId()
      .withMessage('Invalid ticket ID')
  ],

  createTicket: [
    body('type')
      .isIn(SUPPORT_TICKET_TYPES)
      .withMessage(`Type must be one of: ${SUPPORT_TICKET_TYPES.join(', ')}`),
    body('priority')
      .optional()
      .isIn(Object.values(SUPPORT_PRIORITIES))
      .withMessage('Invalid priority value'),
    body('subject')
      .notEmpty()
      .withMessage('Subject is required')
      .isLength({ min: 5, max: 200 })
      .withMessage('Subject must be between 5 and 200 characters'),
    body('description')
      .notEmpty()
      .withMessage('Description is required')
      .isLength({ min: 10, max: 5000 })
      .withMessage('Description must be between 10 and 5000 characters'),
    body('relatedTo')
      .optional()
      .isObject()
      .withMessage('Related to must be an object'),
    body('relatedTo.type')
      .optional()
      .isIn(['user', 'vendor', 'rental', 'payment', 'product'])
      .withMessage('Invalid related type'),
    body('relatedTo.id')
      .optional()
      .isMongoId()
      .withMessage('Invalid related ID'),
    body('attachments')
      .optional()
      .isArray()
      .withMessage('Attachments must be an array')
  ],

  addMessage: [
    param('ticketId')
      .isMongoId()
      .withMessage('Invalid ticket ID'),
    body('message')
      .notEmpty()
      .withMessage('Message is required')
      .isLength({ min: 1, max: 5000 })
      .withMessage('Message must be between 1 and 5000 characters'),
    body('isInternal')
      .optional()
      .isBoolean()
      .withMessage('isInternal must be a boolean')
  ],

  updateStatus: [
    param('ticketId')
      .isMongoId()
      .withMessage('Invalid ticket ID'),
    body('status')
      .isIn(Object.values(SUPPORT_STATUSES))
      .withMessage(`Status must be one of: ${Object.values(SUPPORT_STATUSES).join(', ')}`),
    body('note')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Note cannot exceed 500 characters')
  ],

  assignTicket: [
    param('ticketId')
      .isMongoId()
      .withMessage('Invalid ticket ID'),
    body('adminId')
      .isMongoId()
      .withMessage('Invalid admin ID')
  ],

  provideFeedback: [
    param('ticketId')
      .isMongoId()
      .withMessage('Invalid ticket ID'),
    body('rating')
      .isInt({ min: 1, max: 5 })
      .withMessage('Rating must be between 1 and 5'),
    body('comment')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Comment cannot exceed 500 characters')
  ],

  getTickets: [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('status')
      .optional()
      .isIn(Object.values(SUPPORT_STATUSES))
      .withMessage('Invalid status'),
    query('priority')
      .optional()
      .isIn(Object.values(SUPPORT_PRIORITIES))
      .withMessage('Invalid priority'),
    query('type')
      .optional()
      .isIn(SUPPORT_TICKET_TYPES)
      .withMessage('Invalid type')
  ]
};





module.exports = {
  validate,
  commonValidators,
  authValidations,
  userValidations,
  productValidations,
  categoryValidations,
  rentalValidations,
  paymentValidations,
  adminValidations,
  reviewValidations,
  maintenanceValidations,
  inventoryValidations,
  vendorValidations,
  deliveryValidations,
  searchValidations,
  discountValidations,
  notificationValidations,
  roleValidations,
  supportTicketValidations
};