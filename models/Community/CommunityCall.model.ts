import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const communityCallSchema = new Schema(
  {
    communityId: { type: Schema.Types.ObjectId, ref: "Community", required: true, index: true },
    type: { type: String, enum: ["voice", "video"], required: true },
    title: { type: String, trim: true, maxlength: 120 },
    status: { type: String, enum: ["active", "ended"], default: "active", index: true },
    startedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    participantCount: { type: Number, default: 0, min: 0 },
    endedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

communityCallSchema.index(
  { communityId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "active" } },
);

export type CommunityCall = InferSchemaType<typeof communityCallSchema>;
export const CommunityCallModel =
  (models.CommunityCall as Model<CommunityCall>)
  || model<CommunityCall>("CommunityCall", communityCallSchema);