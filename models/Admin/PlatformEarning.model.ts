import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { PLATFORM_CHARGE_TYPES } from "../../Constant";

const platformEarningSchema = new Schema(
  {
    sourceType: { type: String, enum: PLATFORM_CHARGE_TYPES, required: true, index: true },
    sourceReference: { type: String, required: true },
    payerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    beneficiaryUserId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    transactionId: { type: Schema.Types.ObjectId, ref: "Transaction", required: true, index: true },
    grossAmountKobo: { type: Number, required: true, min: 0 },
    feeAmountKobo: { type: Number, required: true, min: 1 },
    netAmountKobo: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "NGN" },
    status: { type: String, enum: ["earned", "reversed"], default: "earned", index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    earnedAt: { type: Date, required: true, index: true },
    reversedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

platformEarningSchema.index({ sourceType: 1, sourceReference: 1 }, { unique: true });
platformEarningSchema.index({ status: 1, earnedAt: -1 });

export type PlatformEarning = InferSchemaType<typeof platformEarningSchema>;
export const PlatformEarningModel =
  (models.PlatformEarning as Model<PlatformEarning>)
  || model<PlatformEarning>("PlatformEarning", platformEarningSchema);
