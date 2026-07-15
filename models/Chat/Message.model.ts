import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clientMessageId: { type: String, required: true },
    type: { type: String, enum: ["text", "image", "system"], default: "text" },
    text: { type: String, maxlength: 4000 },
    mediaUrl: { type: String },
    readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    editedAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, senderId: 1, clientMessageId: 1 }, { unique: true });

export type Message = InferSchemaType<typeof messageSchema>;
export const MessageModel = (models.Message as Model<Message>) || model<Message>("Message", messageSchema);

