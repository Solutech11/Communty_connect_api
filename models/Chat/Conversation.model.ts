import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const conversationSchema = new Schema(
  {
    type: { type: String, enum: ["direct", "group", "support", "ai"], required: true, index: true },
    title: { type: String, maxlength: 120 },
    participantIds: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    lastMessageAt: { type: Date, index: true },
    archivedBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true, versionKey: false },
);

conversationSchema.index({ participantIds: 1, lastMessageAt: -1 });

export type Conversation = InferSchemaType<typeof conversationSchema>;
export const ConversationModel =
  (models.Conversation as Model<Conversation>) || model<Conversation>("Conversation", conversationSchema);

