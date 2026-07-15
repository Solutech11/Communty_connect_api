import type { Request, Response } from "express";
import { AISessionModel } from "../models/AI/AISession.model";
import { ConversationModel } from "../models/Chat/Conversation.model";
import { MessageModel } from "../models/Chat/Message.model";
import { EventModel } from "../models/Event/Event.model";
import { AppError } from "../utils/AppError";
import { createAIResponse, type AIPurpose } from "../utils/openai.utils";
import { sendSuccess } from "../utils/response.utils";

const runAI = async (
  userId: string,
  purpose: AIPurpose,
  prompt: string,
  sessionId?: string,
) => {
  let session = sessionId
    ? await AISessionModel.findOne({ _id: sessionId, userId, purpose })
    : null;

  if (sessionId && !session) {
    throw new AppError(404, "AI session was not found", "AI_SESSION_NOT_FOUND");
  }

  const result = await createAIResponse({
    purpose,
    prompt,
    previousResponseId: session?.previousResponseId || undefined,
  });

  if (!session) {
    session = await AISessionModel.create({
      userId,
      purpose,
      previousResponseId: result.responseId,
      lastUsedAt: new Date(),
    });
  } else {
    session.previousResponseId = result.responseId;
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
  const events = await EventModel.find({ status: "published", startsAt: { $gte: new Date() } })
    .select("title description activityType state lga startsAt setting tags")
    .limit(30)
    .lean();
  const prompt = `User preferences: ${JSON.stringify(request.body.preferences)}\nCandidate events: ${JSON.stringify(events)}\nReturn up to 5 event IDs and short reasons.`;
  const result = await runAI(request.auth?.id as string, "recommendations", prompt);
  return sendSuccess(response, 200, "Event recommendations generated", {
    ...result,
    candidateEvents: events,
  });
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


