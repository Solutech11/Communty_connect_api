import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const friendshipSchema = new Schema(
  {
    requesterId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    addresseeId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    pairKey: { type: String, required: true, unique: true },
    status: { type: String, enum: ["pending", "accepted", "declined", "blocked"], default: "pending" },
    respondedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

friendshipSchema.index({ requesterId: 1, status: 1 });
friendshipSchema.index({ addresseeId: 1, status: 1 });

export type Friendship = InferSchemaType<typeof friendshipSchema>;
export const FriendshipModel = (models.Friendship as Model<Friendship>) || model<Friendship>("Friendship", friendshipSchema);

