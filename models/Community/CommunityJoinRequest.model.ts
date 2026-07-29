import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const communityJoinRequestSchema = new Schema(
  {
    communityId: { type: Schema.Types.ObjectId, ref: "Community", required: true, index: true },
    requesterId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    message: { type: String, trim: true, maxlength: 500, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
      index: true,
    },
    reviewNote: { type: String, trim: true, maxlength: 500 },
    reviewedAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, versionKey: false },
);

communityJoinRequestSchema.index({ communityId: 1, status: 1, createdAt: -1 });
communityJoinRequestSchema.index(
  { communityId: 1, requesterId: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } },
);

export type CommunityJoinRequest = InferSchemaType<typeof communityJoinRequestSchema>;
export const CommunityJoinRequestModel =
  (models.CommunityJoinRequest as Model<CommunityJoinRequest>)
  || model<CommunityJoinRequest>("CommunityJoinRequest", communityJoinRequestSchema);