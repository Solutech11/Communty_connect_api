import { Router } from "express";
import { z } from "zod";
import {
  changePassword,
  deleteAccount,
  getProfile,
  registerPushToken,
  removePushToken,
  updateProfile,
} from "../../Controller/user.controller";
import { createTargetReport } from "../../Controller/report.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate.middleware";
import { idParamsSchema, passwordSchema } from "../../schemas/common.schemas";
import { reportBodySchema } from "../../schemas/report.schemas";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();
const pushToken = z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/);
// Mobile clients must send GeoJSON order: [longitude, latitude].
const geoPoint = z.object({
  type: z.literal("Point").default("Point"),
  coordinates: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ]),
}).strict();

router.use(authenticate);
router.get("/me", asyncHandler(getProfile));
router.post(
  "/:id/reports",
  validate({ params: idParamsSchema, body: reportBodySchema }),
  asyncHandler(createTargetReport("user")),
);
router.patch(
  "/me",
  validate({
    body: z.object({
      firstName: z.string().trim().min(2).max(60).optional(),
      lastName: z.string().trim().min(2).max(60).optional(),
      phone: z.string().trim().min(7).max(24).optional(),
      bio: z.string().trim().max(500).optional(),
      avatarUrl: z.string().url().optional(),
      country: z.string().trim().max(80).optional(),
      state: z.string().trim().max(80).optional(),
      lga: z.string().trim().max(100).optional(),
      location: geoPoint.optional(),
      interests: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    }).strict().refine((value) => Object.keys(value).length > 0),
  }),
  asyncHandler(updateProfile),
);
router.patch(
  "/me/password",
  validate({
    body: z.object({
      currentPassword: z.string().min(1).max(128),
      newPassword: passwordSchema,
    }).strict(),
  }),
  asyncHandler(changePassword),
);
router.post(
  "/me/push-tokens",
  validate({ body: z.object({ token: pushToken }).strict() }),
  asyncHandler(registerPushToken),
);
router.delete(
  "/me/push-tokens",
  validate({ body: z.object({ token: pushToken }).strict() }),
  asyncHandler(removePushToken),
);
router.delete(
  "/me",
  validate({ body: z.object({ password: z.string().min(1).max(128) }).strict() }),
  asyncHandler(deleteAccount),
);

export default router;
