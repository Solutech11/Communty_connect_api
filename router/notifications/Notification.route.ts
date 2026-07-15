import { Router } from "express";
import { z } from "zod";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../Controller/notification.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate.middleware";
import { idParamsSchema, paginationSchema } from "../../schemas/common.schemas";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();
router.use(authenticate);
router.get(
  "/",
  validate({
    query: paginationSchema.extend({
      type: z.string().max(60).optional(),
      unread: z.enum(["true", "false"]).optional(),
    }),
  }),
  asyncHandler(listNotifications),
);
router.patch("/read-all", asyncHandler(markAllNotificationsRead));
router.patch("/:id/read", validate({ params: idParamsSchema }), asyncHandler(markNotificationRead));

export default router;
