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

  DELIVERY: {
    SCHEDULED: "delivery:scheduled",
    ASSIGNED: "delivery:assigned",
    OUT_FOR_DELIVERY: "delivery:outfordelivery",
    IN_TRANSIT: "delivery:intransit",
    REACHED: "delivery:reached",
    DELIVERED: "delivery:delivered",
    PICKED_UP: "delivery:pickedup",
    FAILED: "delivery:failed",
    RESCHEDULED: "delivery:rescheduled",
    CANCELLED: "delivery:cancelled",
  },

  // IMPORTANT: the emitters import EVENTS from ../events (index.js), while the
  // listeners in events/*.events.js import this file. Wherever the two disagree the
  // only symptom is a listener that silently never runs. The vendor product/payout
  // entries below were the clearest example: index.js emits "vendor:product.added"
  // but this file said "vendor:product_added", so the listener that maintains
  // Vendor.products.total / .active / .categories never fired once, and four keys
  // (SUSPENDED, PRODUCT_DELETED, INVENTORY_LOW, PAYOUT_PROCESSED) were missing
  // entirely, which registered their listeners on `undefined`.
  VENDOR: {
    REGISTERED: "vendor:registered",
    APPROVED: "vendor:approved",
    REJECTED: "vendor:rejected",
    SUSPENDED: "vendor:suspended",

    PROFILE_UPDATED: "vendor:profile_updated",

    STORE_CREATED: "vendor:store_created",
    STORE_UPDATED: "vendor:store_updated",

    PRODUCT_ADDED: "vendor:product.added",
    PRODUCT_UPDATED: "vendor:product.updated",
    PRODUCT_DELETED: "vendor:product.deleted",
    PRODUCT_REMOVED: "vendor:product_removed",

    INVENTORY_LOW: "vendor:inventory.low",
    PAYOUT_PROCESSED: "vendor:payout.processed",

    ACCOUNT_BLOCKED: "vendor:account_blocked",
    ACCOUNT_UNBLOCKED: "vendor:account_unblocked",
  },
}; 

module.exports = EVENTS;
