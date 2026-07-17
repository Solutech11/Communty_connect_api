import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const adminSessionSchema = new Schema(
  {
    adminId: { type: Schema.Types.ObjectId, ref: "Admin", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    csrfTokenHash: { type: String, required: true, select: false },
    ipHash: { type: String, required: true },
    userAgentHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
adminSessionSchema.index({ adminId: 1, revokedAt: 1 });

export type AdminSession = InferSchemaType<typeof adminSessionSchema>;
export const AdminSessionModel =
  (models.AdminSession as Model<AdminSession>)
  || model<AdminSession>("AdminSession", adminSessionSchema);
