import type { Namespace, Socket } from "socket.io";
import { z } from "zod";
import { ConversationModel } from "../../models/Chat/Conversation.model";
import { logger } from "../../utils/logger.utils";

const conversationIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid conversation ID");

type BooleanAcknowledgement = (success: boolean) => void;
type ObjectAcknowledgement = (result: {
  success: boolean;
  message: string;
  conversationId?: string;
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
    const isParticipant = await ConversationModel.exists({
      _id: conversationId,
      participantIds: userId,
    });

    if (!isParticipant) {
      return false;
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

  const emitTypingState = (payload: unknown, isTyping: boolean): void => {
    const conversationId = getConversationId(payload);

    if (!conversationId) {
      return;
    }

    const room = `conversation:${conversationId}`;

    if (!socket.rooms.has(room)) {
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

    emitTypingState(payload, isTyping);
  });

  socket.on("typing:start", (payload: unknown) => {
    emitTypingState(payload, true);
  });

  socket.on("typing:stop", (payload: unknown) => {
    emitTypingState(payload, false);
  });

  socket.on("disconnect", (reason) => {
    logger.debug(
      {
        reason,
        socketId: socket.id,
        userId,
      },
      "Chat socket disconnected",
    );
  });

  logger.debug(
    {
      namespace: io.name,
      socketId: socket.id,
      userId,
    },
    "Chat socket connected",
  );
};

export default ChatSocket;
