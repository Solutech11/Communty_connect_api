import type { Request, Response } from "express";
import { CommunityContentModel } from "../models/Community/CommunityContent.model";
import { CommunityMemberModel } from "../models/Community/CommunityMember.model";
import { ReportModel } from "../models/Report/Report.model";
import {
  presentOneCommunityContent,
} from "./communityContent.controller";
import {
  requireActiveCommunityMember,
  requireCommunityModerator,
} from "../utils/communityAccess.utils";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/response.utils";

type ContentKind = "post" | "announcement" | "message";

const emit = (request: Request, event: string, payload: unknown): void => {
  request.app.get("io")?.to("community:" + (request.params.id as string)).emit(event, payload);
};

const populateContent = (query: any): any => {
  return query
    .populate("authorId", "firstName lastName avatarUrl")
    .populate("attachments")
    .populate({ path: "replyToId", select: "text authorId", populate: { path: "authorId", select: "firstName lastName" } });
};

const findContent = async (communityId: string, contentId: string, kind: ContentKind) => {
  const content = await populateContent(CommunityContentModel.findOne({
    _id: contentId,
    communityId,
    kind,
    deletedAt: { $exists: false },
  }));
  if (!content) {
    const code = kind === "message" ? "COMMUNITY_MESSAGE_NOT_FOUND" : "COMMUNITY_NOT_FOUND";
    throw new AppError(404, "Community content was not found", code);
  }
  return content;
};

const canModerate = (role: string): boolean => role === "owner" || role === "moderator";
const isAuthor = (content: { authorId: { _id?: { toString(): string }; toString(): string } }, userId: string): boolean => {
  const authorId = content.authorId && "_id" in content.authorId ? content.authorId._id?.toString() : content.authorId.toString();
  return authorId === userId;
};

const contentId = (request: Request, key: "messageId" | "postId" | "announcementId"): string => {
  return request.params[key] as string;
};

export const updateCommunityMessage = async (request: Request, response: Response): Promise<Response> => {
  const { membership } = await requireActiveCommunityMember(request.params.id as string, request.auth?.id as string);
  const message = await findContent(request.params.id as string, contentId(request, "messageId"), "message");
  if (!isAuthor(message, request.auth?.id as string) && !canModerate(membership.role)) {
    throw new AppError(403, "You cannot edit this community message", "COMMUNITY_MEMBER_REQUIRED");
  }
  message.text = request.body.text;
  message.editedAt = new Date();
  await message.save();
  const updated = await populateContent(CommunityContentModel.findById(message._id));
  const presented = await presentOneCommunityContent(updated, request.auth?.id as string);
  emit(request, "community:message:updated", presented);
  return sendSuccess(response, 200, "Community message updated", { message: presented });
};

export const deleteCommunityMessage = async (request: Request, response: Response): Promise<Response> => {
  const { membership } = await requireActiveCommunityMember(request.params.id as string, request.auth?.id as string);
  const message = await findContent(request.params.id as string, contentId(request, "messageId"), "message");
  if (!isAuthor(message, request.auth?.id as string) && !canModerate(membership.role)) {
    throw new AppError(403, "You cannot delete this community message", "COMMUNITY_MEMBER_REQUIRED");
  }
  message.deletedAt = new Date();
  message.deletedBy = request.auth?.id as never;
  await message.save();
  const payload = { communityId: request.params.id, messageId: message._id.toString() };
  emit(request, "community:message:deleted", payload);
  return sendSuccess(response, 200, "Community message deleted", {
    messageId: message._id.toString(),
    deletedAt: message.deletedAt.toISOString(),
  });
};

export const toggleCommunityReaction = async (request: Request, response: Response, add: boolean): Promise<Response> => {
  await requireActiveCommunityMember(request.params.id as string, request.auth?.id as string);
  const message = await findContent(request.params.id as string, contentId(request, "messageId"), "message");
  const emoji = request.params.emoji as string;
  const userId = request.auth?.id as string;
  const reaction = message.reactions.find((item: { emoji: string }) => item.emoji === emoji);
  if (add) {
    if (reaction) {
      if (!reaction.userIds.some((id: { toString(): string }) => id.toString() === userId)) reaction.userIds.push(userId as never);
    } else {
      message.reactions.push({ emoji, userIds: [userId] } as never);
    }
  } else if (reaction) {
    reaction.userIds = reaction.userIds.filter((id: { toString(): string }) => id.toString() !== userId);
    message.set("reactions", message.reactions.filter((item: { userIds: unknown[] }) => item.userIds.length > 0));
  }
  await message.save();
  const updated = await populateContent(CommunityContentModel.findById(message._id));
  const presented = await presentOneCommunityContent(updated, userId);
  const reactions = (presented.reactions || []) as unknown[];
  emit(request, "community:message:updated", presented);
  return sendSuccess(response, 200, "Community message reactions updated", { messageId: message._id.toString(), reactions });
};

export const setCommunityMessagePin = async (request: Request, response: Response, pinned: boolean): Promise<Response> => {
  await requireCommunityModerator(request.params.id as string, request.auth?.id as string);
  const message = await findContent(request.params.id as string, contentId(request, "messageId"), "message");
  message.pinnedAt = pinned ? new Date() : undefined;
  message.pinnedBy = pinned ? request.auth?.id as never : undefined;
  await message.save();
  const updated = await populateContent(CommunityContentModel.findById(message._id));
  const presented = await presentOneCommunityContent(updated, request.auth?.id as string);
  emit(request, "community:message:updated", presented);
  return sendSuccess(response, 200, pinned ? "Community message pinned" : "Community message unpinned", { message: presented });
};

export const markCommunityMessagesRead = async (request: Request, response: Response): Promise<Response> => {
  const { community } = await requireActiveCommunityMember(request.params.id as string, request.auth?.id as string);
  const message = await findContent(request.params.id as string, request.body.lastReadMessageId, "message");
  const lastReadAt = new Date();
  await CommunityMemberModel.updateOne(
    { communityId: community._id, userId: request.auth?.id, status: "active" },
    { $set: { lastReadMessageId: message._id, lastReadAt } },
  );
  return sendSuccess(response, 200, "Community messages marked read", {
    communityId: community._id.toString(),
    lastReadMessageId: message._id.toString(),
    lastReadAt: lastReadAt.toISOString(),
    unreadCount: 0,
  });
};

export const updateCommunityNotificationPreference = async (request: Request, response: Response): Promise<Response> => {
  const { community } = await requireActiveCommunityMember(request.params.id as string, request.auth?.id as string);
  const updatedAt = new Date();
  await CommunityMemberModel.updateOne(
    { communityId: community._id, userId: request.auth?.id, status: "active" },
    { $set: { notificationLevel: request.body.level, muted: request.body.level === "muted", updatedAt } },
  );
  return sendSuccess(response, 200, "Community notification preference updated", {
    communityId: community._id.toString(),
    level: request.body.level,
    updatedAt: updatedAt.toISOString(),
  });
};

const updatePostLike = async (
  request: Request,
  response: Response,
  kind: "post" | "announcement",
  param: "postId" | "announcementId",
): Promise<Response> => {
  const { membership } = await requireActiveCommunityMember(request.params.id as string, request.auth?.id as string);
  const content = await findContent(request.params.id as string, contentId(request, param), kind);
  const moderator = canModerate(membership.role);
  if (kind === "announcement" ? !moderator : (!isAuthor(content, request.auth?.id as string) && !moderator)) {
    throw new AppError(403, "You cannot edit this community content", kind === "announcement" ? "COMMUNITY_MODERATOR_REQUIRED" : "COMMUNITY_MEMBER_REQUIRED");
  }
  if (typeof request.body.text === "string") content.text = request.body.text;
  if ("imageUrl" in request.body) content.imageUrl = request.body.imageUrl;
  if (kind === "announcement" && typeof request.body.pinned === "boolean") {
    content.pinnedAt = request.body.pinned ? new Date() : undefined;
    content.pinnedBy = request.body.pinned ? request.auth?.id as never : undefined;
  }
  content.editedAt = new Date();
  await content.save();
  const updated = await populateContent(CommunityContentModel.findById(content._id));
  const presented = await presentOneCommunityContent(updated, request.auth?.id as string);
  emit(request, "community:" + kind + ":updated", presented);
  return sendSuccess(response, 200, "Community " + kind + " updated", { [kind]: presented });
};

const deletePostLike = async (
  request: Request,
  response: Response,
  kind: "post" | "announcement",
  param: "postId" | "announcementId",
): Promise<Response> => {
  const { membership } = await requireActiveCommunityMember(request.params.id as string, request.auth?.id as string);
  const content = await findContent(request.params.id as string, contentId(request, param), kind);
  const moderator = canModerate(membership.role);
  if (kind === "announcement" ? !moderator : (!isAuthor(content, request.auth?.id as string) && !moderator)) {
    throw new AppError(403, "You cannot delete this community content", kind === "announcement" ? "COMMUNITY_MODERATOR_REQUIRED" : "COMMUNITY_MEMBER_REQUIRED");
  }
  const deletedAt = new Date();
  content.deletedAt = deletedAt;
  content.deletedBy = request.auth?.id as never;
  await content.save();
  emit(request, "community:" + kind + ":deleted", { communityId: request.params.id, contentId: content._id.toString() });
  const idField = kind === "post" ? "postId" : "announcementId";
  return sendSuccess(response, 200, "Community " + kind + " deleted", { [idField]: content._id.toString(), deletedAt: deletedAt.toISOString() });
};

export const updateCommunityPost = async (request: Request, response: Response): Promise<Response> => {
  return updatePostLike(request, response, "post", "postId");
};

export const deleteCommunityPost = async (request: Request, response: Response): Promise<Response> => {
  return deletePostLike(request, response, "post", "postId");
};

export const updateCommunityAnnouncement = async (request: Request, response: Response): Promise<Response> => {
  return updatePostLike(request, response, "announcement", "announcementId");
};

export const deleteCommunityAnnouncement = async (request: Request, response: Response): Promise<Response> => {
  return deletePostLike(request, response, "announcement", "announcementId");
};

export const createCommunityMessageReport = async (request: Request, response: Response): Promise<Response> => {
  const userId = request.auth?.id as string;
  await requireActiveCommunityMember(request.params.id as string, userId);
  const message = await findContent(request.params.id as string, contentId(request, "messageId"), "message");
  if (isAuthor(message, userId)) {
    throw new AppError(400, "You cannot report your own community message", "INVALID_REPORT_TARGET");
  }
  const duplicate = await ReportModel.exists({
    reporterId: userId,
    targetType: "community_message",
    targetId: message._id,
    status: { $in: ["open", "reviewing"] },
  });
  if (duplicate) {
    throw new AppError(409, "You already have an active report for this message", "REPORT_ALREADY_OPEN");
  }
  const report = await ReportModel.create({
    reporterId: userId,
    targetType: "community_message",
    targetId: message._id,
    reason: request.body.reason,
    details: request.body.details,
  });
  return sendSuccess(response, 201, "Community message reported", {
    report: {
      _id: report._id.toString(),
      targetType: "community_message",
      targetId: message._id.toString(),
      status: report.status,
      createdAt: report.createdAt,
    },
  });
};
