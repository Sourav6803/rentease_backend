const EVENTS = {
  USER: {
    REGISTERED: "user:registered",
    LOGGED_IN: "user:logged_in",
    LOGGED_OUT: "user:logged_out",
    PROFILE_UPDATED: "user:profile_updated",
    EMAIL_VERIFIED: "user:email_verified",
    PHONE_VERIFIED: "user:phone_verified",
    KYC_SUBMITTED: "user:kyc_submitted",
    KYC_APPROVED: "user:kyc_approved",
    KYC_REJECTED: "user:kyc_rejected",
    ACCOUNT_BLOCKED: "user:account_blocked",
    ACCOUNT_UNBLOCKED: "user:account_unblocked",
  },
  RENTAL: {
    CREATED: "rental:created",
    CONFIRMED: "rental:confirmed",
    DELIVERY_SCHEDULED: "rental:delivery_scheduled",
    DELIVERED: "rental:delivered",
    ACTIVE: "rental:active",
    EXTENSION_REQUESTED: "rental:extension_requested",
    EXTENSION_APPROVED: "rental:extension_approved",
    COMPLETED: "rental:completed",
    CANCELLED: "rental:cancelled",
    OVERDUE: "rental:overdue",
    DISPUTED: "rental:disputed",
  },

  PAYMENT: {
    CREATED: "payment:created",
    SUCCESS: "payment:success",
    FAILED: "payment:failed",
    REFUNDED: "payment:refunded",
  },
  VENDOR: {
    REGISTERED: "vendor:registered",
    APPROVED: "vendor:approved",
    REJECTED: "vendor:rejected",

    PROFILE_UPDATED: "vendor:profile_updated",

    STORE_CREATED: "vendor:store_created",
    STORE_UPDATED: "vendor:store_updated",

    PRODUCT_ADDED: "vendor:product_added",
    PRODUCT_UPDATED: "vendor:product_updated",
    PRODUCT_REMOVED: "vendor:product_removed",

    ACCOUNT_BLOCKED: "vendor:account_blocked",
    ACCOUNT_UNBLOCKED: "vendor:account_unblocked",
  },
};

module.exports = EVENTS;
