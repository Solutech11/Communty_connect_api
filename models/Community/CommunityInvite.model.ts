import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const communityInviteSchema = new Schema(
  {
    communityId: { type: Schema.Types.ObjectId, ref: "Community", required: true, index: true },
    tokenHash: { type: String, required: true, select: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    maxUses: { type: Number, required: true, min: 1, max: 10_000, default: 1 },
    uses: { type: Number, required: true, min: 0, default: 0 },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

communityInviteSchema.index({ communityId: 1, expiresAt: 1 });

export type CommunityInvite = InferSchemaType<typeof communityInviteSchema>;
export const CommunityInviteModel =
  (models.CommunityInvite as Model<CommunityInvite>)
  || model<CommunityInvite>("CommunityInvite", communityInviteSchema);
