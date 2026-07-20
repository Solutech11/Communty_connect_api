import { z } from "zod";

export const reportBodySchema = z.object({
  reason: z.enum([
    "spam",
    "harassment",
    "hate",
    "violence",
    "scam",
    "unsafe",
    "misinformation",
    "other",
  ]),
  details: z.string().trim().min(10).max(2000).optional(),
}).strict();
