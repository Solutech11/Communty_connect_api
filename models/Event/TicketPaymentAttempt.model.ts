import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const ticketPaymentAttemptSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "TicketOrder", required: true, index: true },
    reference: { type: String, required: true, unique: true, index: true },
    idempotencyKey: { type: String },
    amountKobo: { type: Number, required: true, min: 1 },
    checkoutUrl: { type: String, select: false },
    status: {
      type: String,
      enum: [
        "initializing", "ready", "failed", "succeeded", "refund_pending",
        "refund_requested", "refunded", "refund_failed", "refund_needs_attention",
      ],
      required: true,
      default: "initializing",
      index: true,
    },
    providerStatus: { type: String, maxlength: 40 },
    paystackTransactionId: { type: String },
    refundId: { type: String },
    refundAttempts: { type: Number, default: 0, min: 0 },
    refundCheckedAt: { type: Date },
    lastReconciledAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

ticketPaymentAttemptSchema.index(
  { orderId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } },
);
ticketPaymentAttemptSchema.index({ orderId: 1, createdAt: -1 });
ticketPaymentAttemptSchema.index({ status: 1, refundCheckedAt: 1 });
ticketPaymentAttemptSchema.index({ status: 1, lastReconciledAt: 1 });

export type TicketPaymentAttempt = InferSchemaType<typeof ticketPaymentAttemptSchema>;
export const TicketPaymentAttemptModel =
  (models.TicketPaymentAttempt as Model<TicketPaymentAttempt>)
  || model<TicketPaymentAttempt>("TicketPaymentAttempt", ticketPaymentAttemptSchema);
