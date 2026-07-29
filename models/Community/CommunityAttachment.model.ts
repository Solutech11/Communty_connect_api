import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const communityAttachmentSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    url: { type: String, required: true },
    publicId: { type: String, required: true, select: false },
    type: { type: String, enum: ["image", "pdf", "file"], required: true },
    name: { type: String, required: true, trim: true, maxlength: 255 },
    mimeType: { type: String, required: true, maxlength: 128 },
    sizeBytes: { type: Number, required: true, min: 1 },
    thumbnailUrl: { type: String },
    linkedCommunityId: { type: Schema.Types.ObjectId, ref: "Community", index: true },
    linkedMessageId: { type: Schema.Types.ObjectId, ref: "CommunityContent", index: true },
  },
  { timestamps: true, versionKey: false },
);

communityAttachmentSchema.index({ ownerId: 1, createdAt: -1 });

export type CommunityAttachment = InferSchemaType<typeof communityAttachmentSchema>;
export const CommunityAttachmentModel =
  (models.CommunityAttachment as Model<CommunityAttachment>)
  || model<CommunityAttachment>("CommunityAttachment", communityAttachmentSchema);