import axios from "axios";
import { env } from "../Config/env";
import { AppError } from "../utils/AppError";
import { logger } from "../utils/logger.utils";

// Keep provider authentication server-side. Request/response bodies are never
// logged because prompts can contain private community or conversation data.
const groq = axios.create({
  baseURL: env.GROQ_BASE_URL,
  timeout: 30_000,
  headers: {
    Authorization: `Bearer ${env.GROQ_API_KEY}`,
    "Content-Type": "application/json",
  },
});

// Prompts are server-owned so clients cannot redefine provider safety rules.
const SYSTEM_PROMPTS = {
  assistant:
    "You are Community Connect AI, a concise and friendly assistant. Help users discover safe local events, plan community gatherings, understand app features, and communicate respectfully. Never claim an action happened unless app state proves it. Do not provide financial guarantees or expose private data.",
  event_copy:
    "You are an event copy editor. Produce clear, welcoming, inclusive event copy using only supplied facts. Never invent a venue, price, host credential, date, or accessibility claim.",
  recommendations:
    "You explain only supplied Community Connect recommendations. Never invent events or claim real-time availability beyond supplied data.",
  chat_summary:
    "Summarize the supplied conversation into decisions, open questions, and action items. Avoid repeating sensitive personal data.",
} as const;

export type AIPurpose = keyof typeof SYSTEM_PROMPTS;
export interface AIMessage {
  role: "user" | "assistant";
  content: string;
}

interface GroqCompletion {
  id: string;
  choices: Array<{
    message?: { content?: string | null };
  }>;
}

export const createAIResponse = async (input: {
  purpose: AIPurpose;
  prompt: string;
  history?: AIMessage[];
}): Promise<{ text: string; responseId: string }> => {
  try {
    const response = await groq.post<GroqCompletion>("/chat/completions", {
      model: env.GROQ_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPTS[input.purpose] },
        ...(input.history || []),
        { role: "user", content: input.prompt },
      ],
      temperature: 0.4,
      // Low hidden reasoning controls GPT-OSS cost and avoids returning traces.
      reasoning_effort: "low",
      reasoning_format: "hidden",
      max_completion_tokens: env.GROQ_MAX_OUTPUT_TOKENS,
    });
    const text = response.data.choices[0]?.message?.content?.trim();

    if (!text) {
      throw new Error("Groq returned an empty completion");
    }

    return {
      text,
      responseId: response.data.id,
    };
  } catch (error) {
    // Log only the operation and HTTP status, never prompts, keys, or output.
    logger.warn(
      {
        operation: "groq_chat_completion",
        providerStatus: axios.isAxiosError(error) ? error.response?.status : undefined,
      },
      "Groq request failed",
    );
    throw new AppError(502, "AI assistant is temporarily unavailable", "GROQ_UNAVAILABLE");
  }
};
