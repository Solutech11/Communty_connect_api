import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { EVENT_STATUSES } from "../../Constant";

const moderationCheckSchema = new Schema(
  {
    acceptable: { type: Boolean, required: true },
    reasons: [{ type: String, trim: true, maxlength: 240 }],
  },
  { _id: false, id: false },
);

const eventModerationSchema = new Schema(
  {
    provider: { type: String, enum: ["groq"], required: true },
    model: { type: String, required: true, maxlength: 120 },
    verdict: { type: String, enum: ["approved", "rejected"], required: true },
    reviewedAt: { type: Date, required: true },
    reasons: [{ type: String, trim: true, maxlength: 240 }],
    checks: {
      content: { type: moderationCheckSchema, required: true },
      image: { type: moderationCheckSchema, required: true },
      pricing: { type: moderationCheckSchema, required: true },
      communityGuidelines: { type: moderationCheckSchema, required: true },
    },
  },
  { _id: false, id: false },
);

const eventSchema = new Schema(
  {
    creatorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    slug: { type: String, required: true, unique: true, index: true },
    description: { type: String, required: true, maxlength: 5000 },
    coverImageUrl: { type: String },
    activityType: { type: String, required: true, maxlength: 60, index: true },
    targetAudience: { type: String, maxlength: 60 },
    setting: { type: String, enum: ["indoor", "outdoor", "online", "hybrid"], required: true },
    country: { type: String, required: true, default: "Nigeria" },
    state: { type: String, required: true, index: true },
    lga: { type: String, required: true, index: true },
    venueName: { type: String, required: true, maxlength: 180 },
    address: { type: String, required: true, maxlength: 300 },
    coordinates: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: undefined },
    },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true },
    timezone: { type: String, required: true, default: "Africa/Lagos" },
    contactPhone: { type: String, maxlength: 24 },
    maxCapacity: { type: Number, required: true, min: 1 },
    tags: [{ type: String, maxlength: 40 }],
    status: { type: String, enum: EVENT_STATUSES, default: "draft", index: true },
    moderation: { type: eventModerationSchema, default: undefined },
    moderationInProgressUntil: { type: Date, select: false },
    submittedAt: { type: Date },
    publishedAt: { type: Date },
    approvedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    deactivatedAt: { type: Date },
    deactivatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    deactivationReason: { type: String, maxlength: 300 },
    cancelledAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

eventSchema.index({ coordinates: "2dsphere" });
eventSchema.index({ title: "text", description: "text", tags: "text" });
eventSchema.index({ creatorId: 1, status: 1, startsAt: -1 });

export type Event = InferSchemaType<typeof eventSchema>;
export const EventModel = (models.Event as Model<Event>) || model<Event>("Event", eventSchema);

