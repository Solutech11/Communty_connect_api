import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { DISPUTE_STATUSES } from "../../Constant";

const disputeMessageSchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    message: { type: String, required: true, maxlength: 3000 },
    attachments: [{ type: String }],
    internal: { type: Boolean, default: false },
  },
  { timestamps: true, _id: true, versionKey: false },
);

const disputeSchema = new Schema(
  {
    disputeNumber: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    transactionId: { type: Schema.Types.ObjectId, ref: "Transaction", index: true },
    category: {
      type: String,
      enum: ["payment", "withdrawal", "transfer", "ticket", "event", "harassment", "other"],
      required: true,
    },
    subject: { type: String, required: true, maxlength: 160 },
    description: { type: String, required: true, maxlength: 5000 },
    status: { type: String, enum: DISPUTE_STATUSES, default: "open", index: true },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
    messages: [disputeMessageSchema],
    resolvedAt: { type: Date },
    resolution: { type: String, maxlength: 3000 },
  },
  { timestamps: true, versionKey: false },
);

disputeSchema.index({ userId: 1, createdAt: -1 });

export type Dispute = InferSchemaType<typeof disputeSchema>;
export const DisputeModel = (models.Dispute as Model<Dispute>) || model<Dispute>("Dispute", disputeSchema);

