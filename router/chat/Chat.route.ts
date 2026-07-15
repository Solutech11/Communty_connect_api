import { Router } from "express";
import { z } from "zod";
import {
  createConversation,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
} from "../../Controller/chat.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate.middleware";
import { idParamsSchema, objectIdSchema } from "../../schemas/common.schemas";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();
router.use(authenticate);
router.get("/conversations", asyncHandler(listConversations));
router.post(
  "/conversations",
  validate({
    body: z.object({
      type: z.enum(["direct", "group", "support"]),
      title: z.string().trim().min(2).max(120).optional(),
      participantIds: z.array(objectIdSchema).min(1).max(99),
    }).strict(),
  }),
  asyncHandler(createConversation),
);
router.get(
  "/conversations/:id/messages",
  validate({
    params: idParamsSchema,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      before: z.coerce.date().optional(),
    }),
  }),
  asyncHandler(listMessages),
);
router.post(
  "/conversations/:id/messages",
  validate({
    params: idParamsSchema,
    body: z.object({
      clientMessageId: z.string().min(8).max(128),
      type: z.enum(["text", "image"]).default("text"),
      text: z.string().trim().min(1).max(4000).optional(),
      mediaUrl: z.string().url().optional(),
    }).strict().refine((value) => Boolean(value.text || value.mediaUrl), {
      message: "A text or media URL is required",
    }),
  }),
  asyncHandler(sendMessage),
);
router.post(
  "/conversations/:id/read",
  validate({ params: idParamsSchema }),
  asyncHandler(markConversationRead),
);

export default router;
