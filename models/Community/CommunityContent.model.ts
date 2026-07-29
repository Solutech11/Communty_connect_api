import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const reactionSchema = new Schema(
  {
    emoji: { type: String, required: true, trim: true, maxlength: 32 },
    userIds: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
  },
  { _id: false, id: false },
);

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
    text: { type: String, trim: true, maxlength: 4000, default: "" },
    imageUrl: { type: String },
    attachments: [{ type: Schema.Types.ObjectId, ref: "CommunityAttachment" }],
    replyToId: { type: Schema.Types.ObjectId, ref: "CommunityContent" },
    reactions: { type: [reactionSchema], default: [] },
    pinnedAt: { type: Date },
    pinnedBy: { type: Schema.Types.ObjectId, ref: "User" },
    clientMessageId: { type: String, maxlength: 128 },
    editedAt: { type: Date },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, versionKey: false },
);

communityContentSchema.index({ communityId: 1, kind: 1, createdAt: -1 });
communityContentSchema.index({ communityId: 1, kind: 1, pinnedAt: -1 });
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