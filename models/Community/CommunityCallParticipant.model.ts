import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const communityCallParticipantSchema = new Schema(
  {
    callId: { type: Schema.Types.ObjectId, ref: "CommunityCall", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false },
);

communityCallParticipantSchema.index({ callId: 1, userId: 1 }, { unique: true });

export type CommunityCallParticipant = InferSchemaType<typeof communityCallParticipantSchema>;
export const CommunityCallParticipantModel =
  (models.CommunityCallParticipant as Model<CommunityCallParticipant>)
  || model<CommunityCallParticipant>("CommunityCallParticipant", communityCallParticipantSchema);
