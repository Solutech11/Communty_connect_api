import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const communityMembershipOrderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    communityId: { type: Schema.Types.ObjectId, ref: "Community", required: true, index: true },
    buyerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    grossAmountKobo: { type: Number, required: true, min: 1 },
    platformFeeKobo: { type: Number, required: true, min: 0 },
    ownerProceedsKobo: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["pending", "paid", "cancelled", "refunded"], default: "pending", index: true },
    paymentReference: { type: String, required: true, unique: true, index: true },
    idempotencyKey: { type: String, required: true },
    checkoutUrl: { type: String, select: false },
    paidAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

communityMembershipOrderSchema.index({ buyerId: 1, idempotencyKey: 1 }, { unique: true });
communityMembershipOrderSchema.index({ communityId: 1, buyerId: 1, status: 1 });

export type CommunityMembershipOrder = InferSchemaType<typeof communityMembershipOrderSchema>;
export const CommunityMembershipOrderModel =
  (models.CommunityMembershipOrder as Model<CommunityMembershipOrder>)
  || model<CommunityMembershipOrder>("CommunityMembershipOrder", communityMembershipOrderSchema);
