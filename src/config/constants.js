// ====================================
// APPLICATION CONSTANTS
// ====================================

module.exports = {
  // App Information
  APP: {
    NAME: 'RentEase',
    VERSION: '1.0.0',
    DESCRIPTION: 'Furniture & Appliance Rental Platform',
    WEBSITE: 'https://rentease.com',
    SUPPORT_EMAIL: 'support@rentease.com',
    SUPPORT_PHONE: '+91-XXXXXXXXXX',
  },

  // User Roles
  USER_ROLES: {
    USER: 'user',
    VENDOR: 'vendor',
    ADMIN: 'admin',
    SUPER_ADMIN: 'super-admin',
  },

  // User Status
  USER_STATUS: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    BLOCKED: 'blocked',
    SUSPENDED: 'suspended',
    PENDING: 'pending',
  },

  // Verification Status
  VERIFICATION_STATUS: {
    PENDING: 'pending',
    VERIFIED: 'verified',
    REJECTED: 'rejected',
    EXPIRED: 'expired',
  },

  // Product Status
  PRODUCT_STATUS: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    OUT_OF_STOCK: 'out_of_stock',
    DISCONTINUED: 'discontinued',
    PENDING_APPROVAL: 'pending_approval',
    REJECTED: 'rejected',
  },

  // Product Condition
  PRODUCT_CONDITION: {
    NEW: 'new',
    LIKE_NEW: 'like-new',
    GOOD: 'good',
    FAIR: 'fair',
    REFURBISHED: 'refurbished',
  },

  // Rental Status
  RENTAL_STATUS: {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    READY_FOR_DELIVERY: 'ready_for_delivery',
    OUT_FOR_DELIVERY: 'out_for_delivery',
    DELIVERED: 'delivered',
    ACTIVE: 'active',
    EXTENSION_REQUESTED: 'extension_requested',
    RETURN_INITIATED: 'return_initiated',
    OUT_FOR_PICKUP: 'out_for_pickup',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    OVERDUE: 'overdue',
    DISPUTED: 'disputed',
  },

  // Payment Status
  PAYMENT_STATUS: {
    PENDING: 'pending',
    PROCESSING: 'processing',
    SUCCESS: 'success',
    FAILED: 'failed',
    REFUNDED: 'refunded',
    CANCELLED: 'cancelled',
    PARTIAL: 'partial',
  },

  // Payment Methods
  PAYMENT_METHODS: {
    CREDIT_CARD: 'credit_card',
    DEBIT_CARD: 'debit_card',
    UPI: 'upi',
    NET_BANKING: 'net_banking',
    WALLET: 'wallet',
    CASH: 'cash',
    BANK_TRANSFER: 'bank_transfer',
  },

  // Payment Types
  PAYMENT_TYPES: {
    SECURITY_DEPOSIT: 'security_deposit',
    RENT: 'rent',
    DELIVERY: 'delivery',
    LATE_FEE: 'late_fee',
    DAMAGE_CHARGE: 'damage_charge',
    EXTENSION: 'extension',
    REFUND: 'refund',
  },

  // Delivery Status
  DELIVERY_STATUS: {
    SCHEDULED: 'scheduled',
    ASSIGNED: 'assigned',
    OUT_FOR_DELIVERY: 'out_for_delivery',
    IN_TRANSIT: 'in_transit',
    REACHED: 'reached',
    DELIVERED: 'delivered',
    PICKED_UP: 'picked_up',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    RESCHEDULED: 'rescheduled',
    RETURNED_TO_WAREHOUSE: 'returned_to_warehouse',
  },

  // Delivery Types
  DELIVERY_TYPES: {
    DELIVERY: 'delivery',
    PICKUP: 'pickup',
    EXCHANGE: 'exchange',
    RETURN: 'return',
    MAINTENANCE: 'maintenance',
  },

  // Maintenance Status
  MAINTENANCE_STATUS: {
    PENDING: 'pending',
    ASSIGNED: 'assigned',
    SCHEDULED: 'scheduled',
    IN_PROGRESS: 'in_progress',
    ON_HOLD: 'on_hold',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    REJECTED: 'rejected',
    ESCALATED: 'escalated',
  },

  // Maintenance Priority
  MAINTENANCE_PRIORITY: {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    URGENT: 'urgent',
    EMERGENCY: 'emergency',
  },

  // Issue Types
  ISSUE_TYPES: {
    NOT_WORKING: 'not_working',
    DAMAGED: 'damaged',
    CLEANING: 'cleaning',
    REPLACEMENT: 'replacement',
    INSTALLATION: 'installation',
    UNINSTALLATION: 'uninstallation',
    REPAIR: 'repair',
    PARTS_REPLACEMENT: 'parts_replacement',
    TECHNICAL_ISSUE: 'technical_issue',
    ELECTRICAL_ISSUE: 'electrical_issue',
    PLUMBING_ISSUE: 'plumbing_issue',
    OTHER: 'other',
  },

  // Notification Types
  NOTIFICATION_TYPES: {
    EMAIL: 'email',
    SMS: 'sms',
    PUSH: 'push',
    IN_APP: 'in_app',
    WHATSAPP: 'whatsapp',
  },

  // Notification Categories
  NOTIFICATION_CATEGORIES: {
    TRANSACTIONAL: 'transactional',
    PROMOTIONAL: 'promotional',
    ALERT: 'alert',
    REMINDER: 'reminder',
    UPDATE: 'update',
    SECURITY: 'security',
    MARKETING: 'marketing',
    SYSTEM: 'system',
  },

  // Discount Types
  DISCOUNT_TYPES: {
    PERCENTAGE: 'percentage',
    FIXED: 'fixed',
    FREE_DELIVERY: 'free_delivery',
    NO_DEPOSIT: 'no_deposit',
    CASHBACK: 'cashback',
    REFERRAL: 'referral',
    FESTIVAL: 'festival',
    BIRTHDAY: 'birthday',
    FIRST_RENTAL: 'first_rental',
    RETURN_CUSTOMER: 'return_customer',
  },

  // Discount Applicability
  DISCOUNT_APPLICABLE_ON: {
    ALL: 'all',
    CATEGORY: 'category',
    PRODUCT: 'product',
    VENDOR: 'vendor',
    RENTAL_TENURE: 'rental_tenure',
    FIRST_RENTAL: 'first_rental',
  },

  // Vendor Subscription Plans
  VENDOR_PLANS: {
    BASIC: 'basic',
    STANDARD: 'standard',
    PREMIUM: 'premium',
    ENTERPRISE: 'enterprise',
  },

  // Vendor Departments
  VENDOR_DEPARTMENTS: {
    SUPER_ADMIN: 'super_admin',
    OPERATIONS: 'operations',
    CUSTOMER_SUPPORT: 'customer_support',
    VENDOR_MANAGEMENT: 'vendor_management',
    FINANCE: 'finance',
    INVENTORY: 'inventory',
    MARKETING: 'marketing',
    TECHNICAL: 'technical',
    LEGAL: 'legal',
    HR: 'hr',
  },

  // Admin Roles
  ADMIN_ROLES: {
    SUPER_ADMIN: 'super_admin',
    ADMIN: 'admin',
    OPERATIONS_MANAGER: 'operations_manager',
    SUPPORT_MANAGER: 'support_manager',
    VENDOR_MANAGER: 'vendor_manager',
    FINANCE_MANAGER: 'finance_manager',
    INVENTORY_MANAGER: 'inventory_manager',
    CONTENT_MANAGER: 'content_manager',
    ANALYTICS_VIEWER: 'analytics_viewer',
    AUDITOR: 'auditor',
  },

  // Address Types
  ADDRESS_TYPES: {
    HOME: 'home',
    WORK: 'work',
    OTHER: 'other',
    WAREHOUSE: 'warehouse',
    REGISTERED_OFFICE: 'registered_office',
  },

  // Rental Tenure Options (in months)
  RENTAL_TENURE_OPTIONS: [3, 6, 9, 12],

  // Pagination Defaults
  PAGINATION: {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 10,
    MAX_LIMIT: 100,
  },

  // Cache TTL (in seconds)
  CACHE_TTL: {
    PRODUCT: 600, // 10 minutes
    CATEGORY: 3600, // 1 hour
    USER: 300, // 5 minutes
    LIST: 300, // 5 minutes
    SEARCH: 180, // 3 minutes
    STATIC: 86400, // 24 hours
  },

  // File Upload Limits (in bytes)
  UPLOAD_LIMITS: {
    IMAGE: 5 * 1024 * 1024, // 5MB
    DOCUMENT: 10 * 1024 * 1024, // 10MB
    VIDEO: 50 * 1024 * 1024, // 50MB
    MAX_IMAGES_PER_PRODUCT: 10,
    MAX_DOCUMENTS_PER_KYC: 5,
  },

  // Allowed File Types
  ALLOWED_FILE_TYPES: {
    IMAGES: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    DOCUMENTS: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    VIDEOS: ['video/mp4', 'video/mov', 'video/avi', 'video/webm'],
  },

  // OTP Configuration
  OTP: {
    LENGTH: 6,
    EXPIRY: 300, // 5 minutes in seconds
    MAX_ATTEMPTS: 3,
    RESEND_INTERVAL: 60, // 1 minute in seconds
  },

  // JWT Configuration
  JWT: {
    ACCESS_EXPIRY: '15m',
    REFRESH_EXPIRY: '7d',
    RESET_PASSWORD_EXPIRY: '10m',
    VERIFY_EMAIL_EXPIRY: '24h',
  },

  // Rate Limiting
  RATE_LIMITS: {
    API: { windowMs: 15 * 60 * 1000, max: 100 }, // 15 minutes, 100 requests
    AUTH: { windowMs: 60 * 60 * 1000, max: 10 }, // 1 hour, 10 attempts
    OTP: { windowMs: 15 * 60 * 1000, max: 5 }, // 15 minutes, 5 requests
    PAYMENT: { windowMs: 60 * 60 * 1000, max: 20 }, // 1 hour, 20 attempts
    ADMIN: { windowMs: 15 * 60 * 1000, max: 200 }, // 15 minutes, 200 requests
  },

  // Business Rules
  BUSINESS_RULES: {
    MIN_RENTAL_MONTHS: 3,
    MAX_RENTAL_MONTHS: 12,
    DEFAULT_COMMISSION_RATE: 10, // percentage
    LATE_FEE_PER_DAY: 100, // in rupees
    CANCELLATION_CHARGE_PERCENTAGE: {
      LESS_THAN_2_DAYS: 50,
      LESS_THAN_7_DAYS: 25,
      MORE_THAN_7_DAYS: 0,
    },
    SECURITY_DEPOSIT_MULTIPLIER: 2, // 2 months rent
  },

  // API Endpoints
  API_ENDPOINTS: {
    V1: '/api/v1',
    V2: '/api/v2',
    HEALTH: '/health',
    DOCS: '/api-docs',
  },

  // HTTP Status Codes
  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    SERVICE_UNAVAILABLE: 503,
  },

  // Response Messages
  MESSAGES: {
    SUCCESS: 'Success',
    CREATED: 'Resource created successfully',
    UPDATED: 'Resource updated successfully',
    DELETED: 'Resource deleted successfully',
    NOT_FOUND: 'Resource not found',
    UNAUTHORIZED: 'Unauthorized access',
    FORBIDDEN: 'Access forbidden',
    VALIDATION_ERROR: 'Validation error',
    SERVER_ERROR: 'Internal server error',
    TOO_MANY_REQUESTS: 'Too many requests, please try again later',
    INVALID_CREDENTIALS: 'Invalid email or password',
    ACCOUNT_LOCKED: 'Account locked due to too many failed attempts',
    EMAIL_EXISTS: 'Email already exists',
    PHONE_EXISTS: 'Phone number already exists',
    OTP_SENT: 'OTP sent successfully',
    OTP_VERIFIED: 'OTP verified successfully',
    OTP_EXPIRED: 'OTP has expired',
    OTP_INVALID: 'Invalid OTP',
    PASSWORD_CHANGED: 'Password changed successfully',
    PASSWORD_RESET: 'Password reset successfully',
    PROFILE_UPDATED: 'Profile updated successfully',
    RENTAL_CREATED: 'Rental created successfully',
    RENTAL_CONFIRMED: 'Rental confirmed successfully',
    RENTAL_CANCELLED: 'Rental cancelled successfully',
    PAYMENT_SUCCESS: 'Payment processed successfully',
    PAYMENT_FAILED: 'Payment failed',
    REFUND_INITIATED: 'Refund initiated successfully',
    DELIVERY_SCHEDULED: 'Delivery scheduled successfully',
    MAINTENANCE_REQUESTED: 'Maintenance request submitted',
    REVIEW_SUBMITTED: 'Review submitted successfully',
    VENDOR_APPROVED: 'Vendor approved successfully',
    VENDOR_REJECTED: 'Vendor rejected',
  },

  // Timezones
  TIMEZONES: {
    DEFAULT: 'Asia/Kolkata',
    SUPPORTED: ['Asia/Kolkata', 'UTC', 'America/New_York', 'Europe/London'],
  },

  // Languages
  LANGUAGES: {
    DEFAULT: 'en',
    SUPPORTED: ['en', 'hi', 'ta', 'te', 'kn', 'ml', 'bn', 'gu', 'mr'],
  },

  // Currencies
  CURRENCY: {
    DEFAULT: 'INR',
    SYMBOL: '₹',
    CODE: 'INR',
  },

  // Date Formats
  DATE_FORMATS: {
    DEFAULT: 'DD/MM/YYYY',
    ISO: 'YYYY-MM-DD',
    DISPLAY: 'MMM DD, YYYY',
    DATETIME: 'MMM DD, YYYY hh:mm A',
    API: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
  },

  // Sorting Options
  SORT_OPTIONS: {
    PRICE_ASC: 'price_asc',
    PRICE_DESC: 'price_desc',
    NEWEST: 'newest',
    OLDEST: 'oldest',
    POPULARITY: 'popularity',
    RATING: 'rating',
  },

  // Filter Operators
  FILTER_OPERATORS: {
    EQ: 'eq',
    NE: 'ne',
    GT: 'gt',
    GTE: 'gte',
    LT: 'lt',
    LTE: 'lte',
    IN: 'in',
    NIN: 'nin',
    LIKE: 'like',
    BETWEEN: 'between',
  },

  // Audit Log Actions
  AUDIT_ACTIONS: {
    CREATE: 'CREATE',
    READ: 'READ',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
    LOGIN: 'LOGIN',
    LOGOUT: 'LOGOUT',
    LOGIN_FAILED: 'LOGIN_FAILED',
    PASSWORD_CHANGE: 'PASSWORD_CHANGE',
    PASSWORD_RESET: 'PASSWORD_RESET',
    EMAIL_VERIFY: 'EMAIL_VERIFY',
    PHONE_VERIFY: 'PHONE_VERIFY',
    KYC_SUBMIT: 'KYC_SUBMIT',
    KYC_APPROVE: 'KYC_APPROVE',
    KYC_REJECT: 'KYC_REJECT',
    ROLE_CHANGE: 'ROLE_CHANGE',
    STATUS_CHANGE: 'STATUS_CHANGE',
    PAYMENT_INIT: 'PAYMENT_INIT',
    PAYMENT_SUCCESS: 'PAYMENT_SUCCESS',
    PAYMENT_FAIL: 'PAYMENT_FAIL',
    PAYMENT_REFUND: 'PAYMENT_REFUND',
  },

    // Support Ticket Types
  SUPPORT_TICKET_TYPES: [
    'user_issue',
    'vendor_issue',
    'rental_dispute',
    'payment_dispute',
    'technical_issue',
    'content_moderation',
    'account_issue',
    'feature_request',
    'complaint',
    'other'
  ],

  // Ticket Priorities
  SUPPORT_PRIORITIES: {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    URGENT: 'urgent',
    CRITICAL: 'critical'
  },

  // Ticket Statuses
  SUPPORT_STATUSES: {
    OPEN: 'open',
    ASSIGNED: 'assigned',
    IN_PROGRESS: 'in_progress',
    PENDING: 'pending',
    RESOLVED: 'resolved',
    CLOSED: 'closed',
    REOPENED: 'reopened',
    ESCALATED: 'escalated'
  },

  // Sender Types
  SENDER_TYPES: {
    USER: 'user',
    ADMIN: 'admin',
    SYSTEM: 'system'
  },

  // Related Types
  RELATED_TYPES: {
    USER: 'user',
    VENDOR: 'vendor',
    RENTAL: 'rental',
    PAYMENT: 'payment',
    PRODUCT: 'product'
  },

  // Source Types
  SOURCE_TYPES: {
    WEB: 'web',
    MOBILE: 'mobile',
    EMAIL: 'email',
    PHONE: 'phone',
    CHAT: 'chat'
  },

  // SLA Hours by Priority
  SLA_HOURS: {
    critical: { response: 1, resolution: 24 },
    urgent: { response: 4, resolution: 48 },
    high: { response: 8, resolution: 72 },
    medium: { response: 24, resolution: 120 },
    low: { response: 48, resolution: 168 }
  }

};