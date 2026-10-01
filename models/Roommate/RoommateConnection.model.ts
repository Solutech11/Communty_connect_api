import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const consent = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
  fields: [{ type: String, enum: ["phone", "email"] }],
  contactFingerprint: { type: String, required: true },
}, { _id: false });
const schema = new Schema({
  pairKey: { type: String, required: true, unique: true },
  participantIds: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
  status: { type: String, enum: ["active", "paired", "closed"], default: "active", required: true },
  conversationId: { type: Schema.Types.ObjectId, ref: "Conversation" },
  consents: { type: [consent], default: [] },
  pairedAt: { type: Date },
  closedAt: { type: Date },
}, { timestamps: true, versionKey: false });
schema.index({ participantIds: 1, status: 1, updatedAt: -1 });
export type RoommateConnection = InferSchemaType<typeof schema>;
export const RoommateConnectionModel = (models.RoommateConnection as Model<RoommateConnection>)
  || model("RoommateConnection", schema);
