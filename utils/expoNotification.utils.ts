import axios from "axios";
import { env } from "../Config/env";
import { logger } from "./logger.utils";

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

const isExpoPushToken = (token: string): boolean => {
  return /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(token);
};

export const sendExpoPushNotifications = async (input: {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<string[]> => {
  const validTokens = [...new Set(input.tokens)].filter(isExpoPushToken);

  if (validTokens.length === 0) {
    return [];
  }

  const chunks: string[][] = [];

  for (let index = 0; index < validTokens.length; index += 100) {
    chunks.push(validTokens.slice(index, index + 100));
  }

  const ticketIds: string[] = [];

  for (const chunk of chunks) {
    const messages = chunk.map((token) => ({
      to: token,
      title: input.title,
      body: input.body,
      data: input.data,
      sound: "default",
      priority: "high",
    }));

    try {
      const response = await axios.post<{ data: ExpoTicket[] }>(
        "https://exp.host/--/api/v2/push/send",
        messages,
        {
          timeout: 15_000,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(env.EXPO_ACCESS_TOKEN
              ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` }
              : {}),
          },
        },
      );

      for (const ticket of response.data.data) {
        if (ticket.status === "ok" && ticket.id) {
          ticketIds.push(ticket.id);
        }
      }
    } catch (error) {
      // Push delivery is best-effort and must not roll back the originating domain transaction.
      logger.warn({ error }, "Expo push request failed");
    }
  }

  return ticketIds;
};
