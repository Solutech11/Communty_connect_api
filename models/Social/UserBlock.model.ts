import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  targetId: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true, versionKey: false });
schema.index({ userId: 1, targetId: 1 }, { unique: true });
schema.index({ targetId: 1, userId: 1 });
export type UserBlock = InferSchemaType<typeof schema>;
export const UserBlockModel = (models.UserBlock as Model<UserBlock>) || model("UserBlock", schema);
