import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const reportSchema = new Schema(
  {
    reporterId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    targetType: {
      type: String,
      enum: ["event", "community", "user", "community_message"],
      required: true,
      index: true,
    },
    targetId: { type: Schema.Types.ObjectId, required: true, index: true },
    reason: {
      type: String,
      enum: ["spam", "harassment", "hate", "hate_speech", "violence", "scam", "unsafe", "inappropriate", "misinformation", "other"],
      required: true,
      index: true,
    },
    details: { type: String, maxlength: 2000 },
    status: {
      type: String,
      enum: ["open", "reviewing", "resolved", "dismissed"],
      default: "open",
      index: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    resolution: { type: String, maxlength: 2000 },
  },
  { timestamps: true, versionKey: false },
);

reportSchema.index({ targetType: 1, targetId: 1, status: 1, createdAt: -1 });
reportSchema.index({ reporterId: 1, createdAt: -1 });
// One unresolved report per reporter/target avoids duplicate moderation work while
// still allowing a new report after the earlier one is resolved or dismissed.
reportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["open", "reviewing"] } } },
);

export type Report = InferSchemaType<typeof reportSchema>;
export const ReportModel =
  (models.Report as Model<Report>) || model<Report>("Report", reportSchema);
