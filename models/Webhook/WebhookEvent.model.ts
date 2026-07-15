import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const webhookEventSchema = new Schema(
  {
    provider: { type: String, enum: ["paystack"], required: true },
    dedupeKey: { type: String, required: true, unique: true, index: true },
    eventType: { type: String, required: true, index: true },
    reference: { type: String, index: true },
    status: { type: String, enum: ["processing", "processed", "ignored", "failed"], default: "processing" },
    attempts: { type: Number, default: 1 },
    processedAt: { type: Date },
    errorCode: { type: String },
  },
  { timestamps: true, versionKey: false },
);

export type WebhookEvent = InferSchemaType<typeof webhookEventSchema>;
export const WebhookEventModel =
  (models.WebhookEvent as Model<WebhookEvent>) || model<WebhookEvent>("WebhookEvent", webhookEventSchema);

