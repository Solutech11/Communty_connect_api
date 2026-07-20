import { Router } from "express";
import { z } from "zod";
import {
  createCommunity,
  getCommunity,
  joinCommunity,
  leaveCommunity,
  listCommunities,
  listMembers,
  updateCommunity,
} from "../../Controller/community.controller";
import {
  createCommunityAnnouncement,
  createCommunityPost,
  listCommunityAnnouncements,
  listCommunityMessages,
  listCommunityPosts,
  sendCommunityMessage,
} from "../../Controller/communityContent.controller";
import {
  createCommunityMembershipOrder,
  verifyCommunityMembershipOrder,
} from "../../Controller/communityPayment.controller";
import { createTargetReport } from "../../Controller/report.controller";
import { authenticate, optionalAuthenticate } from "../../middleware/auth.middleware";
import { requireIdempotencyKey } from "../../middleware/idempotency.middleware";
import { validate } from "../../middleware/validate.middleware";
import { idParamsSchema, paginationSchema } from "../../schemas/common.schemas";
import { reportBodySchema } from "../../schemas/report.schemas";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();
const communityBodyBase = z.object({
  name: z.string().trim().min(3).max(100),
  description: z.string().trim().min(20).max(2000),
  imageUrl: z.string().url().optional(),
  category: z.string().trim().min(2).max(60),
  state: z.string().trim().max(80).optional(),
  lga: z.string().trim().max(100).optional(),
  visibility: z.enum(["public", "private"]).default("public"),
  membershipType: z.enum(["free", "premium"]).default("free"),
  membershipPriceKobo: z.number().int().min(0).max(100_000_000_00).default(0),
}).strict();
const validMembershipPrice = (value: { membershipType?: string; membershipPriceKobo?: number }) => {
  return value.membershipType !== "premium" || (value.membershipPriceKobo || 0) > 0;
};
const communityBody = communityBodyBase.refine(validMembershipPrice, {
  message: "Premium communities require a positive membership price",
  path: ["membershipPriceKobo"],
});
const communityUpdateBody = communityBodyBase
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" })
  .refine(validMembershipPrice, {
    message: "Premium communities require a positive membership price",
    path: ["membershipPriceKobo"],
  });
const contentQuery = paginationSchema.omit({ search: true });
const contentBody = z.object({
  text: z.string().trim().min(1).max(4000),
  imageUrl: z.string().url().optional(),
}).strict();
const messageBody = contentBody.extend({
  clientMessageId: z.string().trim().min(8).max(128),
});

router.get(
  "/",
  validate({
    query: paginationSchema.extend({
      category: z.string().max(60).optional(),
      state: z.string().max(80).optional(),
      lga: z.string().max(100).optional(),
    }),
  }),
  asyncHandler(listCommunities),
);
router.post(
  "/:id/membership-orders",
  authenticate,
  requireIdempotencyKey,
  validate({ params: idParamsSchema }),
  asyncHandler(createCommunityMembershipOrder),
);
router.get(
  "/membership-orders/:orderNumber/verify",
  authenticate,
  validate({ params: z.object({ orderNumber: z.string().min(12).max(80) }) }),
  asyncHandler(verifyCommunityMembershipOrder),
);
router.get("/:id", optionalAuthenticate, validate({ params: idParamsSchema }), asyncHandler(getCommunity));
router.post("/", authenticate, validate({ body: communityBody }), asyncHandler(createCommunity));
router.patch(
  "/:id",
  authenticate,
  validate({ params: idParamsSchema, body: communityUpdateBody }),
  asyncHandler(updateCommunity),
);
router.post("/:id/members", authenticate, validate({ params: idParamsSchema }), asyncHandler(joinCommunity));
router.delete("/:id/members/me", authenticate, validate({ params: idParamsSchema }), asyncHandler(leaveCommunity));
router.get("/:id/members", authenticate, validate({ params: idParamsSchema }), asyncHandler(listMembers));

router.get(
  "/:id/posts",
  authenticate,
  validate({ params: idParamsSchema, query: contentQuery }),
  asyncHandler(listCommunityPosts),
);
router.post(
  "/:id/posts",
  authenticate,
  validate({ params: idParamsSchema, body: contentBody }),
  asyncHandler(createCommunityPost),
);
router.get(
  "/:id/announcements",
  authenticate,
  validate({ params: idParamsSchema, query: contentQuery }),
  asyncHandler(listCommunityAnnouncements),
);
router.post(
  "/:id/announcements",
  authenticate,
  validate({ params: idParamsSchema, body: contentBody }),
  asyncHandler(createCommunityAnnouncement),
);
router.get(
  "/:id/messages",
  authenticate,
  validate({ params: idParamsSchema, query: contentQuery }),
  asyncHandler(listCommunityMessages),
);
router.post(
  "/:id/messages",
  authenticate,
  validate({ params: idParamsSchema, body: messageBody }),
  asyncHandler(sendCommunityMessage),
);
router.post(
  "/:id/reports",
  authenticate,
  validate({ params: idParamsSchema, body: reportBodySchema }),
  asyncHandler(createTargetReport("community")),
);

export default router;
