const moment = require('moment');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

/**
 * General helper utilities
 */
class Helpers {
  /**
   * Generate unique ID
   */
  generateId(prefix = '') {
    const id = uuidv4().replace(/-/g, '').substring(0, 16);
    return prefix ? `${prefix}_${id}` : id;
  }

  /**
   * Generate rental number
   */
  generateRentalNumber() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `RNT${timestamp}${random}`;
  }

  /**
   * Generate order number
   */
  generateOrderNumber() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `ORD${timestamp}${random}`;
  }

  /**
   * Generate payment number
   */
  generatePaymentNumber() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `PAY${timestamp}${random}`;
  }

  /**
   * Generate invoice number
   */
  generateInvoiceNumber() {
    const date = moment().format('YYYYMMDD');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `INV${date}${random}`;
  }

  /**
   * Generate tracking number
   */
  generateTrackingNumber() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 10; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `TRK${result}`;
  }

  /**
   * Calculate rental price
   */
  calculateRentalPrice(monthlyRent, tenureMonths, discount = 0) {
    const subtotal = monthlyRent * tenureMonths;
    const discountAmount = (subtotal * discount) / 100;
    const total = subtotal - discountAmount;
    
    return {
      subtotal,
      discountAmount,
      total,
      monthlyRent,
      tenureMonths,
      discount
    };
  }

  /**
   * Calculate late fee
   */
  calculateLateFee(dailyRate, daysLate, maxFee = null) {
    const fee = dailyRate * daysLate;
    return maxFee ? Math.min(fee, maxFee) : fee;
  }

  /**
   * Calculate security deposit
   */
  calculateSecurityDeposit(monthlyRent, multiplier = 2) {
    return monthlyRent * multiplier;
  }

  /**
   * Format currency
   */
  formatCurrency(amount, currency = 'INR') {
    const formatter = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    return formatter.format(amount);
  }

  /**
   * Format date
   */
  formatDate(date, format = 'DD/MM/YYYY') {
    return moment(date).format(format);
  }

  /**
   * Format datetime
   */
  formatDateTime(date, format = 'DD/MM/YYYY HH:mm') {
    return moment(date).format(format);
  }

  /**
   * Calculate days difference
   */
  daysBetween(date1, date2) {
    const d1 = moment(date1);
    const d2 = moment(date2);
    return Math.abs(d1.diff(d2, 'days'));
  }

  /**
   * Calculate months difference
   */
  monthsBetween(date1, date2) {
    const d1 = moment(date1);
    const d2 = moment(date2);
    return Math.abs(d1.diff(d2, 'months'));
  }

  /**
   * Add months to date
   */
  addMonths(date, months) {
    return moment(date).add(months, 'months').toDate();
  }

  /**
   * Get start of day
   */
  startOfDay(date = new Date()) {
    return moment(date).startOf('day').toDate();
  }

  /**
   * Get end of day
   */
  endOfDay(date = new Date()) {
    return moment(date).endOf('day').toDate();
  }

  /**
   * Check if date is between two dates
   */
  isDateBetween(date, startDate, endDate, inclusive = true) {
    const d = moment(date);
    const start = moment(startDate);
    const end = moment(endDate);
    
    if (inclusive) {
      return d.isSameOrAfter(start) && d.isSameOrBefore(end);
    }
    return d.isAfter(start) && d.isBefore(end);
  }

  /**
   * Paginate array
   */
  paginateArray(array, page = 1, limit = 10) {
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    
    return {
      data: array.slice(startIndex, endIndex),
      pagination: {
        page,
        limit,
        total: array.length,
        totalPages: Math.ceil(array.length / limit),
        hasNext: endIndex < array.length,
        hasPrev: startIndex > 0,
      },
    };
  }

  /**
   * Group array by key
   */
  groupBy(array, key) {
    return array.reduce((result, item) => {
      const groupKey = item[key];
      if (!result[groupKey]) {
        result[groupKey] = [];
      }
      result[groupKey].push(item);
      return result;
    }, {});
  }

  /**
   * Sort array by key
   */
  sortBy(array, key, order = 'asc') {
    return [...array].sort((a, b) => {
      if (order === 'asc') {
        return a[key] > b[key] ? 1 : -1;
      }
      return a[key] < b[key] ? 1 : -1;
    });
  }

  /**
   * Unique array
   */
  unique(array) {
    return [...new Set(array)];
  }

  /**
   * Chunk array
   */
  chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Flatten array
   */
  flatten(array) {
    return array.reduce((flat, item) => {
      return flat.concat(Array.isArray(item) ? this.flatten(item) : item);
    }, []);
  }

  /**
   * Deep clone object
   */
  deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Merge objects deeply
   */
  deepMerge(target, source) {
    const output = { ...target };
    
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    
    return output;
  }

  /**
   * Check if value is object
   */
  isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * Pick specific keys from object
   */
  pick(obj, keys) {
    return keys.reduce((result, key) => {
      if (obj.hasOwnProperty(key)) {
        result[key] = obj[key];
      }
      return result;
    }, {});
  }

  /**
   * Omit specific keys from object
   */
  omit(obj, keys) {
    return Object.keys(obj).reduce((result, key) => {
      if (!keys.includes(key)) {
        result[key] = obj[key];
      }
      return result;
    }, {});
  }

  /**
   * Convert object to query string
   */
  toQueryString(params) {
    return Object.keys(params)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
  }

  /**
   * Parse query string to object
   */
  parseQueryString(queryString) {
    const params = new URLSearchParams(queryString);
    const result = {};
    
    for (const [key, value] of params) {
      result[key] = value;
    }
    
    return result;
  }

  /**
   * Generate slug from string
   */
  slugify(text) {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-') // Replace spaces with -
      .replace(/[^\w\-]+/g, '') // Remove non-word chars
      .replace(/\-\-+/g, '-') // Replace multiple - with single -
      .replace(/^-+/, '') // Trim - from start
      .replace(/-+$/, ''); // Trim - from end
  }

  /**
   * Truncate text
   */
  truncate(text, length = 100, suffix = '...') {
    if (text.length <= length) return text;
    return text.substring(0, length - suffix.length) + suffix;
  }

  /**
   * Capitalize first letter
   */
  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  /**
   * Title case
   */
  titleCase(str) {
    return str.replace(/\w\S*/g, txt => 
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
  }

  /**
   * Mask email
   */
  maskEmail(email) {
    const [name, domain] = email.split('@');
    const maskedName = name.charAt(0) + '*'.repeat(name.length - 2) + name.charAt(name.length - 1);
    return `${maskedName}@${domain}`;
  }

  /**
   * Mask phone
   */
  maskPhone(phone) {
    return phone.slice(0, 2) + '*'.repeat(phone.length - 4) + phone.slice(-2);
  }

  /**
   * Validate email
   */
  isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  /**
   * Validate phone (Indian)
   */
  isValidIndianPhone(phone) {
    const re = /^[6-9]\d{9}$/;
    return re.test(phone);
  }

  /**
   * Validate pincode (Indian)
   */
  isValidIndianPincode(pincode) {
    const re = /^[1-9][0-9]{5}$/;
    return re.test(pincode);
  }

  /**
   * Validate PAN (Indian)
   */
  isValidIndianPAN(pan) {
    const re = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    return re.test(pan);
  }

  /**
   * Validate GST (Indian)
   */
  isValidIndianGST(gst) {
    const re = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/;
    return re.test(gst);
  }

  /**
   * Validate Aadhar (Indian)
   */
  isValidIndianAadhar(aadhar) {
    const re = /^[2-9]{1}[0-9]{3}[0-9]{4}[0-9]{4}$/;
    return re.test(aadhar);
  }

  /**
   * Sleep for ms
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Retry function
   */
  async retry(fn, maxAttempts = 3, delay = 1000) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === maxAttempts - 1) throw error;
        await this.sleep(delay * Math.pow(2, i)); // Exponential backoff
      }
    }
  }

  /**
   * Debounce function
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * Throttle function
   */
  throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  }

  /**
   * Parse CSV string to array
   */
  parseCSV(csvString) {
    const lines = csvString.trim().split('\n');
    const headers = lines[0].split(',');
    
    return lines.slice(1).map(line => {
      const values = line.split(',');
      return headers.reduce((obj, header, index) => {
        obj[header.trim()] = values[index].trim();
        return obj;
      }, {});
    });
  }

  /**
   * Convert array to CSV
   */
  toCSV(data) {
    if (!data.length) return '';
    
    const headers = Object.keys(data[0]);
    const csvRows = [];
    
    csvRows.push(headers.join(','));
    
    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header]?.toString() || '';
        return value.includes(',') ? `"${value}"` : value;
      });
      csvRows.push(values.join(','));
    }
    
    return csvRows.join('\n');
  }

  /**
   * Extract numbers from string
   */
  extractNumbers(str) {
    return str.match(/\d+/g)?.map(Number) || [];
  }

  /**
   * Generate random color
   */
  randomColor() {
    return '#' + Math.floor(Math.random()*16777215).toString(16);
  }

  /**
   * Get file extension
   */
  getFileExtension(filename) {
    return filename.slice((filename.lastIndexOf('.') - 1 >>> 0) + 2);
  }

  /**
   * Format file size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

module.exports = new Helpers();