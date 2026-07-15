import { Router } from "express";
import { z } from "zod";
import {
  createDispute,
  getDispute,
  listDisputes,
  replyToDispute,
  updateDisputeStatus,
} from "../../Controller/dispute.controller";
import { authenticate, authorize } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate.middleware";
import { idParamsSchema, objectIdSchema } from "../../schemas/common.schemas";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();
router.use(authenticate);
router.post(
  "/",
  validate({
    body: z.object({
      transactionId: objectIdSchema.optional(),
      category: z.enum(["payment", "withdrawal", "transfer", "ticket", "event", "harassment", "other"]),
      subject: z.string().trim().min(5).max(160),
      description: z.string().trim().min(20).max(5000),
    }).strict(),
  }),
  asyncHandler(createDispute),
);
router.get(
  "/",
  validate({
    query: z.object({
      status: z.enum(["open", "under_review", "awaiting_user", "resolved", "closed"]).optional(),
    }),
  }),
  asyncHandler(listDisputes),
);
router.get("/:id", validate({ params: idParamsSchema }), asyncHandler(getDispute));
router.post(
  "/:id/messages",
  validate({
    params: idParamsSchema,
    body: z.object({
      message: z.string().trim().min(1).max(3000),
      attachments: z.array(z.string().url()).max(5).optional(),
      internal: z.boolean().optional(),
    }).strict(),
  }),
  asyncHandler(replyToDispute),
);
router.patch(
  "/:id/status",
  authorize("admin"),
  validate({
    params: idParamsSchema,
    body: z.object({
      status: z.enum(["open", "under_review", "awaiting_user", "resolved", "closed"]),
      resolution: z.string().trim().max(3000).optional(),
    }).strict(),
  }),
  asyncHandler(updateDisputeStatus),
);

export default router;
