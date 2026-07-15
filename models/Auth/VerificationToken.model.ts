import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const verificationTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    purpose: {
      type: String,
      enum: ["verify_email", "reset_password"],
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, select: false },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    usedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

verificationTokenSchema.index({ userId: 1, purpose: 1 }, { unique: true });

export type VerificationToken = InferSchemaType<typeof verificationTokenSchema>;
export const VerificationTokenModel =
  (models.VerificationToken as Model<VerificationToken>) || model<VerificationToken>("VerificationToken", verificationTokenSchema);

