import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { CommunityModel } from "../models/Community/Community.model";
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
  const community = await CommunityModel.create({
    ...request.body,
    ownerId: request.auth?.id,
    members: [request.auth?.id],
    slug: communitySlug(request.body.name),
  });
  return sendSuccess(response, 201, "Community created", { community });
};

export const updateCommunity = async (request: Request, response: Response): Promise<Response> => {
  const community = await CommunityModel.findOneAndUpdate(
    { _id: (request.params.id as string), ownerId: request.auth?.id },
    { $set: request.body },
    { new: true, runValidators: true },
  );

  if (!community) {
    throw new AppError(404, "Community was not found", "COMMUNITY_NOT_FOUND");
  }

  return sendSuccess(response, 200, "Community updated", { community });
};

export const joinCommunity = async (request: Request, response: Response): Promise<Response> => {
  const community = await CommunityModel.findOneAndUpdate(
    {
      _id: (request.params.id as string),
      visibility: "public",
      membershipType: { $ne: "premium" },
    },
    { $addToSet: { members: request.auth?.id } },
    { new: true },
  );

  if (!community) {
    throw new AppError(404, "Free public community was not found", "COMMUNITY_NOT_FOUND");
  }

  return sendSuccess(response, 200, "Community joined");
};

export const leaveCommunity = async (request: Request, response: Response): Promise<Response> => {
  const community = await CommunityModel.findById((request.params.id as string));

  if (!community) {
    throw new AppError(404, "Community was not found", "COMMUNITY_NOT_FOUND");
  }

  if (community.ownerId.toString() === request.auth?.id) {
    throw new AppError(409, "The owner cannot leave without transferring ownership", "OWNER_CANNOT_LEAVE");
  }

  await CommunityModel.updateOne(
    { _id: community._id },
    { $pull: { members: request.auth?.id, moderators: request.auth?.id } },
  );
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
