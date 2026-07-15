import type { Request, Response } from "express";
import { ConversationModel } from "../models/Chat/Conversation.model";
import { MessageModel } from "../models/Chat/Message.model";
import { UserModel } from "../models/Auth/User.model";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/response.utils";

const requireParticipant = async (conversationId: string, userId: string) => {
  const conversation = await ConversationModel.findOne({
    _id: conversationId,
    participantIds: userId,
  });

  if (!conversation) {
    throw new AppError(404, "Conversation was not found", "CONVERSATION_NOT_FOUND");
  }

  return conversation;
};

export const listConversations = async (request: Request, response: Response): Promise<Response> => {
  const conversations = await ConversationModel.find({ participantIds: request.auth?.id })
    .populate("participantIds", "firstName lastName avatarUrl")
    .sort({ lastMessageAt: -1, updatedAt: -1 });
  return sendSuccess(response, 200, "Conversations retrieved", { conversations });
};

export const createConversation = async (request: Request, response: Response): Promise<Response> => {
  const participantIds = [...new Set([request.auth?.id, ...request.body.participantIds])];

  if (participantIds.length < 2) {
    throw new AppError(422, "A conversation requires another participant", "PARTICIPANT_REQUIRED");
  }

  const activeCount = await UserModel.countDocuments({ _id: { $in: participantIds }, status: "active" });

  if (activeCount !== participantIds.length) {
    throw new AppError(422, "One or more participants are unavailable", "INVALID_PARTICIPANTS");
  }

  if (request.body.type === "direct") {
    const existing = await ConversationModel.findOne({
      type: "direct",
      participantIds: { $all: participantIds, $size: 2 },
    });
    if (existing) {
      return sendSuccess(response, 200, "Conversation retrieved", { conversation: existing });
    }
  }

  const conversation = await ConversationModel.create({
    type: request.body.type,
    title: request.body.title,
    participantIds,
    createdBy: request.auth?.id,
  });
  return sendSuccess(response, 201, "Conversation created", { conversation });
};

export const listMessages = async (request: Request, response: Response): Promise<Response> => {
  await requireParticipant((request.params.id as string), request.auth?.id as string);
  const limit = Number(request.query.limit || 50);
  const before = request.query.before ? new Date(request.query.before as string) : new Date();
  const messages = await MessageModel.find({
    conversationId: (request.params.id as string),
    createdAt: { $lt: before },
    deletedAt: { $exists: false },
  })
    .populate("senderId", "firstName lastName avatarUrl")
    .sort({ createdAt: -1 })
    .limit(limit);
  return sendSuccess(response, 200, "Messages retrieved", { messages: messages.reverse() });
};

export const sendMessage = async (request: Request, response: Response): Promise<Response> => {
  const conversation = await requireParticipant((request.params.id as string), request.auth?.id as string);
  const message = await MessageModel.create({
    conversationId: conversation._id,
    senderId: request.auth?.id,
    clientMessageId: request.body.clientMessageId,
    type: request.body.type,
    text: request.body.text,
    mediaUrl: request.body.mediaUrl,
    readBy: [request.auth?.id as string],
  });
  conversation.lastMessageAt = new Date();
  await conversation.save();

  request.app.get("io")?.to(`conversation:${conversation._id.toString()}`).emit("message:new", message);
  return sendSuccess(response, 201, "Message sent", { message });
};

export const markConversationRead = async (request: Request, response: Response): Promise<Response> => {
  await requireParticipant((request.params.id as string), request.auth?.id as string);
  await MessageModel.updateMany(
    { conversationId: (request.params.id as string), readBy: { $ne: request.auth?.id } },
    { $addToSet: { readBy: request.auth?.id } },
  );
  request.app.get("io")?.to(`conversation:${(request.params.id as string)}`).emit("conversation:read", {
    conversationId: (request.params.id as string),
    userId: request.auth?.id,
  });
  return sendSuccess(response, 200, "Conversation marked as read");
};


