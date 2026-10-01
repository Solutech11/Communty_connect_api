import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  targetId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  action: { type: String, enum: ["like", "pass"], required: true },
}, { timestamps: true, versionKey: false });
schema.index({ userId: 1, targetId: 1 }, { unique: true });
schema.index({ targetId: 1, action: 1, userId: 1 });
export type RoommateDecision = InferSchemaType<typeof schema>;
export const RoommateDecisionModel = (models.RoommateDecision as Model<RoommateDecision>)
  || model("RoommateDecision", schema);
