import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { CommunityModel } from "../models/Community/Community.model";
import { CommunityContentModel } from "../models/Community/CommunityContent.model";
import { CommunityJoinRequestModel } from "../models/Community/CommunityJoinRequest.model";
import { CommunityInviteModel } from "../models/Community/CommunityInvite.model";
import { CommunityMemberModel, type CommunityMember } from "../models/Community/CommunityMember.model";
import { CommunityMembershipOrderModel } from "../models/Community/CommunityMembershipOrder.model";
import { UserModel } from "../models/Auth/User.model";
import {
  getCommunityAndMembership,
  requireActiveCommunityMember,
  requireCommunityModerator,
  requireCommunityOwner,
  ensureCommunityMemberRecords,
} from "../utils/communityAccess.utils";
import { AppError } from "../utils/AppError";
import { communityCodeLookupHash } from "../utils/communityCode.utils";
import { sendSuccess } from "../utils/response.utils";

const toViewerMembership = (membership: CommunityMember | null) => {
  if (!membership) return null;
  return {
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt.toISOString(),
    muted: membership.muted,
    notificationLevel: membership.notificationLevel || (membership.muted ? "muted" : "all"),
  };
};

const toMemberResponse = (membership: CommunityMember) => {
  const user = membership.userId as unknown as {
    _id: { toString(): string };
    firstName: string;
    lastName: string;
    avatarUrl?: string;
    state?: string;
    lga?: string;
  };
  return {
    user: {
      _id: user._id.toString(),
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl || "",
      state: user.state || "",
      lga: user.lga || "",
    },
    communityRole: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt.toISOString(),
  };
};

const emitMemberUpdate = async (request: Request, userId: string): Promise<void> => {
  const member = await CommunityMemberModel.findOne({
    communityId: request.params.id as string,
    userId,
  }).populate("userId", "firstName lastName avatarUrl state lga");
  if (member) request.app.get("io")?.to("community:" + (request.params.id as string)).emit("community:member:updated", toMemberResponse(member));
};
const syncLegacyMembershipArrays = async (
  communityId: string,
  userId: string,
  role: string,
  active: boolean,
): Promise<void> => {
  if (!active) {
    await CommunityModel.updateOne(
      { _id: communityId },
      { $pull: { members: userId, moderators: userId } },
    );
    return;
  }
  await CommunityModel.updateOne({ _id: communityId }, { $addToSet: { members: userId } });
  await CommunityModel.updateOne(
    { _id: communityId },
    role === "moderator"
      ? { $addToSet: { moderators: userId } }
      : { $pull: { moderators: userId } },
  );
};

export const listMyCommunities = async (request: Request, response: Response): Promise<Response> => {
  // Mirror legacy member arrays once so existing communities appear in the new membership-backed screen.
  const legacyCommunities = await CommunityModel.find({
    isActive: { $ne: false },
    $or: [{ ownerId: request.auth?.id }, { members: request.auth?.id }, { moderators: request.auth?.id }],
  });
  await Promise.all(legacyCommunities.map(ensureCommunityMemberRecords));
  const page = Number(request.query.page || 1);
  const limit = Number(request.query.limit || 20);
  const role = typeof request.query.role === "string" ? request.query.role : undefined;
  const status = typeof request.query.status === "string" ? request.query.status : undefined;
  const search = typeof request.query.search === "string" ? request.query.search.trim().toLowerCase() : "";
  const unreadOnly = request.query.unreadOnly === "true";
  const query: Record<string, unknown> = { userId: request.auth?.id, status: status || { $in: ["active", "pending"] } };
  if (role) query.role = role;

  const memberships = await CommunityMemberModel.find(query).populate("communityId").sort({ updatedAt: -1 });
  const paidOrders = await CommunityMembershipOrderModel.find({ buyerId: request.auth?.id, status: "paid" }).select("communityId");
  const paidCommunityIds = new Set(paidOrders.map((order) => order.communityId.toString()));
  const summaries = await Promise.all(memberships.map(async (membership) => {
    const community = membership.communityId as unknown as {
      _id: { toString(): string };
      ownerId: { toString(): string };
      name: string;
      slug: string;
      description: string;
      imageUrl?: string;
      coverImageUrl?: string;
      avatarImageUrl?: string;
      category: string;
      state?: string;
      lga?: string;
      visibility: string;
      membershipType: string;
      membershipPriceKobo: number;
      isActive?: boolean;
      lastActivityAt?: Date;
      createdAt: Date;
    } | null;
    if (!community || community.isActive === false) return null;
    if (community.membershipType === "premium" && membership.status === "active"
      && community.ownerId.toString() !== request.auth?.id && !paidCommunityIds.has(community._id.toString())) return null;

    const unreadQuery: Record<string, unknown> = {
      communityId: community._id,
      kind: "message",
      deletedAt: { $exists: false },
      authorId: { $ne: request.auth?.id },
    };
    if (membership.lastReadAt) unreadQuery.createdAt = { $gt: membership.lastReadAt };
    const [memberCount, unreadCount] = await Promise.all([
      CommunityMemberModel.countDocuments({ communityId: community._id, status: "active" } as never),
      CommunityContentModel.countDocuments(unreadQuery as never),
    ]);
    return {
      _id: community._id.toString(),
      ownerId: community.ownerId.toString(),
      name: community.name,
      slug: community.slug,
      description: community.description,
      coverImageUrl: community.coverImageUrl || community.imageUrl || "",
      avatarImageUrl: community.avatarImageUrl || community.imageUrl || "",
      category: community.category,
      state: community.state || "",
      lga: community.lga || "",
      visibility: community.visibility,
      membershipType: community.membershipType,
      membershipPriceKobo: community.membershipPriceKobo,
      memberCount,
      viewerMembership: toViewerMembership(membership),
      unreadCount,
      lastActivityAt: community.lastActivityAt?.toISOString() || null,
      createdAt: community.createdAt.toISOString(),
    };
  }));

  const filtered = summaries.filter((item): item is NonNullable<typeof item> => {
    if (!item) return false;
    if (search && !(item.name + " " + item.description).toLowerCase().includes(search)) return false;
    return !unreadOnly || item.unreadCount > 0;
  });
  const total = filtered.length;
  return sendSuccess(response, 200, "My communities retrieved", {
    communities: filtered.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
};

export const listMyCommunityJoinRequests = async (request: Request, response: Response): Promise<Response> => {
  const page = Number(request.query.page || 1);
  const limit = Number(request.query.limit || 20);
  const query = { requesterId: request.auth?.id, status: "pending" as const };
  const [joinRequests, total] = await Promise.all([
    CommunityJoinRequestModel.find(query).populate("communityId", "name imageUrl visibility membershipType membershipPriceKobo joinPolicy")
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    CommunityJoinRequestModel.countDocuments(query),
  ]);
  return sendSuccess(response, 200, "My community join requests retrieved", {
    joinRequests,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
};

export const getCommunityRules = async (request: Request, response: Response): Promise<Response> => {
  const userId = request.auth?.id;
  const result = userId
    ? await getCommunityAndMembership(request.params.id as string, userId)
    : { community: await CommunityModel.findById(request.params.id as string), membership: null };
  const community = result.community;
  if (!community || community.isActive === false || (community.visibility === "private" && result.membership?.status !== "active")) {
    throw new AppError(404, "Community was not found", "COMMUNITY_NOT_FOUND");
  }

  await community.populate("rulesUpdatedBy", "firstName lastName");
  const updatedBy = community.rulesUpdatedBy as unknown as {
    _id: { toString(): string };
    firstName: string;
    lastName: string;
  } | null;
  return sendSuccess(response, 200, "Community rules retrieved", {
    rules: {
      communityId: community._id.toString(),
      introduction: community.rulesIntroduction,
      rules: community.rules.map((rule) => ({
        _id: rule._id.toString(),
        title: rule.title,
        description: rule.description,
        order: rule.order,
      })),
      consequences: community.consequences,
      updatedAt: (community.rulesUpdatedAt || community.updatedAt).toISOString(),
      updatedBy: updatedBy
        ? { _id: updatedBy._id.toString(), firstName: updatedBy.firstName, lastName: updatedBy.lastName }
        : null,
    },
  });
};

export const replaceCommunityRules = async (request: Request, response: Response): Promise<Response> => {
  const { community } = await requireCommunityModerator(request.params.id as string, request.auth?.id as string);
  community.rulesIntroduction = request.body.introduction;
  community.rules = request.body.rules;
  community.consequences = request.body.consequences;
  community.rulesUpdatedAt = new Date();
  community.rulesUpdatedBy = request.auth?.id as never;
  await community.save();
  return getCommunityRules(request, response);
};

const settingsPayload = (community: {
  joinPolicy: string;
  messagePermission: string;
  membersCanCreatePosts: boolean;
  membersCanInvite: boolean;
  showMemberList: boolean;
}) => ({
  joinPolicy: community.joinPolicy,
  messagePermission: community.messagePermission,
  membersCanCreatePosts: community.membersCanCreatePosts,
  membersCanInvite: community.membersCanInvite,
  showMemberList: community.showMemberList,
});

export const getCommunitySettings = async (request: Request, response: Response): Promise<Response> => {
  const { community } = await requireActiveCommunityMember(request.params.id as string, request.auth?.id as string);
  return sendSuccess(response, 200, "Community settings retrieved", { settings: settingsPayload(community) });
};

export const updateCommunitySettings = async (request: Request, response: Response): Promise<Response> => {
  const { community } = await requireCommunityModerator(request.params.id as string, request.auth?.id as string);
  const { accessCode, ...settings } = request.body as { accessCode?: string; joinPolicy?: "open" | "approval" | "invite_only" | "access_code" };
  if (community.membershipType === "premium" && settings.joinPolicy && settings.joinPolicy !== "open") {
    throw new AppError(422, "Premium communities must use open joining", "COMMUNITY_PREMIUM_POLICY_INVALID");
  }
  community.set(settings);
  if (accessCode) {
    community.accessCodeHash = await bcrypt.hash(accessCode, 12);
    community.accessCodeLookupHash = communityCodeLookupHash(accessCode);
  }
  await community.save();
  return sendSuccess(response, 200, "Community settings updated", { settings: settingsPayload(community) });
};

export const listCommunityMembersDetailed = async (request: Request, response: Response): Promise<Response> => {
  const { community, membership } = await requireActiveCommunityMember(request.params.id as string, request.auth?.id as string);
  if (!community.showMemberList && membership.role === "member") {
    throw new AppError(403, "The community member list is restricted", "COMMUNITY_MEMBER_REQUIRED");
  }
  const page = Number(request.query.page || 1);
  const limit = Number(request.query.limit || 20);
  const role = typeof request.query.role === "string" ? request.query.role : undefined;
  const status = typeof request.query.status === "string" ? request.query.status : "active";
  const query: Record<string, unknown> = { communityId: community._id, status };
  if (role) query.role = role;
  const [records, total] = await Promise.all([
    CommunityMemberModel.find(query).populate("userId", "firstName lastName avatarUrl state lga")
      .sort({ role: 1, joinedAt: 1 }).skip((page - 1) * limit).limit(limit),
    CommunityMemberModel.countDocuments(query),
  ]);
  const search = typeof request.query.search === "string" ? request.query.search.trim().toLowerCase() : "";
  const members = records.filter((record) => {
    if (!search) return true;
    const user = record.userId as unknown as { firstName: string; lastName: string };
    return (user.firstName + " " + user.lastName).toLowerCase().includes(search);
  }).map(toMemberResponse);
  return sendSuccess(response, 200, "Community members retrieved", {
    members,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
};

export const updateCommunityMember = async (request: Request, response: Response): Promise<Response> => {
  const { community, membership: actor } = await requireCommunityModerator(request.params.id as string, request.auth?.id as string);
  const target = await CommunityMemberModel.findOne({ communityId: request.params.id as string, userId: request.params.userId as string })
    .populate("userId", "firstName lastName avatarUrl state lga");
  if (!target) throw new AppError(404, "Community member was not found", "COMMUNITY_MEMBER_REQUIRED");
  if (target.role === "owner") throw new AppError(409, "The community owner cannot be changed here", "COMMUNITY_OWNER_REQUIRED");
  if (request.body.role && actor.role !== "owner") throw new AppError(403, "Only the community owner can change roles", "COMMUNITY_OWNER_REQUIRED");
  if (request.body.status && actor.role === "moderator" && target.role === "moderator") {
    throw new AppError(403, "Moderators cannot change another moderator", "COMMUNITY_OWNER_REQUIRED");
  }
  if (request.body.status === "active" && target.status !== "active" && community.membershipType === "premium") {
    const paid = await CommunityMembershipOrderModel.exists({ communityId: community._id, buyerId: request.params.userId as string, status: "paid" });
    if (!paid) throw new AppError(409, "Premium membership payment is required", "COMMUNITY_MEMBERSHIP_PAYMENT_REQUIRED");
  }

  target.set(request.body);
  await target.save();
  await syncLegacyMembershipArrays(request.params.id as string, request.params.userId as string, target.role, target.status === "active");
  return sendSuccess(response, 200, "Community member updated", { member: toMemberResponse(target) });
};

export const removeCommunityMember = async (request: Request, response: Response): Promise<Response> => {
  const { membership: actor } = await requireCommunityModerator(request.params.id as string, request.auth?.id as string);
  const target = await CommunityMemberModel.findOne({ communityId: request.params.id as string, userId: request.params.userId as string });
  if (!target || target.status !== "active") throw new AppError(404, "Community member was not found", "COMMUNITY_MEMBER_REQUIRED");
  if (target.role === "owner") throw new AppError(409, "The owner cannot be removed", "COMMUNITY_OWNER_REQUIRED");
  if (actor.role === "moderator" && target.role === "moderator") throw new AppError(403, "Moderators cannot remove another moderator", "COMMUNITY_OWNER_REQUIRED");
  target.status = "removed";
  await target.save();
  await syncLegacyMembershipArrays(request.params.id as string, request.params.userId as string, target.role, false);
  return sendSuccess(response, 200, "Community member removed", { removedUserId: request.params.userId });
};

export const banCommunityMember = async (request: Request, response: Response): Promise<Response> => {
  await requireCommunityModerator(request.params.id as string, request.auth?.id as string);
  const { community } = await getCommunityAndMembership(request.params.id as string, request.params.userId as string);
  let target = await CommunityMemberModel.findOne({ communityId: community._id, userId: request.params.userId as string });
  if (target?.role === "owner") throw new AppError(409, "The owner cannot be banned", "COMMUNITY_OWNER_REQUIRED");
  if (!target) {
    target = await CommunityMemberModel.create({
      communityId: community._id,
      userId: request.params.userId as string,
      status: "banned",
      bannedReason: request.body.reason,
      bannedExpiresAt: request.body.expiresAt,
    });
  } else {
    target.status = "banned";
    target.bannedReason = request.body.reason;
    target.bannedExpiresAt = request.body.expiresAt;
    await target.save();
  }
  await syncLegacyMembershipArrays(request.params.id as string, request.params.userId as string, target.role, false);
  return sendSuccess(response, 200, "Community member banned", {
    userId: request.params.userId,
    status: "banned",
    reason: target.bannedReason,
    expiresAt: target.bannedExpiresAt?.toISOString() || null,
  });
};

export const unbanCommunityMember = async (request: Request, response: Response): Promise<Response> => {
  await requireCommunityModerator(request.params.id as string, request.auth?.id as string);
  const target = await CommunityMemberModel.findOneAndUpdate(
    { communityId: request.params.id as string, userId: request.params.userId as string, status: "banned" },
    { status: "removed", bannedReason: undefined, bannedExpiresAt: undefined },
    { new: true },
  );
  if (!target) throw new AppError(404, "Banned community member was not found", "COMMUNITY_MEMBER_BANNED");
  return sendSuccess(response, 200, "Community member unbanned", { userId: request.params.userId, status: "removed" });
};

export const createCommunityJoinRequest = async (request: Request, response: Response): Promise<Response> => {
  const { community, membership } = await getCommunityAndMembership(request.params.id as string, request.auth?.id as string);
  if (membership?.status === "banned" && (!membership.bannedExpiresAt || membership.bannedExpiresAt > new Date())) {
    throw new AppError(403, "You are banned from this community", "COMMUNITY_MEMBER_BANNED");
  }
  if (membership?.status === "active") throw new AppError(409, "You are already a community member", "COMMUNITY_MEMBERSHIP_EXISTS");

  if (community.visibility === "private" && (community.joinPolicy === "approval" || community.joinPolicy === "open")) {
    const securedCommunity = await CommunityModel.findById(community._id).select("+accessCodeHash");
    const validCode = Boolean(request.body.accessCode && securedCommunity?.accessCodeHash
      && await bcrypt.compare(request.body.accessCode, securedCommunity.accessCodeHash));
    const invites = request.body.inviteToken ? await CommunityInviteModel.find({
      communityId: community._id, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() },
    }).select("+tokenHash") : [];
    const validInvite = (await Promise.all(invites.map(async (invite) =>
      invite.uses < invite.maxUses && await bcrypt.compare(request.body.inviteToken, invite.tokenHash)
    ))).some(Boolean);
    if (!validCode && !validInvite) {
      throw new AppError(422, "A valid community code or invite is required", "COMMUNITY_ACCESS_REQUIRED");
    }
  }

  const activateMembership = async () => {
    const activeMembership = await CommunityMemberModel.findOneAndUpdate(
      { communityId: community._id, userId: request.auth?.id },
      { $set: { status: "active", role: "member", joinedAt: new Date(), muted: false, bannedReason: undefined, bannedExpiresAt: undefined } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await syncLegacyMembershipArrays(community._id.toString(), request.auth?.id as string, "member", true);
    return sendSuccess(response, 201, "Community joined", { membership: toViewerMembership(activeMembership) });
  };
  const preparePremiumCheckout = async () => {
    const joinRequest = await CommunityJoinRequestModel.findOneAndUpdate(
      { communityId: community._id, requesterId: request.auth?.id, status: "approved" },
      { $setOnInsert: { communityId: community._id, requesterId: request.auth?.id, status: "approved", message: request.body.message || "" } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await CommunityMemberModel.updateOne(
      { communityId: community._id, userId: request.auth?.id },
      { $set: { role: "member", status: "pending" }, $setOnInsert: { communityId: community._id, userId: request.auth?.id } },
      { upsert: true },
    );
    await joinRequest.populate("requesterId", "firstName lastName avatarUrl");
    return sendSuccess(response, 201, "Community membership checkout required", { joinRequest });
  };
  if (community.joinPolicy === "open" && community.visibility === "public" && community.membershipType === "free") {
    return activateMembership();
  }
  if (community.membershipType === "premium" && community.joinPolicy === "open" && community.visibility === "public") {
    throw new AppError(422, "Premium community membership must be paid before activation", "COMMUNITY_MEMBERSHIP_PAYMENT_REQUIRED");
  }
  if (community.joinPolicy === "access_code") {
    const securedCommunity = await CommunityModel.findById(community._id).select("+accessCodeHash");
    const valid = Boolean(request.body.accessCode && securedCommunity?.accessCodeHash
      && await bcrypt.compare(request.body.accessCode, securedCommunity.accessCodeHash));
    if (!valid) throw new AppError(422, "The community access code is invalid", "COMMUNITY_ACCESS_CODE_INVALID");
    if (community.membershipType === "premium") return preparePremiumCheckout();
    return activateMembership();
  }
  if (community.joinPolicy === "invite_only") {
    if (!request.body.inviteToken) throw new AppError(422, "A valid community invite is required", "COMMUNITY_INVITE_INVALID");
    const invites = await CommunityInviteModel.find({
      communityId: community._id,
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    }).select("+tokenHash");
    const invite = (await Promise.all(invites.map(async (candidate) => ({
      candidate,
      valid: candidate.uses < candidate.maxUses && await bcrypt.compare(request.body.inviteToken, candidate.tokenHash),
    })))).find((candidate) => candidate.valid)?.candidate;
    if (!invite) throw new AppError(422, "The community invite is invalid or expired", "COMMUNITY_INVITE_INVALID");
    const consumed = await CommunityInviteModel.updateOne(
      { _id: invite._id, uses: { $lt: invite.maxUses }, expiresAt: { $gt: new Date() }, revokedAt: { $exists: false } },
      { $inc: { uses: 1 } },
    );
    if (consumed.modifiedCount !== 1) throw new AppError(422, "The community invite is no longer available", "COMMUNITY_INVITE_INVALID");
    if (community.membershipType === "premium") return preparePremiumCheckout();
    return activateMembership();
  }
  if (community.membershipType === "premium" && community.joinPolicy === "open") return preparePremiumCheckout();
  try {
    const joinRequest = await CommunityJoinRequestModel.create({
      communityId: community._id,
      requesterId: request.auth?.id,
      message: request.body.message || "",
    });
    await joinRequest.populate("requesterId", "firstName lastName avatarUrl");
    return sendSuccess(response, 201, "Community join request created", { joinRequest });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      throw new AppError(409, "A pending join request already exists", "COMMUNITY_JOIN_REQUEST_EXISTS");
    }
    throw error;
  }
};

export const createCommunityInvite = async (request: Request, response: Response): Promise<Response> => {
  const { community } = await requireCommunityModerator(request.params.id as string, request.auth?.id as string);
  const token = randomBytes(32).toString("base64url");
  const invite = await CommunityInviteModel.create({
    communityId: community._id,
    tokenHash: await bcrypt.hash(token, 12),
    createdBy: request.auth?.id,
    maxUses: request.body.maxUses || 1,
    expiresAt: request.body.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  return sendSuccess(response, 201, "Community invite created", {
    invite: {
      _id: invite._id.toString(),
      token,
      expiresAt: invite.expiresAt.toISOString(),
      maxUses: invite.maxUses,
    },
  });
};
export const listCommunityJoinRequests = async (request: Request, response: Response): Promise<Response> => {
  await requireCommunityModerator(request.params.id as string, request.auth?.id as string);
  const page = Number(request.query.page || 1);
  const limit = Number(request.query.limit || 20);
  const status = typeof request.query.status === "string" ? request.query.status : "pending";
  const query = { communityId: request.params.id as string, status };
  const [joinRequests, total] = await Promise.all([
    CommunityJoinRequestModel.find(query as never).populate("requesterId", "firstName lastName avatarUrl")
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    CommunityJoinRequestModel.countDocuments(query as never),
  ]);
  return sendSuccess(response, 200, "Community join requests retrieved", {
    joinRequests,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
};

export const reviewCommunityJoinRequest = async (request: Request, response: Response): Promise<Response> => {
  const { community } = await requireCommunityModerator(request.params.id as string, request.auth?.id as string);
  const joinRequest = await CommunityJoinRequestModel.findOne({
    _id: request.params.requestId as string,
    communityId: request.params.id as string,
    status: "pending",
  });
  if (!joinRequest) throw new AppError(404, "Community join request was not found", "COMMUNITY_JOIN_REQUEST_NOT_FOUND");

  joinRequest.status = request.body.status;
  joinRequest.reviewNote = request.body.note;
  joinRequest.reviewedAt = new Date();
  joinRequest.reviewedBy = request.auth?.id as never;
  await joinRequest.save();

  let member;
  if (joinRequest.status === "approved") {
    const paid = community.membershipType === "premium" && Boolean(await CommunityMembershipOrderModel.exists({
      communityId: community._id,
      buyerId: joinRequest.requesterId,
      status: "paid",
    }));
    const activate = community.membershipType === "free" || paid;
    member = await CommunityMemberModel.findOneAndUpdate(
      { communityId: joinRequest.communityId, userId: joinRequest.requesterId },
      { $set: { role: "member", status: activate ? "active" : "pending", joinedAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).populate("userId", "firstName lastName avatarUrl state lga");
    if (activate) {
      await syncLegacyMembershipArrays(request.params.id as string, joinRequest.requesterId.toString(), "member", true);
      await emitMemberUpdate(request, joinRequest.requesterId.toString());
    }
  }
  await joinRequest.populate("requesterId", "firstName lastName avatarUrl");
  return sendSuccess(response, 200, "Community join request reviewed", {
    joinRequest,
    ...(member ? { member: toMemberResponse(member) } : {}),
  });
};

export const cancelMyCommunityJoinRequest = async (request: Request, response: Response): Promise<Response> => {
  const joinRequest = await CommunityJoinRequestModel.findOneAndUpdate(
    { communityId: request.params.id as string, requesterId: request.auth?.id, status: "pending" },
    { status: "cancelled" },
    { new: true },
  );
  if (!joinRequest) throw new AppError(404, "Pending community join request was not found", "COMMUNITY_JOIN_REQUEST_NOT_FOUND");
  return sendSuccess(response, 200, "Community join request cancelled", {
    joinRequestId: joinRequest._id.toString(),
    status: "cancelled",
  });
};

export const transferCommunityOwnership = async (request: Request, response: Response): Promise<Response> => {
  const { community } = await requireCommunityOwner(request.params.id as string, request.auth?.id as string);
  if (request.body.currentPassword) {
    const currentUser = await UserModel.findById(request.auth?.id).select("+passwordHash");
    if (!currentUser || !(await bcrypt.compare(request.body.currentPassword, currentUser.passwordHash))) {
      throw new AppError(400, "Password confirmation is incorrect", "PASSWORD_CONFIRMATION_FAILED");
    }
  }
  const nextOwner = await CommunityMemberModel.findOne({
    communityId: community._id,
    userId: request.body.newOwnerId,
    status: "active",
  });
  if (!nextOwner) throw new AppError(422, "The new owner must be an active community member", "COMMUNITY_MEMBER_REQUIRED");

  const previousOwnerId = community.ownerId.toString();
  community.ownerId = request.body.newOwnerId;
  await Promise.all([
    community.save(),
    CommunityMemberModel.updateOne({ communityId: community._id, userId: previousOwnerId }, { role: "moderator" }),
    CommunityMemberModel.updateOne({ communityId: community._id, userId: request.body.newOwnerId }, { role: "owner" }),
  ]);
  await emitMemberUpdate(request, previousOwnerId);
  await emitMemberUpdate(request, request.body.newOwnerId);
  return sendSuccess(response, 200, "Community ownership transferred", {
    communityId: community._id.toString(),
    previousOwnerId,
    newOwnerId: request.body.newOwnerId,
    transferredAt: new Date().toISOString(),
  });
};
