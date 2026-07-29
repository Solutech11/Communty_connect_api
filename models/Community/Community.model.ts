import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const communityRuleSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    order: { type: Number, required: true, min: 0 },
  },
  { _id: true, id: false },
);

const communitySchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    slug: { type: String, required: true, unique: true, index: true },
    description: { type: String, required: true, maxlength: 2000 },
    // imageUrl remains for existing clients. New clients should use the
    // separate cover/avatar fields to render the community profile correctly.
    imageUrl: { type: String },
    coverImageUrl: { type: String },
    avatarImageUrl: { type: String },
    category: { type: String, required: true, maxlength: 60, index: true },
    state: { type: String, index: true },
    lga: { type: String, index: true },
    visibility: { type: String, enum: ["public", "private"], default: "public" },
    membershipType: { type: String, enum: ["free", "premium"], default: "free", index: true },
    membershipPriceKobo: { type: Number, default: 0, min: 0 },
    joinPolicy: {
      type: String,
      enum: ["open", "approval", "invite_only", "access_code"],
      default: "open",
    },
    accessCodeHash: { type: String, select: false },
    messagePermission: { type: String, enum: ["everyone", "moderators"], default: "everyone" },
    membersCanCreatePosts: { type: Boolean, default: true },
    membersCanInvite: { type: Boolean, default: false },
    showMemberList: { type: Boolean, default: true },
    rulesIntroduction: { type: String, trim: true, maxlength: 500, default: "" },
    rules: { type: [communityRuleSchema], default: [] },
    consequences: [{ type: String, trim: true, maxlength: 300 }],
    rulesUpdatedAt: { type: Date },
    rulesUpdatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    lastActivityAt: { type: Date, index: true },
    // Retained until existing deployments migrate to CommunityMember records.
    members: [{ type: Schema.Types.ObjectId, ref: "User" }],
    moderators: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true, versionKey: false },
);

communitySchema.index({ name: "text", description: "text" });
communitySchema.index({ visibility: 1, lastActivityAt: -1 });
communitySchema.pre("validate", function validateMembershipPrice() {
  if (this.membershipType === "premium" && this.membershipPriceKobo <= 0) {
    this.invalidate("membershipPriceKobo", "Premium communities require a positive membership price");
  }

  if (this.membershipType === "free") {
    this.membershipPriceKobo = 0;
  }
});

export type Community = InferSchemaType<typeof communitySchema>;
export const CommunityModel =
  (models.Community as Model<Community>) || model<Community>("Community", communitySchema);