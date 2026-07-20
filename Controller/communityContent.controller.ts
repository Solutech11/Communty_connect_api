import type { Request, Response } from "express";
import { CommunityModel } from "../models/Community/Community.model";
import { CommunityContentModel } from "../models/Community/CommunityContent.model";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/response.utils";

type CommunityContentKind = "post" | "announcement" | "message";

const isDuplicateKeyError = (error: unknown): boolean => {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === 11000;
};

const requireCommunityMember = async (communityId: string, userId: string) => {
  const community = await CommunityModel.findOne({
    _id: communityId,
    $or: [{ ownerId: userId }, { moderators: userId }, { members: userId }],
  }).select("ownerId moderators");

  if (!community) {
    throw new AppError(404, "Community room was not found", "COMMUNITY_ROOM_NOT_FOUND");
  }

  return community;
};

const listContent = async (
  request: Request,
  response: Response,
  kind: CommunityContentKind,
  responseKey: "posts" | "announcements" | "messages",
): Promise<Response> => {
  await requireCommunityMember(request.params.id as string, request.auth?.id as string);
  const page = Number(request.query.page || 1);
  const limit = Number(request.query.limit || 20);
  const query = {
    communityId: request.params.id as string,
    kind,
    deletedAt: { $exists: false },
  };
  const [items, total] = await Promise.all([
    CommunityContentModel.find(query)
      .populate("authorId", "firstName lastName avatarUrl")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    CommunityContentModel.countDocuments(query),
  ]);

  return sendSuccess(response, 200, `Community ${responseKey} retrieved`, {
    [responseKey]: items.reverse(),
    pagination: { page, limit, total },
  });
};

export const listCommunityPosts = async (
  request: Request,
  response: Response,
): Promise<Response> => listContent(request, response, "post", "posts");

export const listCommunityAnnouncements = async (
  request: Request,
  response: Response,
): Promise<Response> => listContent(request, response, "announcement", "announcements");

export const listCommunityMessages = async (
  request: Request,
  response: Response,
): Promise<Response> => listContent(request, response, "message", "messages");

const createContent = async (
  request: Request,
  response: Response,
  kind: Exclude<CommunityContentKind, "message">,
  responseKey: "post" | "announcement",
): Promise<Response> => {
  const community = await requireCommunityMember(
    request.params.id as string,
    request.auth?.id as string,
  );

  if (
    kind === "announcement"
    && community.ownerId.toString() !== request.auth?.id
    && !community.moderators.some((id) => id.toString() === request.auth?.id)
  ) {
    throw new AppError(
      403,
      "Only community owners and moderators can publish announcements",
      "COMMUNITY_MODERATOR_REQUIRED",
    );
  }

  const item = await CommunityContentModel.create({
    communityId: community._id,
    authorId: request.auth?.id,
    kind,
    text: request.body.text,
    imageUrl: request.body.imageUrl,
  });
  await item.populate("authorId", "firstName lastName avatarUrl");

  request.app.get("io")?.to(`community:${community._id.toString()}`).emit(
    `community:${kind}:new`,
    item,
  );
  return sendSuccess(response, 201, `Community ${responseKey} created`, {
    [responseKey]: item,
  });
};

export const createCommunityPost = async (
  request: Request,
  response: Response,
): Promise<Response> => createContent(request, response, "post", "post");

export const createCommunityAnnouncement = async (
  request: Request,
  response: Response,
): Promise<Response> => createContent(request, response, "announcement", "announcement");

export const sendCommunityMessage = async (
  request: Request,
  response: Response,
): Promise<Response> => {
  const community = await requireCommunityMember(
    request.params.id as string,
    request.auth?.id as string,
  );
  const lookup = {
    communityId: community._id,
    authorId: request.auth?.id,
    kind: "message" as const,
    clientMessageId: request.body.clientMessageId,
  };
  const existing = await CommunityContentModel.findOne(lookup);

  if (existing) {
    await existing.populate("authorId", "firstName lastName avatarUrl");
    return sendSuccess(response, 200, "Community message retrieved", { message: existing });
  }

  let message;
  try {
    message = await CommunityContentModel.create({
      ...lookup,
      text: request.body.text,
      imageUrl: request.body.imageUrl,
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }

    const duplicate = await CommunityContentModel.findOne(lookup)
      .populate("authorId", "firstName lastName avatarUrl");
    if (!duplicate) {
      throw error;
    }
    return sendSuccess(response, 200, "Community message retrieved", { message: duplicate });
  }

  await message.populate("authorId", "firstName lastName avatarUrl");
  request.app.get("io")?.to(`community:${community._id.toString()}`).emit(
    "community:message:new",
    message,
  );
  return sendSuccess(response, 201, "Community message sent", { message });
};
