import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const COMMUNITY_MEMBER_ROLES = ["owner", "moderator", "member"] as const;
export const COMMUNITY_MEMBER_STATUSES = ["pending", "active", "rejected", "removed", "banned"] as const;
export const COMMUNITY_NOTIFICATION_LEVELS = ["all", "announcements", "mentions", "muted"] as const;

const communityMemberSchema = new Schema(
  {
    communityId: { type: Schema.Types.ObjectId, ref: "Community", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: COMMUNITY_MEMBER_ROLES, default: "member", index: true },
    status: { type: String, enum: COMMUNITY_MEMBER_STATUSES, default: "active", index: true },
    joinedAt: { type: Date, default: Date.now },
    muted: { type: Boolean, default: false },
    notificationLevel: {
      type: String,
      enum: COMMUNITY_NOTIFICATION_LEVELS,
      default: "all",
    },
    lastReadMessageId: { type: Schema.Types.ObjectId, ref: "CommunityContent" },
    lastReadAt: { type: Date },
    bannedReason: { type: String, maxlength: 500 },
    bannedExpiresAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

communityMemberSchema.index({ communityId: 1, userId: 1 }, { unique: true });
communityMemberSchema.index({ communityId: 1, status: 1, role: 1, joinedAt: -1 });
communityMemberSchema.index({ userId: 1, status: 1, updatedAt: -1 });

export type CommunityMember = InferSchemaType<typeof communityMemberSchema>;
export const CommunityMemberModel =
  (models.CommunityMember as Model<CommunityMember>)
  || model<CommunityMember>("CommunityMember", communityMemberSchema);