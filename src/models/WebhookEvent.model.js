/**
 * models/WebhookEvent.model.js
 *
 * Gateway webhook deduplication.
 *
 * Razorpay and Stripe both retry webhooks until they get a 2xx, and both can
 * deliver the same event more than once. Without a record of what has already
 * been applied, a retry would re-run verification and (before the ledger had an
 * idempotency guard) credit the vendor twice.
 *
 * The unique index on { gateway, eventId } makes the insert itself the lock: the
 * handler tries to claim the event first and skips the work if the claim fails.
 */
const mongoose = require('mongoose');

const GATEWAYS = ['razorpay', 'stripe'];
const WEBHOOK_STATUSES = ['processing', 'processed', 'ignored', 'failed'];

const webhookEventSchema = new mongoose.Schema(
  {
    gateway: { type: String, enum: GATEWAYS, required: true },
    /** Razorpay: event id (`evt_...`) or the payment entity id. Stripe: event id. */
    eventId: { type: String, required: true },
    eventType: String,

    /** The payment this event resolved to, when it could be matched. */
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    paymentNumber: String,

    /**
     * Hash of the raw body. Lets us detect a *different* payload reusing the
     * same event id, which would mean the signature check is being bypassed.
     */
    payloadHash: String,

    status: { type: String, enum: WEBHOOK_STATUSES, default: 'processing' },
    error: String,
    processedAt: Date,
    attempts: { type: Number, default: 1 },
  },
  { timestamps: true },
);

/** The replay lock. */
webhookEventSchema.index({ gateway: 1, eventId: 1 }, { unique: true });

/** Support view: what has this gateway been sending us. */
webhookEventSchema.index({ gateway: 1, createdAt: -1 });

const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);

module.exports = WebhookEvent;
module.exports.GATEWAYS = GATEWAYS;
module.exports.WEBHOOK_STATUSES = WEBHOOK_STATUSES;
