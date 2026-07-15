/**
 * Validation utilities
 */
class Validators {
  /**
   * Check if value is email
   */
  isEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  /**
   * Check if value is phone number (Indian)
   */
  isIndianPhone(phone) {
    const re = /^[6-9]\d{9}$/;
    return re.test(phone);
  }

  /**
   * Check if value is pincode (Indian)
   */
  isIndianPincode(pincode) {
    const re = /^[1-9][0-9]{5}$/;
    return re.test(pincode);
  }

  /**
   * Check if value is PAN (Indian)
   */
  isIndianPAN(pan) {
    const re = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    return re.test(pan);
  }

  /**
   * Check if value is GST (Indian)
   */
  isIndianGST(gst) {
    const re = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/;
    return re.test(gst);
  }

  /**
   * Check if value is Aadhar (Indian)
   */
  isIndianAadhar(aadhar) {
    const re = /^[2-9]{1}[0-9]{3}[0-9]{4}[0-9]{4}$/;
    return re.test(aadhar);
  }

  /**
   * Check if value is URL
   */
  isURL(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if value is strong password
   */
  isStrongPassword(password) {
    const checks = {
      minLength: password.length >= 8,
      hasUpperCase: /[A-Z]/.test(password),
      hasLowerCase: /[a-z]/.test(password),
      hasNumbers: /\d/.test(password),
      hasSpecialChar: /[@$!%*?&]/.test(password),
    };

    return {
      isValid: Object.values(checks).every(Boolean),
      checks,
    };
  }

  /**
   * Check if value is valid date
   */
  isDate(value) {
    const date = new Date(value);
    return date instanceof Date && !isNaN(date);
  }

  /**
   * Check if date is in future
   */
  isFutureDate(date) {
    return this.isDate(date) && new Date(date) > new Date();
  }

  /**
   * Check if date is in past
   */
  isPastDate(date) {
    return this.isDate(date) && new Date(date) < new Date();
  }

  /**
   * Check if value is valid MongoDB ObjectId
   */
  isObjectId(id) {
    const mongoose = require('mongoose');
    return mongoose.Types.ObjectId.isValid(id);
  }

  /**
   * Check if value is valid UUID
   */
  isUUID(uuid) {
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return re.test(uuid);
  }

  /**
   * Check if value is valid JSON
   */
  isJSON(str) {
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if value is valid IP address
   */
  isIP(ip) {
    const ipv4Re = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6Re = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
    
    return ipv4Re.test(ip) || ipv6Re.test(ip);
  }

  /**
   * Check if value is valid credit card number
   */
  isCreditCard(number) {
    // Luhn algorithm
    const str = number.toString().replace(/\s/g, '');
    let sum = 0;
    let shouldDouble = false;

    for (let i = str.length - 1; i >= 0; i--) {
      let digit = parseInt(str.charAt(i));

      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }

      sum += digit;
      shouldDouble = !shouldDouble;
    }

    return sum % 10 === 0;
  }

  /**
   * Check if value is valid CVV
   */
  isCVV(cvv) {
    const re = /^[0-9]{3,4}$/;
    return re.test(cvv);
  }

  /**
   * Check if value is valid IFSC code (Indian)
   */
  isIFSC(ifsc) {
    const re = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    return re.test(ifsc);
  }

  /**
   * Check if value is valid vehicle number (Indian)
   */
  isIndianVehicleNumber(number) {
    const re = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,2}[0-9]{4}$/;
    return re.test(number.replace(/\s/g, ''));
  }

  /**
   * Validate required fields
   */
  validateRequired(obj, fields) {
    const missing = [];
    const invalid = [];

    fields.forEach(field => {
      const value = obj[field];
      if (value === undefined || value === null || value === '') {
        missing.push(field);
      }
    });

    return {
      isValid: missing.length === 0,
      missing,
      invalid,
    };
  }

  /**
   * Validate object against schema
   */
  validateSchema(obj, schema) {
    const errors = {};

    Object.entries(schema).forEach(([field, rules]) => {
      const value = obj[field];
      
      // Required check
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors[field] = `${field} is required`;
        return;
      }

      // Skip further validation if value is not provided and not required
      if (value === undefined || value === null) {
        return;
      }

      // Type check
      if (rules.type) {
        const typeValid = this.checkType(value, rules.type);
        if (!typeValid) {
          errors[field] = `${field} must be of type ${rules.type}`;
          return;
        }
      }

      // Min length check
      if (rules.minLength && value.length < rules.minLength) {
        errors[field] = `${field} must be at least ${rules.minLength} characters`;
        return;
      }

      // Max length check
      if (rules.maxLength && value.length > rules.maxLength) {
        errors[field] = `${field} must not exceed ${rules.maxLength} characters`;
        return;
      }

      // Min value check
      if (rules.min !== undefined && value < rules.min) {
        errors[field] = `${field} must be at least ${rules.min}`;
        return;
      }

      // Max value check
      if (rules.max !== undefined && value > rules.max) {
        errors[field] = `${field} must not exceed ${rules.max}`;
        return;
      }

      // Pattern check
      if (rules.pattern && !rules.pattern.test(value)) {
        errors[field] = `${field} has invalid format`;
        return;
      }

      // Enum check
      if (rules.enum && !rules.enum.includes(value)) {
        errors[field] = `${field} must be one of: ${rules.enum.join(', ')}`;
        return;
      }

      // Custom validator
      if (rules.validate && typeof rules.validate === 'function') {
        const customError = rules.validate(value, obj);
        if (customError) {
          errors[field] = customError;
        }
      }
    });

    return {
      isValid: Object.keys(errors).length === 0,
      errors,
    };
  }

  /**
   * Check value type
   */
  checkType(value, type) {
    switch (type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && !Array.isArray(value) && value !== null;
      case 'date':
        return this.isDate(value);
      case 'email':
        return this.isEmail(value);
      case 'phone':
        return this.isIndianPhone(value);
      default:
        return true;
    }
  }

  /**
   * Sanitize input
   */
  sanitize(input) {
    if (typeof input !== 'string') return input;

    // Remove HTML tags
    let sanitized = input.replace(/<[^>]*>/g, '');

    // Remove script tags content
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    // Escape special characters
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');

    // Trim whitespace
    sanitized = sanitized.trim();

    return sanitized;
  }

  /**
   * Validate pagination parameters
   */
  validatePagination(page, limit) {
    const errors = [];

    if (page !== undefined) {
      const pageNum = parseInt(page);
      if (isNaN(pageNum) || pageNum < 1) {
        errors.push('Page must be a positive integer');
      }
    }

    if (limit !== undefined) {
      const limitNum = parseInt(limit);
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        errors.push('Limit must be between 1 and 100');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate date range
   */
  validateDateRange(startDate, endDate) {
    const errors = [];

    if (startDate && !this.isDate(startDate)) {
      errors.push('Invalid start date');
    }

    if (endDate && !this.isDate(endDate)) {
      errors.push('Invalid end date');
    }

    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      errors.push('Start date must be before end date');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate coordinates
   */
  validateCoordinates(latitude, longitude) {
    const errors = [];

    if (latitude !== undefined) {
      const lat = parseFloat(latitude);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        errors.push('Latitude must be between -90 and 90');
      }
    }

    if (longitude !== undefined) {
      const lng = parseFloat(longitude);
      if (isNaN(lng) || lng < -180 || lng > 180) {
        errors.push('Longitude must be between -180 and 180');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate rental dates
   */
  validateRentalDates(startDate, endDate, minMonths = 3, maxMonths = 12) {
    const errors = [];

    if (!this.isDate(startDate)) {
      errors.push('Invalid start date');
    }

    if (!this.isDate(endDate)) {
      errors.push('Invalid end date');
    }

    if (this.isDate(startDate) && this.isDate(endDate)) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      if (start < new Date()) {
        errors.push('Start date must be in future');
      }

      const monthsDiff = (end - start) / (1000 * 60 * 60 * 24 * 30);
      
      if (monthsDiff < minMonths) {
        errors.push(`Minimum rental period is ${minMonths} months`);
      }

      if (monthsDiff > maxMonths) {
        errors.push(`Maximum rental period is ${maxMonths} months`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate file
   */
  validateFile(file, allowedTypes, maxSize) {
    const errors = [];

    if (!file) {
      errors.push('No file provided');
      return { isValid: false, errors };
    }

    if (!allowedTypes.includes(file.mimetype)) {
      errors.push(`File type not allowed. Allowed: ${allowedTypes.join(', ')}`);
    }

    if (file.size > maxSize) {
      errors.push(`File size exceeds ${maxSize / (1024 * 1024)}MB`);
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate files array
   */
  validateFiles(files, allowedTypes, maxSize, maxCount) {
    const errors = [];

    if (!files || files.length === 0) {
      errors.push('No files provided');
      return { isValid: false, errors };
    }

    if (files.length > maxCount) {
      errors.push(`Too many files. Maximum: ${maxCount}`);
    }

    files.forEach((file, index) => {
      if (!allowedTypes.includes(file.mimetype)) {
        errors.push(`File ${index + 1}: Type not allowed`);
      }

      if (file.size > maxSize) {
        errors.push(`File ${index + 1}: Size exceeds ${maxSize / (1024 * 1024)}MB`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

module.exports = new Validators();