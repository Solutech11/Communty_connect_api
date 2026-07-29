import type { Request, Response } from "express";
import { Types } from "mongoose";
import { CommunityAttachmentModel } from "../models/Community/CommunityAttachment.model";
import { CommunityContentModel } from "../models/Community/CommunityContent.model";
import { AppError } from "../utils/AppError";
import {
  requireActiveCommunityMember,
  requireCommunityModerator,
} from "../utils/communityAccess.utils";
import { presentCommunityContent } from "../utils/communityContentPresentation.utils";
import { sendSuccess } from "../utils/response.utils";

type CommunityContentKind = "post" | "announcement" | "message";

const isDuplicateKeyError = (error: unknown): boolean => {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === 11000;
};

const contentPopulate = (query: any): any => {
  return query
    .populate("authorId", "firstName lastName avatarUrl")
    .populate("attachments")
    .populate({ path: "replyToId", select: "text authorId", populate: { path: "authorId", select: "firstName lastName" } });
};

const toContentView = (item: unknown): any => item as any;

const encodeCursor = (createdAt: Date, id: Types.ObjectId): string => {
  return Buffer.from(createdAt.toISOString() + ":" + id.toString()).toString("base64url");
};

const decodeCursor = (value: string): { createdAt: Date; id: Types.ObjectId } => {
  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    throw new AppError(400, "The message cursor is invalid", "VALIDATION_ERROR");
  }
  const separator = decoded.lastIndexOf(":");
  const date = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (separator < 0 || Number.isNaN(date.getTime()) || !Types.ObjectId.isValid(id)) {
    throw new AppError(400, "The message cursor is invalid", "VALIDATION_ERROR");
  }
  return { createdAt: date, id: new Types.ObjectId(id) };
};

const getMessage = async (communityId: string, messageId: string) => {
  const message = await contentPopulate(CommunityContentModel.findOne({
    _id: messageId,
    communityId,
    kind: "message",
    deletedAt: { $exists: false },
  }));
  if (!message) {
    throw new AppError(404, "Community message was not found", "COMMUNITY_MESSAGE_NOT_FOUND");
  }
  return message;
};

const listContent = async (
  request: Request,
  response: Response,
  kind: Exclude<CommunityContentKind, "message">,
  responseKey: "posts" | "announcements",
): Promise<Response> => {
  await requireActiveCommunityMember(request.params.id as string, request.auth?.id as string);
  const page = Number(request.query.page || 1);
  const limit = Number(request.query.limit || 20);
  const query = { communityId: request.params.id as string, kind, deletedAt: { $exists: false } };
  const [items, total] = await Promise.all([
    contentPopulate(CommunityContentModel.find(query)).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    CommunityContentModel.countDocuments(query),
  ]);
  const presented = await presentCommunityContent(items.reverse().map(toContentView), request.auth?.id as string);
  return sendSuccess(response, 200, "Community " + responseKey + " retrieved", {
    [responseKey]: presented,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
};

export const listCommunityPosts = async (request: Request, response: Response): Promise<Response> => {
  return listContent(request, response, "post", "posts");
};

export const listCommunityAnnouncements = async (request: Request, response: Response): Promise<Response> => {
  return listContent(request, response, "announcement", "announcements");
};

export const listCommunityMessages = async (request: Request, response: Response): Promise<Response> => {
  await requireActiveCommunityMember(request.params.id as string, request.auth?.id as string);
  const limit = Number(request.query.limit || 30);
  const before = typeof request.query.before === "string" ? decodeCursor(request.query.before) : null;
  const cursorFilter = before
    ? { $or: [{ createdAt: { $lt: before.createdAt } }, { createdAt: before.createdAt, _id: { $lt: before.id } }] }
    : {};
  const query = {
    communityId: request.params.id as string,
    kind: "message" as const,
    deletedAt: { $exists: false },
    ...cursorFilter,
  };
  const rows = await contentPopulate(CommunityContentModel.find(query)).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextRow = pageRows[pageRows.length - 1];
  const messages = await presentCommunityContent(pageRows.reverse().map(toContentView), request.auth?.id as string);
  return sendSuccess(response, 200, "Community messages retrieved", {
    messages,
    pageInfo: {
      nextCursor: hasMore && nextRow ? encodeCursor(nextRow.createdAt, nextRow._id) : null,
      hasMore,
    },
  });
};

const createContent = async (
  request: Request,
  response: Response,
  kind: Exclude<CommunityContentKind, "message">,
  responseKey: "post" | "announcement",
): Promise<Response> => {
  const { community, membership } = await requireActiveCommunityMember(request.params.id as string, request.auth?.id as string);
  const isModerator = membership.role === "owner" || membership.role === "moderator";
  if (kind === "announcement" && !isModerator) {
    throw new AppError(403, "Only community owners and moderators can publish announcements", "COMMUNITY_MODERATOR_REQUIRED");
  }
  if (kind === "post" && !community.membersCanCreatePosts && !isModerator) {
    throw new AppError(403, "Only community moderators can create posts", "COMMUNITY_MODERATOR_REQUIRED");
  }

  const item = await CommunityContentModel.create({
    communityId: community._id,
    authorId: request.auth?.id,
    kind,
    text: request.body.text,
    imageUrl: request.body.imageUrl,
  });
  community.lastActivityAt = new Date();
  await community.save();
  const hydrated = await contentPopulate(CommunityContentModel.findById(item._id));
  const [presented] = await presentCommunityContent([toContentView(hydrated)], request.auth?.id as string);
  request.app.get("io")?.to("community:" + community._id.toString()).emit("community:" + kind + ":new", presented);
  return sendSuccess(response, 201, "Community " + responseKey + " created", { [responseKey]: presented });
};

export const createCommunityPost = async (request: Request, response: Response): Promise<Response> => {
  return createContent(request, response, "post", "post");
};

export const createCommunityAnnouncement = async (request: Request, response: Response): Promise<Response> => {
  return createContent(request, response, "announcement", "announcement");
};

const resolveAttachments = async (attachmentIds: string[], userId: string) => {
  if (attachmentIds.length === 0) return [];
  const attachments = await CommunityAttachmentModel.find({
    _id: { $in: attachmentIds },
    ownerId: userId,
    linkedMessageId: { $exists: false },
  });
  if (attachments.length !== attachmentIds.length) {
    throw new AppError(422, "One or more message attachments are invalid", "COMMUNITY_ATTACHMENT_INVALID");
  }
  return attachments;
};

export const sendCommunityMessage = async (request: Request, response: Response): Promise<Response> => {
  const { community, membership } = await requireActiveCommunityMember(request.params.id as string, request.auth?.id as string);
  const isModerator = membership.role === "owner" || membership.role === "moderator";
  if (community.messagePermission === "moderators" && !isModerator) {
    throw new AppError(403, "Only community moderators can send messages", "COMMUNITY_MESSAGE_PERMISSION_DENIED");
  }

  const lookup = {
    communityId: community._id,
    authorId: request.auth?.id,
    kind: "message" as const,
    clientMessageId: request.body.clientMessageId,
  };
  const existing = await contentPopulate(CommunityContentModel.findOne(lookup));
  if (existing) {
    const [message] = await presentCommunityContent([toContentView(existing)], request.auth?.id as string);
    return sendSuccess(response, 200, "Community message retrieved", { message });
  }

  const attachmentIds = request.body.attachmentIds || [];
  const attachments = await resolveAttachments(attachmentIds, request.auth?.id as string);
  let replyToId: Types.ObjectId | undefined;
  if (request.body.replyToMessageId) {
    const parent = await getMessage(community._id.toString(), request.body.replyToMessageId);
    replyToId = parent._id;
  }

  let message;
  try {
    message = await CommunityContentModel.create({
      ...lookup,
      text: request.body.text || "",
      attachments: [],
      replyToId,
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const duplicate = await contentPopulate(CommunityContentModel.findOne(lookup));
    if (!duplicate) throw error;
    const [presented] = await presentCommunityContent([toContentView(duplicate)], request.auth?.id as string);
    return sendSuccess(response, 200, "Community message retrieved", { message: presented });
  }

  if (attachments.length > 0) {
    // Link each owned upload exactly once. Checking modifiedCount prevents two
    // concurrent messages from silently sharing the same attachment.
    const linked = await CommunityAttachmentModel.updateMany(
      { _id: { $in: attachments.map((attachment) => attachment._id) }, linkedMessageId: { $exists: false } },
      { $set: { linkedCommunityId: community._id, linkedMessageId: message._id } },
    );
    if (linked.modifiedCount !== attachments.length) {
      await CommunityContentModel.deleteOne({ _id: message._id });
      throw new AppError(409, "One or more message attachments were already used", "COMMUNITY_ATTACHMENT_INVALID");
    }
    message.attachments = attachments.map((attachment) => attachment._id);
    await message.save();
  }
  community.lastActivityAt = new Date();
  await community.save();
  const hydrated = await contentPopulate(CommunityContentModel.findById(message._id));
  const [presented] = await presentCommunityContent([toContentView(hydrated)], request.auth?.id as string);
  request.app.get("io")?.to("community:" + community._id.toString()).emit("community:message:new", presented);
  return sendSuccess(response, 201, "Community message sent", { message: presented });
};

export const getCommunityMessageForAction = getMessage;
export const presentOneCommunityContent = async (item: unknown, viewerId: string): Promise<Record<string, unknown>> => {
  const [presented] = await presentCommunityContent([toContentView(item)], viewerId);
  if (!presented) throw new AppError(404, "Community content was not found", "COMMUNITY_MESSAGE_NOT_FOUND");
  return presented;
};
