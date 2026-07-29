import type { HydratedDocument, Types } from "mongoose";
import { CommunityModel, type Community } from "../models/Community/Community.model";
import {
  CommunityMemberModel,
  type CommunityMember,
} from "../models/Community/CommunityMember.model";
import { AppError } from "./AppError";

type CommunityWithId = HydratedDocument<Community>;

const idValue = (value: Types.ObjectId | string): string => value.toString();

export const ensureCommunityMemberRecords = async (
  community: CommunityWithId,
): Promise<void> => {
  const ownerId = idValue(community.ownerId);
  const moderatorIds = new Set(community.moderators.map(idValue));
  const memberIds = new Set(community.members.map(idValue));
  memberIds.add(ownerId);
  moderatorIds.forEach((moderatorId) => memberIds.add(moderatorId));

  await Promise.all([...memberIds].map(async (userId) => {
    const role = userId === ownerId
      ? "owner"
      : moderatorIds.has(userId)
        ? "moderator"
        : "member";
    await CommunityMemberModel.findOneAndUpdate(
      { communityId: community._id, userId },
      {
        $setOnInsert: {
          communityId: community._id,
          userId,
          role,
          status: "active",
          joinedAt: community.createdAt,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }));
  // Ownership is authoritative even if an older deployment previously wrote a
  // different role into the new membership collection.
  await CommunityMemberModel.updateOne(
    { communityId: community._id, userId: ownerId },
    { $set: { role: "owner", status: "active" } },
  );
};

export const getCommunityAndMembership = async (
  communityId: string,
  userId: string,
): Promise<{ community: CommunityWithId; membership: CommunityMember | null }> => {
  const community = await CommunityModel.findById(communityId) as CommunityWithId | null;
  if (!community) {
    throw new AppError(404, "Community was not found", "COMMUNITY_NOT_FOUND");
  }

  await ensureCommunityMemberRecords(community);
  const membership = await CommunityMemberModel.findOne({ communityId: community._id, userId });
  return { community, membership };
};

export const requireActiveCommunityMember = async (
  communityId: string,
  userId: string,
): Promise<{ community: CommunityWithId; membership: CommunityMember }> => {
  const { community, membership } = await getCommunityAndMembership(communityId, userId);

  if (!membership || membership.status !== "active") {
    throw new AppError(403, "An active community membership is required", "COMMUNITY_MEMBER_REQUIRED");
  }

  return { community, membership };
};

export const requireCommunityModerator = async (
  communityId: string,
  userId: string,
): Promise<{ community: CommunityWithId; membership: CommunityMember }> => {
  const result = await requireActiveCommunityMember(communityId, userId);
  if (result.membership.role !== "owner" && result.membership.role !== "moderator") {
    throw new AppError(403, "A community owner or moderator is required", "COMMUNITY_MODERATOR_REQUIRED");
  }

  return result;
};

export const requireCommunityOwner = async (
  communityId: string,
  userId: string,
): Promise<{ community: CommunityWithId; membership: CommunityMember }> => {
  const result = await requireActiveCommunityMember(communityId, userId);
  if (result.membership.role !== "owner") {
    throw new AppError(403, "The community owner is required", "COMMUNITY_OWNER_REQUIRED");
  }

  return result;
};