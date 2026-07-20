import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const communityContentSchema = new Schema(
  {
    communityId: { type: Schema.Types.ObjectId, ref: "Community", required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: {
      type: String,
      enum: ["post", "announcement", "message"],
      required: true,
      index: true,
    },
    text: { type: String, required: true, trim: true, maxlength: 4000 },
    imageUrl: { type: String },
    clientMessageId: { type: String, maxlength: 128 },
    editedAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

communityContentSchema.index({ communityId: 1, kind: 1, createdAt: -1 });
communityContentSchema.index(
  { communityId: 1, authorId: 1, clientMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: { kind: "message", clientMessageId: { $type: "string" } },
  },
);

export type CommunityContent = InferSchemaType<typeof communityContentSchema>;
export const CommunityContentModel =
  (models.CommunityContent as Model<CommunityContent>)
  || model<CommunityContent>("CommunityContent", communityContentSchema);
