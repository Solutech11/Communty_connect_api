import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const walletSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    walletNumber: { type: String, required: true, unique: true, index: true },
    currency: { type: String, default: "NGN" },
    availableBalanceKobo: { type: Number, default: 0, min: 0 },
    pendingBalanceKobo: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["active", "frozen", "closed"], default: "active" },
  },
  { timestamps: true },
);

export type Wallet = InferSchemaType<typeof walletSchema>;
export const WalletModel = (models.Wallet as Model<Wallet>) || model<Wallet>("Wallet", walletSchema);


