import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const aiSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    purpose: {
      type: String,
      enum: ["assistant", "event_copy", "recommendations", "chat_summary", "moderation"],
      required: true,
    },
    previousResponseId: { type: String },
    encryptedHistory: { type: String, select: false },
    title: { type: String, maxlength: 120 },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false },
);

aiSessionSchema.index({ userId: 1, lastUsedAt: -1 });

export type AISession = InferSchemaType<typeof aiSessionSchema>;
export const AISessionModel = (models.AISession as Model<AISession>) || model<AISession>("AISession", aiSessionSchema);

