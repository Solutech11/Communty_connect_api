import { Router } from "express";
import { z } from "zod";
import {
  USER_PARTICIPATION_ROLES,
  USER_PREFERRED_GROUP_SIZES,
  USER_PREFERRED_SETTINGS,
} from "../../Constant";
import {
  changePassword,
  deleteAccount,
  getProfile,
  registerPushToken,
  removePushToken,
  updateProfile,
  updateProfileAvatar,
} from "../../Controller/user.controller";
import { createTargetReport } from "../../Controller/report.controller";
import { listMyCommunities, listMyCommunityJoinRequests } from "../../Controller/communityManagement.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { imageUpload } from "../../middleware/imageUpload.middleware";
import { validate } from "../../middleware/validate.middleware";
import { idParamsSchema, passwordSchema } from "../../schemas/common.schemas";
import { reportBodySchema } from "../../schemas/report.schemas";
import { listUserBlocks, blockUser, unblockUser } from "../../Controller/userBlock.controller";
import { roommatePageSchema } from "../../schemas/roommate.schemas";
import { objectIdSchema } from "../../schemas/common.schemas";
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
router.get("/me/blocks", validate({ query: roommatePageSchema }), asyncHandler(listUserBlocks));
router.put("/me/blocks/:userId", validate({ params: z.object({ userId: objectIdSchema }) }), asyncHandler(blockUser));
router.delete("/me/blocks/:userId", validate({ params: z.object({ userId: objectIdSchema }) }), asyncHandler(unblockUser));
router.get("/me", asyncHandler(getProfile));
router.get(
  "/me/communities",
  validate({
    query: z.object({
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      search: z.string().trim().max(100).optional(),
      role: z.enum(["owner", "moderator", "member"]).optional(),
      status: z.enum(["pending", "active"]).optional(),
      unreadOnly: z.enum(["true", "false"]).optional(),
    }).strict(),
  }),
  asyncHandler(listMyCommunities),
);
router.get(
  "/me/community-join-requests",
  validate({ query: z.object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }).strict() }),
  asyncHandler(listMyCommunityJoinRequests),
);
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
      preferredSetting: z.enum(USER_PREFERRED_SETTINGS).optional(),
      preferredGroupSize: z.enum(USER_PREFERRED_GROUP_SIZES).optional(),
      // This field personalizes the experience and does not grant permissions.
      participationRole: z.enum(USER_PARTICIPATION_ROLES).optional(),
      hobbies: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    }).strict().refine((value) => Object.keys(value).length > 0),
  }),
  asyncHandler(updateProfile),
);
router.patch(
  "/me/avatar",
  imageUpload.single("image"),
  asyncHandler(updateProfileAvatar),
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
