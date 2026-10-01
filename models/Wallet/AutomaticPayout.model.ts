import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

import { MIN_AUTOMATIC_PAYOUT_KOBO } from "../../utils/payoutSchedule.utils";

const automaticPayoutSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  walletId: { type: Schema.Types.ObjectId, ref: "Wallet", required: true },
  transactionId: { type: Schema.Types.ObjectId, ref: "Transaction", required: true, unique: true },
  bankAccountId: { type: Schema.Types.ObjectId, ref: "BankAccount", required: true },
  recipientCode: { type: String, required: true, select: false },
  reference: { type: String, required: true, unique: true },
  cycle: { type: String, required: true },
  amountKobo: { type: Number, required: true, min: MIN_AUTOMATIC_PAYOUT_KOBO },
  currency: { type: String, required: true, enum: ["NGN"] },
  status: { type: String, enum: ["ready", "submitted", "settled"], default: "ready" },
  submissionAttempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });

automaticPayoutSchema.index({ userId: 1, cycle: 1 }, { unique: true });
automaticPayoutSchema.index({ status: 1, nextAttemptAt: 1, _id: 1 });

export type AutomaticPayout = InferSchemaType<typeof automaticPayoutSchema>;
export const AutomaticPayoutModel = (models.AutomaticPayout as Model<AutomaticPayout>)
  || model<AutomaticPayout>("AutomaticPayout", automaticPayoutSchema);
