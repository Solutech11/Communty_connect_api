import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const communitySchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    slug: { type: String, required: true, unique: true, index: true },
    description: { type: String, required: true, maxlength: 2000 },
    imageUrl: { type: String },
    category: { type: String, required: true, maxlength: 60, index: true },
    state: { type: String, index: true },
    lga: { type: String, index: true },
    visibility: { type: String, enum: ["public", "private"], default: "public" },
    membershipType: { type: String, enum: ["free", "premium"], default: "free", index: true },
    membershipPriceKobo: { type: Number, default: 0, min: 0 },
    members: [{ type: Schema.Types.ObjectId, ref: "User" }],
    moderators: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true, versionKey: false },
);

communitySchema.index({ name: "text", description: "text" });
communitySchema.pre("validate", function validateMembershipPrice() {
  if (this.membershipType === "premium" && this.membershipPriceKobo <= 0) {
    this.invalidate("membershipPriceKobo", "Premium communities require a positive membership price");
  }

  if (this.membershipType === "free") {
    this.membershipPriceKobo = 0;
  }
});

export type Community = InferSchemaType<typeof communitySchema>;
export const CommunityModel = (models.Community as Model<Community>) || model<Community>("Community", communitySchema);

