import type { Request, Response } from "express";
import { Types } from "mongoose";
import { ConversationModel } from "../models/Chat/Conversation.model";
import { MessageModel } from "../models/Chat/Message.model";
import { UserModel } from "../models/Auth/User.model";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/response.utils";
import { blockedUserIds, requireUnblocked, pairKeyFor, withUserLocks } from "../utils/userBlock.utils";
import { ensureDirectConversation } from "../utils/directConversation.utils";
import { withRedisLock } from "../utils/redisLock.utils";
import { emitConversationMessage } from "../utils/chatRealtime.utils";

const requireParticipant = async (conversationId: string, userId: string) => {
  const conversation = await ConversationModel.findOne({
    _id: conversationId,
    participantIds: userId,
  });

  if (!conversation) {
    throw new AppError(404, "Conversation was not found", "CONVERSATION_NOT_FOUND");
  }

  if (conversation.type === "direct") {
    const otherId = conversation.participantIds.find((id) => id.toString() !== userId);
    if (otherId) await requireUnblocked(userId, otherId.toString());
  }

  return conversation;
};

interface LastMessageAggregate {
  _id: Types.ObjectId;
  message: {
    _id: Types.ObjectId;
    senderId: Types.ObjectId;
    type: "text" | "image" | "system";
    text?: string;
    mediaUrl?: string;
    createdAt: Date;
  };
}

interface PopulatedMessageSender {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
}

interface PopulatedMessage {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  senderId: PopulatedMessageSender;
  clientMessageId: string;
  type: "text" | "image" | "system";
  text?: string;
  mediaUrl?: string;
  readBy: Types.ObjectId[];
  editedAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const messageDto = (message: PopulatedMessage) => ({
  ...message,
  _id: message._id.toString(),
  conversationId: message.conversationId.toString(),
  senderId: message.senderId._id.toString(),
  sender: message.senderId,
  readBy: message.readBy.map((readerId) => readerId.toString()),
});

interface UnreadAggregate {
  _id: Types.ObjectId;
  count: number;
}

const conversationDtos = async (
  conversations: Array<{
    _id: Types.ObjectId;
    type: string;
    title?: string | null;
    participantIds: Types.ObjectId[];
    createdBy: Types.ObjectId;
    lastMessageAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>,
  userId: string,
) => {
  if (conversations.length === 0) {
    return [];
  }

  const conversationIds = conversations.map((conversation) => conversation._id);
  const participantIds = [
    ...new Set(
      conversations.flatMap((conversation) =>
        conversation.participantIds.map((participantId) => participantId.toString())),
    ),
  ];
  const userObjectId = new Types.ObjectId(userId);
  const [profiles, latestMessages, unreadCounts] = await Promise.all([
    UserModel.find({ _id: { $in: participantIds }, status: "active" })
      .select("firstName lastName avatarUrl")
      .lean(),
    MessageModel.aggregate<LastMessageAggregate>([
      {
        $match: {
          conversationId: { $in: conversationIds },
          deletedAt: { $exists: false },
        },
      },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$conversationId", message: { $first: "$$ROOT" } } },
    ]),
    MessageModel.aggregate<UnreadAggregate>([
      {
        $match: {
          conversationId: { $in: conversationIds },
          senderId: { $ne: userObjectId },
          readBy: { $ne: userObjectId },
          deletedAt: { $exists: false },
        },
      },
      { $group: { _id: "$conversationId", count: { $sum: 1 } } },
    ]),
  ]);

  const profileById = new Map(
    profiles.map((profile) => [profile._id.toString(), profile]),
  );
  const lastByConversation = new Map(
    latestMessages.map((entry) => [entry._id.toString(), entry.message]),
  );
  const unreadByConversation = new Map(
    unreadCounts.map((entry) => [entry._id.toString(), entry.count]),
  );

  return conversations.map((conversation) => {
    const id = conversation._id.toString();
    const lastMessage = lastByConversation.get(id);
    return {
      _id: id,
      type: conversation.type,
      title: conversation.title || null,
      participantIds: conversation.participantIds.map((participantId) => participantId.toString()),
      participants: conversation.participantIds
        .map((participantId) => profileById.get(participantId.toString()))
        .filter(Boolean),
      createdBy: conversation.createdBy.toString(),
      lastMessageAt: conversation.lastMessageAt || lastMessage?.createdAt || null,
      lastMessagePreview: lastMessage
        ? {
            _id: lastMessage._id.toString(),
            senderId: lastMessage.senderId.toString(),
            type: lastMessage.type,
            text: lastMessage.text,
            mediaUrl: lastMessage.mediaUrl,
            createdAt: lastMessage.createdAt,
          }
        : null,
      unreadCount: unreadByConversation.get(id) || 0,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  });
};

export const listConversations = async (request: Request, response: Response): Promise<Response> => {
  const blocked = new Set(await blockedUserIds(request.auth!.id));
  const conversations = await ConversationModel.find({ participantIds: request.auth?.id })
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .lean();
  const hydrated = await conversationDtos(conversations.filter((item) =>
    item.type !== "direct" || !item.participantIds.some((id) => blocked.has(id.toString()))), request.auth!.id);
  return sendSuccess(response, 200, "Conversations retrieved", { conversations: hydrated });
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
    if (participantIds.length !== 2) throw new AppError(422, "Direct chat requires exactly two people", "INVALID_PARTICIPANTS");
    const left = request.auth!.id;
    const right = participantIds.find((id) => id !== left) as string;
    const record = await withUserLocks([left, right], () => withRedisLock(`direct-chat:${pairKeyFor(left, right)}`, () => ensureDirectConversation(left, right)));
    const [conversation] = await conversationDtos([record.toObject()], left);
    return sendSuccess(response, 200, "Conversation retrieved", { conversation });
  }

  const created = await ConversationModel.create({
    type: request.body.type,
    title: request.body.title,
    participantIds,
    createdBy: request.auth?.id,
  });
  const [conversation] = await conversationDtos(
    [created.toObject()],
    request.auth?.id as string,
  );
  return sendSuccess(response, 201, "Conversation created", { conversation });
};

export const listMessages = async (request: Request, response: Response): Promise<Response> => {
  await requireParticipant(request.params.id as string, request.auth?.id as string);
  const limit = Number(request.query.limit || 50);
  const before = request.query.before ? new Date(request.query.before as string) : new Date();
  const messages = await MessageModel.find({
    conversationId: request.params.id as string,
    createdAt: { $lt: before },
    deletedAt: { $exists: false },
  })
    .populate("senderId", "firstName lastName avatarUrl")
    .sort({ createdAt: -1 })
    .limit(limit);
  return sendSuccess(response, 200, "Messages retrieved", {
    messages: messages.reverse().map((message) =>
      messageDto(message.toObject() as unknown as PopulatedMessage)),
  });
};

const persistMessage = async (request: Request, response: Response): Promise<Response> => {
  const conversation = await requireParticipant(request.params.id as string, request.auth?.id as string);
  const existing = await MessageModel.findOne({
    conversationId: conversation._id,
    senderId: request.auth?.id,
    clientMessageId: request.body.clientMessageId,
  }).populate("senderId", "firstName lastName avatarUrl");

  if (existing) {
    return sendSuccess(response, 200, "Message retrieved", {
      message: messageDto(existing.toObject() as unknown as PopulatedMessage),
    });
  }

  const message = await MessageModel.create({
    conversationId: conversation._id,
    senderId: request.auth?.id,
    clientMessageId: request.body.clientMessageId,
    type: request.body.type,
    text: request.body.text,
    mediaUrl: request.body.mediaUrl,
    readBy: [request.auth?.id as string],
  });
  conversation.lastMessageAt = message.createdAt;
  await conversation.save();
  await message.populate("senderId", "firstName lastName avatarUrl");

  const responseMessage = messageDto(message.toObject() as unknown as PopulatedMessage);
  emitConversationMessage(
    request.app.get("io"),
    conversation._id.toString(),
    conversation.participantIds.map(String),
    responseMessage,
  );
  return sendSuccess(response, 201, "Message sent", { message: responseMessage });
};

export const markConversationRead = async (request: Request, response: Response): Promise<Response> => {
  await requireParticipant(request.params.id as string, request.auth?.id as string);
  await MessageModel.updateMany(
    { conversationId: request.params.id as string, readBy: { $ne: request.auth?.id } },
    { $addToSet: { readBy: request.auth?.id } },
  );
  request.app.get("io")?.to(`conversation:${request.params.id as string}`).emit("conversation:read", {
    conversationId: request.params.id as string,
    userId: request.auth?.id,
    readAt: new Date().toISOString(),
  });
  return sendSuccess(response, 200, "Conversation marked as read");
};

export const sendMessage = async (request: Request, response: Response): Promise<Response> => {
  const conversation = await requireParticipant(request.params.id as string, request.auth!.id);
  if (conversation.type === "direct") {
    return withUserLocks(conversation.participantIds.map(String), () => persistMessage(request, response));
  }
  return persistMessage(request, response);
};
