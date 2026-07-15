import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { TRANSACTION_STATUSES } from "../../Constant";

const transactionSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: "Wallet", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    counterpartyUserId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    type: {
      type: String,
      enum: ["topup", "internal_transfer", "withdrawal", "ticket_purchase", "refund", "adjustment"],
      required: true,
      index: true,
    },
    direction: { type: String, enum: ["credit", "debit"], required: true },
    amountKobo: { type: Number, required: true, min: 0 },
    feeKobo: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "NGN" },
    status: { type: String, enum: TRANSACTION_STATUSES, default: "pending", index: true },
    title: { type: String, required: true, maxlength: 140 },
    description: { type: String, maxlength: 500 },
    provider: { type: String, enum: ["internal", "paystack"], required: true },
    providerReference: { type: String, sparse: true, index: true },
    idempotencyKey: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    completedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

transactionSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
transactionSchema.index({ userId: 1, createdAt: -1 });

export type Transaction = InferSchemaType<typeof transactionSchema>;
export const TransactionModel =
  (models.Transaction as Model<Transaction>) || model<Transaction>("Transaction", transactionSchema);

