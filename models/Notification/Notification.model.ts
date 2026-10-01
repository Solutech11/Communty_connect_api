import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, required: true, maxlength: 60, index: true },
    dedupeKey: { type: String, sparse: true },
    title: { type: String, required: true, maxlength: 140 },
    body: { type: String, required: true, maxlength: 500 },
    data: { type: Schema.Types.Mixed, default: {} },
    readAt: { type: Date },
    pushTicketIds: [{ type: String }],
    emailDelivery: {
      status: { type: String, enum: ["sending", "sent", "failed", "skipped"] },
      claimedAt: { type: Date },
      sentAt: { type: Date },
    },
  },
  { timestamps: true, versionKey: false },
);

notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true, sparse: true });

export type Notification = InferSchemaType<typeof notificationSchema>;
export const NotificationModel =
  (models.Notification as Model<Notification>) || model<Notification>("Notification", notificationSchema);

