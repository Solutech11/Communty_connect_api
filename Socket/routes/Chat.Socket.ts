import type { Namespace, Socket } from "socket.io";
import { z } from "zod";
import { ConversationModel } from "../../models/Chat/Conversation.model";
import { requireActiveCommunityMember } from "../../utils/communityAccess.utils";
import { UserModel } from "../../models/Auth/User.model";
import { logger } from "../../utils/logger.utils";
import { requireUnblocked } from "../../utils/userBlock.utils";

const conversationIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid conversation ID");

type BooleanAcknowledgement = (success: boolean) => void;
type ObjectAcknowledgement = (result: {
  success: boolean;
  message: string;
  conversationId?: string;
  communityId?: string;
  code?: string;
}) => void;

const getConversationId = (payload: unknown): string | null => {
  const candidate =
    typeof payload === "string"
      ? payload
      : typeof payload === "object" && payload !== null && "conversationId" in payload
        ? (payload as { conversationId?: unknown }).conversationId
        : null;
  const parsed = conversationIdSchema.safeParse(candidate);

  return parsed.success ? parsed.data : null;
};

/**
 * Registers authenticated chat events for one connected client.
 * Persistence remains on the REST message endpoint so validation,
 * idempotency, authorization, and notification behavior stay centralized.
 */
const ChatSocket = (socket: Socket, io: Namespace): void => {
  const userId = socket.data.userId as string;

  const joinConversation = async (conversationId: string): Promise<boolean> => {
    const isParticipant = await ConversationModel.findOne({
      _id: conversationId,
      participantIds: userId,
    });

    if (!isParticipant) {
      return false;
    }

    if (isParticipant.type === "direct") {
      const otherId = isParticipant.participantIds.find((id) => id.toString() !== userId);
      if (otherId) await requireUnblocked(userId, otherId.toString());
    }

    const previousConversationId = socket.data.currentConversationId as string | undefined;

    if (previousConversationId && previousConversationId !== conversationId) {
      await socket.leave(`conversation:${previousConversationId}`);
    }

    await socket.join(`conversation:${conversationId}`);
    socket.data.currentConversationId = conversationId;
    return true;
  };

  socket.on(
    "join-chat",
    async (payload: unknown, acknowledge?: ObjectAcknowledgement): Promise<void> => {
      const conversationId = getConversationId(payload);

      if (!conversationId) {
        acknowledge?.({
          success: false,
          message: "A valid conversation ID is required",
        });
        return;
      }

      try {
        const joined = await joinConversation(conversationId);

        acknowledge?.({
          success: joined,
          message: joined ? "Chat joined" : "You are not a participant in this chat",
          conversationId: joined ? conversationId : undefined,
        });
      } catch (error) {
        logger.warn({ error, userId, conversationId }, "Socket chat join failed");
        acknowledge?.({
          success: false,
          message: "Unable to join chat",
        });
      }
    },
  );

  // Retain the existing event name for current mobile clients.
  socket.on(
    "conversation:join",
    async (payload: unknown, acknowledge?: BooleanAcknowledgement): Promise<void> => {
      const conversationId = getConversationId(payload);

      if (!conversationId) {
        acknowledge?.(false);
        return;
      }

      try {
        acknowledge?.(await joinConversation(conversationId));
      } catch (error) {
        logger.warn({ error, userId, conversationId }, "Socket conversation join failed");
        acknowledge?.(false);
      }
    },
  );

  const leaveConversation = async (payload: unknown): Promise<void> => {
    const conversationId = getConversationId(payload);

    if (!conversationId) {
      return;
    }

    await socket.leave(`conversation:${conversationId}`);

    if (socket.data.currentConversationId === conversationId) {
      delete socket.data.currentConversationId;
    }
  };

  socket.on("leave-chat", (payload: unknown) => {
    void leaveConversation(payload);
  });

  socket.on("conversation:leave", (payload: unknown) => {
    void leaveConversation(payload);
  });

  const emitTypingState = async (payload: unknown, isTyping: boolean): Promise<void> => {
    const conversationId = getConversationId(payload);

    if (!conversationId) {
      return;
    }

    const room = `conversation:${conversationId}`;

    if (!socket.rooms.has(room)) {
      return;
    }

    try {
      const conversation = await ConversationModel.findOne({ _id: conversationId, participantIds: userId }).lean();
      if (!conversation) return;
      if (conversation.type === "direct") {
        const otherId = conversation.participantIds.find((id) => id.toString() !== userId);
        if (otherId) await requireUnblocked(userId, otherId.toString());
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error)) logger.warn({ error, conversationId, userId }, "Socket typing access check failed");
      await socket.leave(room);
      return;
    }

    socket.to(room).emit("typing", {
      conversationId,
      userId,
      isTyping,
    });
    socket.to(room).emit(isTyping ? "typing:start" : "typing:stop", {
      conversationId,
      userId,
    });
  };

  socket.on("typing", (payload: unknown) => {
    const isTyping =
      typeof payload === "object" &&
      payload !== null &&
      "isTyping" in payload &&
      (payload as { isTyping?: unknown }).isTyping === true;

    void emitTypingState(payload, isTyping);
  });

  socket.on("typing:start", (payload: unknown) => {
    void emitTypingState(payload, true);
  });

  socket.on("typing:stop", (payload: unknown) => {
    void emitTypingState(payload, false);
  });

  const communityIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid community ID");
  const parseCommunityId = (payload: unknown): string | null => {
    const value = typeof payload === "object" && payload !== null && "communityId" in payload
      ? (payload as { communityId?: unknown }).communityId
      : null;
    const parsed = communityIdSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };

  socket.on("community:join", async (payload: unknown, acknowledge?: ObjectAcknowledgement): Promise<void> => {
    const communityId = parseCommunityId(payload);
    if (!communityId) {
      acknowledge?.({ success: false, code: "VALIDATION_ERROR", message: "A valid community ID is required" });
      return;
    }
    try {
      await requireActiveCommunityMember(communityId, userId);
      await socket.join("community:" + communityId);
      acknowledge?.({ success: true, message: "Community joined", communityId });
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String((error as { code?: string }).code) : "COMMUNITY_MEMBER_REQUIRED";
      acknowledge?.({ success: false, code, message: "An active community membership is required" });
    }
  });

  socket.on("community:leave", async (payload: unknown, acknowledge?: ObjectAcknowledgement): Promise<void> => {
    const communityId = parseCommunityId(payload);
    if (!communityId) {
      acknowledge?.({ success: false, code: "VALIDATION_ERROR", message: "A valid community ID is required" });
      return;
    }
    await socket.leave("community:" + communityId);
    acknowledge?.({ success: true, message: "Community left", communityId });
  });

  socket.on("community:typing", async (payload: unknown): Promise<void> => {
    const communityId = parseCommunityId(payload);
    const typing = typeof payload === "object" && payload !== null
      && (payload as { typing?: unknown }).typing === true;
    if (!communityId || !socket.rooms.has("community:" + communityId)) return;
    const user = await UserModel.findById(userId).select("firstName").lean();
    socket.to("community:" + communityId).emit("community:typing", {
      communityId,
      userId,
      firstName: user?.firstName || "Member",
      typing,
    });
  });
  socket.on("disconnect", (reason) => {
    logger.info(
      {
        namespace: io.name,
        reason,
        socketId: socket.id,
        userId,
      },
      "Chat socket disconnected",
    );
  });

  logger.info(
    {
      namespace: io.name,
      socketId: socket.id,
      transport: socket.conn.transport.name,
      userId,
    },
    "Authenticated chat socket connected",
  );
};

export default ChatSocket;
