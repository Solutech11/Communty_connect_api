import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenId: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: { type: Date },
    replacedByTokenId: { type: String },
    createdByIpHash: { type: String },
    userAgentHash: { type: String },
  },
  { timestamps: true, versionKey: false },
);

refreshTokenSchema.index({ userId: 1, family: 1 });

export type RefreshToken = InferSchemaType<typeof refreshTokenSchema>;
export const RefreshTokenModel =
  (models.RefreshToken as Model<RefreshToken>) || model<RefreshToken>("RefreshToken", refreshTokenSchema);

