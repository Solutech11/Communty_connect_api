import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import type { Request, Response } from "express";
import { CommunityModel } from "../models/Community/Community.model";
import { CommunityMemberModel } from "../models/Community/CommunityMember.model";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/response.utils";

const communitySlug = (name: string): string => {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${randomBytes(3).toString("hex")}`;
};

export const listCommunities = async (request: Request, response: Response): Promise<Response> => {
  const { page = "1", limit = "20", search, category, state, lga } = request.query as Record<string, string>;
  const query: Record<string, unknown> = { visibility: "public" };

  if (search) {
    query.$text = { $search: search };
  }
  if (category) {
    query.category = category;
  }
  if (state) {
    query.state = state;
  }
  if (lga) {
    query.lga = lga;
  }

  const numericPage = Number(page);
  const numericLimit = Number(limit);
  const [communities, total] = await Promise.all([
    CommunityModel.find(query)
      .populate("ownerId", "firstName lastName avatarUrl")
      .sort({ createdAt: -1 })
      .skip((numericPage - 1) * numericLimit)
      .limit(numericLimit),
    CommunityModel.countDocuments(query),
  ]);

  return sendSuccess(response, 200, "Communities retrieved", {
    communities,
    pagination: { page: numericPage, limit: numericLimit, total },
  });
};

export const getCommunity = async (request: Request, response: Response): Promise<Response> => {
  const community = await CommunityModel.findById(request.params.id as string);

  if (!community) {
    throw new AppError(404, "Community was not found", "COMMUNITY_NOT_FOUND");
  }

  const userId = request.auth?.id;
  const canViewPrivate = Boolean(
    userId &&
      (community.ownerId.toString() === userId ||
        community.members.some((memberId) => memberId.toString() === userId)),
  );

  if (community.visibility === "private" && !canViewPrivate) {
    throw new AppError(404, "Community was not found", "COMMUNITY_NOT_FOUND");
  }

  await community.populate([
    { path: "ownerId", select: "firstName lastName avatarUrl" },
    { path: "moderators", select: "firstName lastName avatarUrl" },
  ]);

  return sendSuccess(response, 200, "Community retrieved", { community });
};

export const createCommunity = async (request: Request, response: Response): Promise<Response> => {
    const userId = request.auth?.id;
  if (!userId) throw new AppError(401, "Authentication is required", "UNAUTHENTICATED");
const { accessCode, ...communityInput } = request.body as { accessCode?: string };
  const community = await CommunityModel.create({
    ...communityInput,
    ...(accessCode ? { accessCodeHash: await bcrypt.hash(accessCode, 12) } : {}),
    ownerId: userId,
    members: [userId],
    slug: communitySlug(request.body.name),
  });
  await CommunityMemberModel.create({
    communityId: community._id,
    userId,
    role: "owner",
    status: "active",
  });
  return sendSuccess(response, 201, "Community created", { community });
};

export const updateCommunity = async (request: Request, response: Response): Promise<Response> => {
  const { accessCode, ...communityInput } = request.body as { accessCode?: string };
  const update = {
    ...communityInput,
    ...(accessCode ? { accessCodeHash: await bcrypt.hash(accessCode, 12) } : {}),
  };
  const community = await CommunityModel.findOneAndUpdate(
    { _id: request.params.id as string, ownerId: request.auth?.id },
    { $set: update },
    { new: true, runValidators: true },
  );
  if (!community) throw new AppError(404, "Community was not found", "COMMUNITY_NOT_FOUND");
  return sendSuccess(response, 200, "Community updated", {
    community: {
      ...community.toJSON(),
      coverImageUrl: community.coverImageUrl || community.imageUrl || "",
      avatarImageUrl: community.avatarImageUrl || community.imageUrl || "",
      settings: {
        joinPolicy: community.joinPolicy,
        messagePermission: community.messagePermission,
        membersCanCreatePosts: community.membersCanCreatePosts,
        membersCanInvite: community.membersCanInvite,
        showMemberList: community.showMemberList,
      },
    },
  });
};

export const joinCommunity = async (request: Request, response: Response): Promise<Response> => {
  const community = await CommunityModel.findOne({
    _id: request.params.id as string,
    visibility: "public",
    membershipType: "free",
    joinPolicy: "open",
  });
  if (!community) throw new AppError(404, "Free public community was not found", "COMMUNITY_NOT_FOUND");
  await CommunityMemberModel.findOneAndUpdate(
    { communityId: community._id, userId: request.auth?.id },
    { $set: { role: "member", status: "active", joinedAt: new Date(), muted: false } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await CommunityModel.updateOne({ _id: community._id }, { $addToSet: { members: request.auth?.id } });
  return sendSuccess(response, 200, "Community joined");
};

export const leaveCommunity = async (request: Request, response: Response): Promise<Response> => {
  const community = await CommunityModel.findById(request.params.id as string);
  if (!community) throw new AppError(404, "Community was not found", "COMMUNITY_NOT_FOUND");
  if (community.ownerId.toString() === request.auth?.id) {
    throw new AppError(409, "The owner cannot leave without transferring ownership", "COMMUNITY_OWNER_CANNOT_LEAVE");
  }
  await Promise.all([
    CommunityMemberModel.updateOne(
      { communityId: community._id, userId: request.auth?.id, status: "active" },
      { $set: { status: "removed" } },
    ),
    CommunityModel.updateOne(
      { _id: community._id },
      { $pull: { members: request.auth?.id, moderators: request.auth?.id } },
    ),
  ]);
  return sendSuccess(response, 200, "Community left");
};

export const listMembers = async (request: Request, response: Response): Promise<Response> => {
  const community = await CommunityModel.findOne({
    _id: request.params.id as string,
    $or: [
      { visibility: "public" },
      { ownerId: request.auth?.id },
      { members: request.auth?.id },
    ],
  }).populate("members", "firstName lastName avatarUrl state lga");

  if (!community) {
    throw new AppError(404, "Community was not found", "COMMUNITY_NOT_FOUND");
  }

  return sendSuccess(response, 200, "Community members retrieved", { members: community.members });
};
