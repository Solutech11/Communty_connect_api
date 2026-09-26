import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const ticketOrderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    ticketTypeId: { type: Schema.Types.ObjectId, ref: "TicketType", required: true },
    buyerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    quantity: { type: Number, required: true, min: 1, max: 20 },
    ticketSubtotalKobo: { type: Number, required: true, default: 0, min: 0 },
    totalKobo: { type: Number, required: true, min: 0 },
    platformFeeKobo: { type: Number, required: true, default: 0, min: 0 },
    organizerProceedsKobo: { type: Number, required: true, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["pending", "paid", "cancelled", "refunded"],
      default: "pending",
      index: true,
    },
    paymentReference: { type: String, sparse: true, unique: true },
    idempotencyKey: { type: String, required: true },
    qrTokenHash: { type: String, select: false },
    encryptedQrToken: { type: String, select: false },
    checkoutUrl: { type: String, select: false },
    reservationExpiresAt: { type: Date, index: true },
    checkedInAt: { type: Date },
    checkedInBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, versionKey: false },
);

ticketOrderSchema.index({ eventId: 1, buyerId: 1 });
ticketOrderSchema.index({ eventId: 1, qrTokenHash: 1 });
ticketOrderSchema.index({ buyerId: 1, idempotencyKey: 1 }, { unique: true });
ticketOrderSchema.index({ buyerId: 1, status: 1, createdAt: -1 });

export type TicketOrder = InferSchemaType<typeof ticketOrderSchema>;
export const TicketOrderModel =
  (models.TicketOrder as Model<TicketOrder>) || model<TicketOrder>("TicketOrder", ticketOrderSchema);

