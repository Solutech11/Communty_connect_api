import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

import { nextPayoutMidnight } from "../../utils/payoutSchedule.utils";

const walletSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    walletNumber: { type: String, required: true, unique: true, index: true },
    currency: { type: String, default: "NGN" },
    availableBalanceKobo: { type: Number, default: 0, min: 0 },
    pendingBalanceKobo: { type: Number, default: 0, min: 0 },
    nextPayoutAt: { type: Date, default: nextPayoutMidnight },
    status: { type: String, enum: ["active", "frozen", "closed"], default: "active" },
  },
  { timestamps: true },
);

walletSchema.index({ status: 1, nextPayoutAt: 1, _id: 1 }, {
  partialFilterExpression: { availableBalanceKobo: { $gt: 0 } },
});

export type Wallet = InferSchemaType<typeof walletSchema>;
export const WalletModel = (models.Wallet as Model<Wallet>) || model<Wallet>("Wallet", walletSchema);


