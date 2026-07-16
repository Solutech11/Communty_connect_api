import type { Request, Response } from "express";
import { AISessionModel } from "../models/AI/AISession.model";
import { ConversationModel } from "../models/Chat/Conversation.model";
import { MessageModel } from "../models/Chat/Message.model";
import { AppError } from "../utils/AppError";
import { decryptField, encryptField } from "../utils/crypto.utils";
import { sendSuccess } from "../utils/response.utils";
import { getPersonalizedEventRecommendations } from "./EventRecommendation.algorithm";
import { createAIResponse, type AIMessage, type AIPurpose } from "./Groq";

const runAI = async (
  userId: string,
  purpose: AIPurpose,
  prompt: string,
  sessionId?: string,
) => {
  // userId and purpose are part of the lookup so one user cannot continue or
  // inspect another user's AI session by guessing its MongoDB identifier.
  let session = sessionId
    ? await AISessionModel.findOne({ _id: sessionId, userId, purpose }).select("+encryptedHistory")
    : null;

  if (sessionId && !session) {
    throw new AppError(404, "AI session was not found", "AI_SESSION_NOT_FOUND");
  }

  let history: AIMessage[] = [];

  // Groq chat completions are stateless. Keep only six recent turns, encrypt
  // them at rest, and validate the decrypted shape before sending them back.
  if (session?.encryptedHistory) {
    const parsed = JSON.parse(decryptField(session.encryptedHistory)) as unknown;
    if (Array.isArray(parsed)) {
      history = parsed.filter((message): message is AIMessage => {
        return Boolean(
          message &&
          typeof message === "object" &&
          "role" in message &&
          (message.role === "user" || message.role === "assistant") &&
          "content" in message &&
          typeof message.content === "string",
        );
      }).slice(-12);
    }
  }

  const result = await createAIResponse({
    purpose,
    prompt,
    history,
  });
  // The encrypted field is select:false in the model and is never returned by
  // session-list endpoints.
  const encryptedHistory = encryptField(JSON.stringify([
    ...history,
    { role: "user", content: prompt },
    { role: "assistant", content: result.text },
  ].slice(-12)));

  if (!session) {
    session = await AISessionModel.create({
      userId,
      purpose,
      previousResponseId: result.responseId,
      encryptedHistory,
      lastUsedAt: new Date(),
    });
  } else {
    session.previousResponseId = result.responseId;
    session.encryptedHistory = encryptedHistory;
    session.lastUsedAt = new Date();
    await session.save();
  }

  return { sessionId: session._id, message: result.text };
};

export const assistantChat = async (request: Request, response: Response): Promise<Response> => {
  const result = await runAI(
    request.auth?.id as string,
    "assistant",
    request.body.message,
    request.body.sessionId,
  );
  return sendSuccess(response, 200, "AI response generated", result);
};

export const generateEventCopy = async (request: Request, response: Response): Promise<Response> => {
  const prompt = [
    `Event title or idea: ${request.body.title}`,
    `Category: ${request.body.activityType}`,
    `Audience: ${request.body.targetAudience || "not specified"}`,
    `Setting: ${request.body.setting || "not specified"}`,
    `Known details: ${request.body.details || "none"}`,
    "Return a polished title, a concise description, and five relevant tags.",
  ].join("\n");
  const result = await runAI(request.auth?.id as string, "event_copy", prompt);
  return sendSuccess(response, 200, "Event copy generated", result);
};

export const recommendEvents = async (request: Request, response: Response): Promise<Response> => {
  // Convert flexible client preference values into plain text signals. The
  // ranking model ignores objects and other untrusted structures.
  const rawPreferences = request.body.preferences || {};
  const extraPreferences = Object.values(rawPreferences).flatMap((value) => {
    if (typeof value === "string") {
      return [value];
    }

    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  });
  const result = await getPersonalizedEventRecommendations({
    userId: request.auth?.id as string,
    latitude: request.body.latitude,
    longitude: request.body.longitude,
    radiusKm: request.body.radiusKm,
    limit: request.body.limit,
    extraPreferences,
  });

  return sendSuccess(response, 200, "Personalized event recommendations generated", result);
};

export const summarizeConversation = async (
  request: Request,
  response: Response,
): Promise<Response> => {
  const conversation = await ConversationModel.findOne({
    _id: (request.params.id as string),
    participantIds: request.auth?.id,
  });

  if (!conversation) {
    throw new AppError(404, "Conversation was not found", "CONVERSATION_NOT_FOUND");
  }

  const messages = await MessageModel.find({ conversationId: conversation._id, deletedAt: { $exists: false } })
    .select("senderId text createdAt")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  const prompt = `Conversation messages, oldest first:\n${JSON.stringify(messages.reverse())}`;
  const result = await runAI(request.auth?.id as string, "chat_summary", prompt);
  return sendSuccess(response, 200, "Conversation summarized", result);
};

export const listAISessions = async (request: Request, response: Response): Promise<Response> => {
  const sessions = await AISessionModel.find({ userId: request.auth?.id }).sort({ lastUsedAt: -1 }).limit(50);
  return sendSuccess(response, 200, "AI sessions retrieved", { sessions });
};

export const deleteAISession = async (request: Request, response: Response): Promise<Response> => {
  const result = await AISessionModel.deleteOne({ _id: (request.params.id as string), userId: request.auth?.id });

  if (result.deletedCount === 0) {
    throw new AppError(404, "AI session was not found", "AI_SESSION_NOT_FOUND");
  }

  return sendSuccess(response, 200, "AI session deleted");
};

