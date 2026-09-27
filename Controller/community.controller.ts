import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { CommunityModel } from "../models/Community/Community.model";
import { CommunityMemberModel } from "../models/Community/CommunityMember.model";
import { CommunityMembershipOrderModel } from "../models/Community/CommunityMembershipOrder.model";
import { AppError } from "../utils/AppError";
import { communityCodeLookupHash } from "../utils/communityCode.utils";
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
  const paid = community.membershipType !== "premium" || community.ownerId.toString() === userId || Boolean(userId && await CommunityMembershipOrderModel.exists({
    communityId: community._id, buyerId: userId, status: "paid",
  }));
  if (community.visibility === "private" && (!canViewPrivate || !paid)) {
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
  const session = await mongoose.startSession();
  let community;
  try {
    await session.withTransaction(async () => {
      const [createdCommunity] = await CommunityModel.create([{
        ...communityInput,
        ...(accessCode ? {
          accessCodeHash: await bcrypt.hash(accessCode, 12),
          accessCodeLookupHash: communityCodeLookupHash(accessCode),
        } : {}),
        ownerId: userId,
        members: [userId],
        slug: communitySlug(request.body.name),
      }], { session });
      if (!createdCommunity) throw new AppError(500, "Community could not be created", "COMMUNITY_CREATE_FAILED");
      community = createdCommunity;
      await CommunityMemberModel.create([{
        communityId: createdCommunity._id,
        userId,
        role: "owner",
        status: "active",
      }], { session });
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      throw new AppError(409, "Community code or name is already in use", "COMMUNITY_CONFLICT");
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return sendSuccess(response, 201, "Community created", { community });
};

export const resolveCommunityCode = async (request: Request, response: Response): Promise<Response> => {
  const codeHash = communityCodeLookupHash(request.body.accessCode as string);
  const community = await CommunityModel.findOne({
    visibility: "private",
    joinPolicy: { $in: ["access_code", "approval", "open"] },
    accessCodeLookupHash: codeHash,
  }).select("+accessCodeHash");
  if (!community?.accessCodeHash || !await bcrypt.compare(request.body.accessCode, community.accessCodeHash)) {
    throw new AppError(404, "Community was not found", "COMMUNITY_NOT_FOUND");
  }
  return sendSuccess(response, 200, "Community found", {
    community: {
      id: community._id.toString(),
      name: community.name,
      imageUrl: community.imageUrl || "",
      visibility: community.visibility,
      joinPolicy: community.joinPolicy,
    },
  });
};

export const updateCommunity = async (request: Request, response: Response): Promise<Response> => {
  const { accessCode, ...communityInput } = request.body as { accessCode?: string; membershipType?: "free" | "premium"; visibility?: "public" | "private" };
  const update = {
    ...communityInput,
    ...(accessCode ? { accessCodeHash: await bcrypt.hash(accessCode, 12), accessCodeLookupHash: communityCodeLookupHash(accessCode) } : {}),
  };
  const existing = await CommunityModel.findOne({ _id: request.params.id as string, ownerId: request.auth?.id });
  if (!existing) throw new AppError(404, "Community was not found", "COMMUNITY_NOT_FOUND");
  const nextType = communityInput.membershipType || existing.membershipType;
  const nextVisibility = communityInput.visibility || existing.visibility;
  if (nextType === "premium" && (nextVisibility !== "public" || existing.joinPolicy !== "open")) {
    throw new AppError(422, "Premium communities must be public with open joining", "COMMUNITY_PREMIUM_POLICY_INVALID");
  }
  if (existing.membershipType !== "premium" && nextType === "premium") {
    const otherMembers = await CommunityMemberModel.exists({ communityId: existing._id, userId: { $ne: request.auth?.id }, status: "active" });
    if (otherMembers || existing.members.some((memberId) => memberId.toString() !== request.auth?.id)) {
      throw new AppError(409, "Remove existing free members before enabling paid membership", "COMMUNITY_PREMIUM_CONVERSION_BLOCKED");
    }
  }
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
