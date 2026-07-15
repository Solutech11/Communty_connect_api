import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const bankAccountSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    bankCode: { type: String, required: true },
    bankName: { type: String, required: true },
    accountName: { type: String, required: true },
    encryptedAccountNumber: { type: String, required: true, select: false },
    maskedAccountNumber: { type: String, required: true },
    accountFingerprint: { type: String, required: true },
    paystackRecipientCode: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_document, result) => {
        const safeResult = result as unknown as Record<string, unknown>;
        delete safeResult.encryptedAccountNumber;
        delete safeResult.accountFingerprint;
        delete safeResult.paystackRecipientCode;
        return result;
      },
    },
  },
);

bankAccountSchema.index({ userId: 1, accountFingerprint: 1 }, { unique: true });

export type BankAccount = InferSchemaType<typeof bankAccountSchema>;
export const BankAccountModel =
  (models.BankAccount as Model<BankAccount>) || model<BankAccount>("BankAccount", bankAccountSchema);

