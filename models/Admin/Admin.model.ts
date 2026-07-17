import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const adminSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    active: { type: Boolean, default: true, index: true },
    permissions: [{
      type: String,
      enum: ["users:read", "events:moderate", "earnings:read"],
    }],
    lastLoginAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

export type Admin = InferSchemaType<typeof adminSchema>;
export const AdminModel = (models.Admin as Model<Admin>) || model<Admin>("Admin", adminSchema);
