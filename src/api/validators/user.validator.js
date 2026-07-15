// Add to your authValidations object or create a new userValidations object

const userValidations = {
  updateProfile: [
    body('profile.firstName')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('First name must be between 2 and 50 characters')
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('First name can only contain letters and spaces'),
    
    body('profile.lastName')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Last name must be between 2 and 50 characters')
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('Last name can only contain letters and spaces'),
    
    body('profile.dateOfBirth')
      .optional()
      .isISO8601()
      .withMessage('Invalid date format')
      .toDate(),
    
    body('profile.gender')
      .optional()
      .isIn(['male', 'female', 'other'])
      .withMessage('Invalid gender'),
    
    body('email')
      .optional()
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail(),
    
    body('phone')
      .optional()
      .matches(/^[6-9]\d{9}$/)
      .withMessage('Please provide a valid Indian phone number'),
  ],

  addAddress: [
    body('addressType')
      .optional()
      .isIn(['home', 'work', 'other'])
      .withMessage('Invalid address type'),
    
    body('addressLine1')
      .notEmpty()
      .withMessage('Address line 1 is required')
      .trim()
      .isLength({ min: 3, max: 100 })
      .withMessage('Address must be between 3 and 100 characters'),
    
    body('addressLine2')
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Address line 2 must not exceed 100 characters'),
    
    body('area')
      .notEmpty()
      .withMessage('Area is required')
      .trim()
      .isLength({ min: 2, max: 50 }),
    
    body('city')
      .notEmpty()
      .withMessage('City is required')
      .trim()
      .isLength({ min: 2, max: 50 }),
    
    body('state')
      .notEmpty()
      .withMessage('State is required')
      .trim()
      .isLength({ min: 2, max: 50 }),
    
    body('pincode')
      .notEmpty()
      .withMessage('Pincode is required')
      .matches(/^[1-9][0-9]{5}$/)
      .withMessage('Please provide a valid Indian pincode'),
    
    body('contactDetails.name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 }),
    
    body('contactDetails.phone')
      .notEmpty()
      .withMessage('Phone number is required')
      .matches(/^[6-9]\d{9}$/)
      .withMessage('Please provide a valid Indian phone number'),
    
    body('isDefault')
      .optional()
      .isBoolean()
      .withMessage('isDefault must be a boolean'),
  ],

  updateAddress: [
    body('addressType')
      .optional()
      .isIn(['home', 'work', 'other']),
    
    body('addressLine1')
      .optional()
      .trim()
      .isLength({ min: 3, max: 100 }),
    
    body('addressLine2')
      .optional()
      .trim()
      .isLength({ max: 100 }),
    
    body('area')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 }),
    
    body('city')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 }),
    
    body('state')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 }),
    
    body('pincode')
      .optional()
      .matches(/^[1-9][0-9]{5}$/),
    
    body('contactDetails.phone')
      .optional()
      .matches(/^[6-9]\d{9}$/),
    
    body('isDefault')
      .optional()
      .isBoolean(),
  ],

  updateNotifications: [
    body('email')
      .optional()
      .isBoolean(),
    body('sms')
      .optional()
      .isBoolean(),
    body('push')
      .optional()
      .isBoolean(),
  ],

  deleteAccount: [
    body('password')
      .notEmpty()
      .withMessage('Password is required'),
  ],

  // Admin validations
  updateRole: [
    body('role')
      .notEmpty()
      .withMessage('Role is required')
      .isIn(['user', 'vendor', 'admin', 'super-admin'])
      .withMessage('Invalid role'),
  ],

  blockUser: [
    body('reason')
      .optional()
      .isString()
      .isLength({ max: 500 })
      .withMessage('Reason must not exceed 500 characters'),
  ],
};

// Add to module.exports
module.exports = {
  validate,
  authValidations,
  userValidations,
  // ... other exports
};