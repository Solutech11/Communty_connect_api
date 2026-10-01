import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const schema = new Schema({
  connectionId: { type: Schema.Types.ObjectId, ref: "RoommateConnection", required: true },
  requesterId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  recipientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  status: { type: String, enum: ["pending", "accepted", "declined", "cancelled", "closed"], default: "pending", required: true },
  respondedAt: { type: Date },
}, { timestamps: true, versionKey: false });
schema.index({ connectionId: 1, status: 1, createdAt: -1 });
schema.index({ connectionId: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });
schema.index({ requesterId: 1, status: 1 });
schema.index({ recipientId: 1, status: 1 });
export type RoommateRequest = InferSchemaType<typeof schema>;
export const RoommateRequestModel = (models.RoommateRequest as Model<RoommateRequest>)
  || model("RoommateRequest", schema);
