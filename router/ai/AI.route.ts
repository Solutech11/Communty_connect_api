import { Router } from "express";
import { z } from "zod";
import {
  assistantChat,
  deleteAISession,
  generateEventCopy,
  listAISessions,
  recommendEvents,
  summarizeConversation,
} from "../../Community_AI/AI.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate.middleware";
import { idParamsSchema, objectIdSchema } from "../../schemas/common.schemas";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();
router.use(authenticate);
router.post(
  "/chat",
  validate({
    body: z.object({
      message: z.string().trim().min(1).max(4000),
      sessionId: objectIdSchema.optional(),
    }).strict(),
  }),
  asyncHandler(assistantChat),
);
router.post(
  "/event-copy",
  validate({
    body: z.object({
      title: z.string().trim().min(2).max(140),
      activityType: z.string().trim().min(2).max(60),
      targetAudience: z.string().trim().max(80).optional(),
      setting: z.string().trim().max(40).optional(),
      details: z.string().trim().max(3000).optional(),
    }).strict(),
  }),
  asyncHandler(generateEventCopy),
);
router.post(
  "/event-recommendations",
  validate({
    body: z.object({
      preferences: z.record(z.string(), z.unknown()).default({}),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
      radiusKm: z.number().positive().max(500).default(100),
      limit: z.number().int().min(1).max(50).default(20),
    }).strict().refine(
      (value) => (value.latitude === undefined) === (value.longitude === undefined),
      { message: "Latitude and longitude must be supplied together" },
    ),
  }),
  asyncHandler(recommendEvents),
);
router.post(
  "/conversations/:id/summary",
  validate({ params: idParamsSchema }),
  asyncHandler(summarizeConversation),
);
router.get("/sessions", asyncHandler(listAISessions));
router.delete("/sessions/:id", validate({ params: idParamsSchema }), asyncHandler(deleteAISession));

export default router;
