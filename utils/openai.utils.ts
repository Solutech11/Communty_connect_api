import OpenAI from "openai";
import { env } from "../Config/env";
import { AppError } from "./AppError";

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  timeout: 30_000,
  maxRetries: 2,
});

const SYSTEM_PROMPTS = {
  assistant:
    "You are Community Connect AI, a concise and friendly assistant. Help users discover safe local events, plan community gatherings, understand app features, and communicate respectfully. Never claim an action happened unless tool or app state proves it. Do not provide financial guarantees or expose private data.",
  event_copy:
    "You are an event copy editor. Produce clear, welcoming, inclusive event copy using only supplied facts. Never invent a venue, price, host credential, date, or accessibility claim.",
  recommendations:
    "You rank only the supplied Community Connect events. Explain briefly why each item fits the user's interests. Do not invent events or claim real-time availability beyond supplied data.",
  chat_summary:
    "Summarize the supplied conversation into decisions, open questions, and action items. Avoid repeating sensitive personal data.",
} as const;

export type AIPurpose = keyof typeof SYSTEM_PROMPTS;

export const createAIResponse = async (input: {
  purpose: AIPurpose;
  prompt: string;
  previousResponseId?: string;
}): Promise<{ text: string; responseId: string }> => {
  try {
    const response = await openai.responses.create({
      model: env.OPENAI_MODEL,
      instructions: SYSTEM_PROMPTS[input.purpose],
      input: input.prompt,
      previous_response_id: input.previousResponseId,
      max_output_tokens: env.OPENAI_MAX_OUTPUT_TOKENS,
      store: true,
    });

    return {
      text: response.output_text,
      responseId: response.id,
    };
  } catch {
    throw new AppError(502, "AI assistant is temporarily unavailable", "OPENAI_UNAVAILABLE");
  }
};
