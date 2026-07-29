import { Router } from "express";
import { z } from "zod";
import {
  cancelMyCommunityJoinRequest,
  createCommunityJoinRequest,
  createCommunityInvite,
  getCommunityRules,
  getCommunitySettings,
  listCommunityJoinRequests,
  listCommunityMembersDetailed,
  listMyCommunities,
  removeCommunityMember,
  replaceCommunityRules,
  reviewCommunityJoinRequest,
  transferCommunityOwnership,
  unbanCommunityMember,
  updateCommunityMember,
  updateCommunitySettings,
  banCommunityMember,
} from "../../Controller/communityManagement.controller";
import {
  createCommunity,
  getCommunity,
  joinCommunity,
  leaveCommunity,
  listCommunities,
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
import { createCommunityCall, endCommunityCall, getActiveCommunityCall, joinCommunityCall } from "../../Controller/communityCall.controller";
import {
  deleteCommunityMessage,
  deleteCommunityPost,
  markCommunityMessagesRead,
  setCommunityMessagePin,
  toggleCommunityReaction,
  updateCommunityMessage,
  updateCommunityNotificationPreference,
  updateCommunityPost,
  updateCommunityAnnouncement,
  deleteCommunityAnnouncement,
  createCommunityMessageReport,
} from "../../Controller/communityInteraction.controller";
import { authenticate, optionalAuthenticate } from "../../middleware/auth.middleware";
import { requireIdempotencyKey } from "../../middleware/idempotency.middleware";
import { validate } from "../../middleware/validate.middleware";
import { idParamsSchema, objectIdSchema, paginationSchema } from "../../schemas/common.schemas";
import { reportBodySchema } from "../../schemas/report.schemas";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();
const communityIdParams = z.object({ id: objectIdSchema });
const communityMemberParams = z.object({ id: objectIdSchema, userId: objectIdSchema });
const communityJoinRequestParams = z.object({ id: objectIdSchema, requestId: objectIdSchema });

const communityBodyBase = z.object({
  name: z.string().trim().min(3).max(100),
  description: z.string().trim().min(20).max(2000),
  imageUrl: z.string().url().optional(),
  coverImageUrl: z.string().url().optional(),
  avatarImageUrl: z.string().url().optional(),
  accessCode: z.string().trim().min(4).max(128).optional(),
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
const communityUpdateBody = communityBodyBase.partial()
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
const messageBody = z.object({
  clientMessageId: z.string().uuid(),
  text: z.string().trim().min(1).max(4000).optional(),
  attachmentIds: z.array(objectIdSchema).max(5).optional(),
  replyToMessageId: objectIdSchema.optional(),
}).strict().refine((value) => Boolean(value.text) || (value.attachmentIds?.length || 0) > 0, {
  message: "A message must include text or at least one attachment",
});
const messageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().trim().min(1).max(200).optional(),
}).strict();
const messageReportBody = z.object({
  reason: z.enum(["spam", "harassment", "hate_speech", "unsafe", "inappropriate", "other"]),
  details: z.string().trim().min(1).max(2000).optional(),
}).strict();
const rulesBody = z.object({
  introduction: z.string().trim().min(1).max(500),
  rules: z.array(z.object({
    _id: objectIdSchema.optional(),
    title: z.string().trim().min(2).max(100),
    description: z.string().trim().min(2).max(1000),
    order: z.number().int().min(0).max(1000),
  }).strict()).max(50),
  consequences: z.array(z.string().trim().min(1).max(300)).max(20),
}).strict();
const communitySettingsBody = z.object({
  joinPolicy: z.enum(["open", "approval", "invite_only", "access_code"]).optional(),
  accessCode: z.string().trim().min(4).max(128).optional(),
  messagePermission: z.enum(["everyone", "moderators"]).optional(),
  membersCanCreatePosts: z.boolean().optional(),
  membersCanInvite: z.boolean().optional(),
  showMemberList: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one setting is required",
});
const memberUpdateBody = z.object({
  role: z.enum(["moderator", "member"]).optional(),
  status: z.enum(["active", "removed"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one member field is required",
});
const joinRequestBody = z.object({
  message: z.string().trim().max(500).optional(),
  accessCode: z.string().trim().min(4).max(128).optional(),
  inviteToken: z.string().trim().min(8).max(256).optional(),
}).strict();
const reviewJoinRequestBody = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(500).optional(),
}).strict();
const banBody = z.object({
  reason: z.string().trim().min(2).max(500),
  expiresAt: z.coerce.date().optional(),
}).strict();
const memberQuery = paginationSchema.extend({
  role: z.enum(["owner", "moderator", "member"]).optional(),
  status: z.enum(["active", "banned"]).optional(),
});
const joinRequestQuery = paginationSchema.omit({ search: true }).extend({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
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
router.post("/", authenticate, validate({ body: communityBody }), asyncHandler(createCommunity));
router.get(
  "/membership-orders/:orderNumber/verify",
  authenticate,
  validate({ params: z.object({ orderNumber: z.string().min(12).max(80) }) }),
  asyncHandler(verifyCommunityMembershipOrder),
);
router.post(
  "/:id/membership-orders",
  authenticate,
  requireIdempotencyKey,
  validate({ params: communityIdParams }),
  asyncHandler(createCommunityMembershipOrder),
);

router.get("/:id/rules", optionalAuthenticate, validate({ params: communityIdParams }), asyncHandler(getCommunityRules));
router.put("/:id/rules", authenticate, validate({ params: communityIdParams, body: rulesBody }), asyncHandler(replaceCommunityRules));
router.get("/:id/settings", authenticate, validate({ params: communityIdParams }), asyncHandler(getCommunitySettings));
router.patch("/:id/settings", authenticate, validate({ params: communityIdParams, body: communitySettingsBody }), asyncHandler(updateCommunitySettings));

router.get("/:id/members", authenticate, validate({ params: communityIdParams, query: memberQuery }), asyncHandler(listCommunityMembersDetailed));
router.patch("/:id/members/:userId", authenticate, validate({ params: communityMemberParams, body: memberUpdateBody }), asyncHandler(updateCommunityMember));
router.delete("/:id/members/:userId", authenticate, validate({ params: communityMemberParams }), asyncHandler(removeCommunityMember));
router.put("/:id/bans/:userId", authenticate, validate({ params: communityMemberParams, body: banBody }), asyncHandler(banCommunityMember));
router.delete("/:id/bans/:userId", authenticate, validate({ params: communityMemberParams }), asyncHandler(unbanCommunityMember));

router.post("/:id/join-requests", authenticate, validate({ params: communityIdParams, body: joinRequestBody }), asyncHandler(createCommunityJoinRequest));
router.post("/:id/invites", authenticate, validate({ params: communityIdParams, body: z.object({ expiresAt: z.coerce.date().min(new Date()), maxUses: z.coerce.number().int().min(1).max(10000).optional() }).strict() }), asyncHandler(createCommunityInvite));
router.get("/:id/join-requests", authenticate, validate({ params: communityIdParams, query: joinRequestQuery }), asyncHandler(listCommunityJoinRequests));
router.patch("/:id/join-requests/:requestId", authenticate, validate({ params: communityJoinRequestParams, body: reviewJoinRequestBody }), asyncHandler(reviewCommunityJoinRequest));
router.delete("/:id/join-requests/me", authenticate, validate({ params: communityIdParams }), asyncHandler(cancelMyCommunityJoinRequest));

router.post("/:id/calls", authenticate, validate({ params: communityIdParams, body: z.object({ type: z.enum(["voice", "video"]), title: z.string().trim().min(1).max(120).optional() }).strict() }), asyncHandler(createCommunityCall));
router.get("/:id/calls/active", authenticate, validate({ params: communityIdParams }), asyncHandler(getActiveCommunityCall));
router.post("/:id/calls/:callId/join", authenticate, validate({ params: z.object({ id: objectIdSchema, callId: objectIdSchema }) }), asyncHandler(joinCommunityCall));
router.delete("/:id/calls/:callId", authenticate, validate({ params: z.object({ id: objectIdSchema, callId: objectIdSchema }) }), asyncHandler(endCommunityCall));

router.post("/:id/ownership-transfer", authenticate, validate({
  params: communityIdParams,
  body: z.object({ newOwnerId: objectIdSchema, currentPassword: z.string().min(1).max(128).optional() }).strict(),
}), asyncHandler(transferCommunityOwnership));

router.patch("/:id", authenticate, validate({ params: communityIdParams, body: communityUpdateBody }), asyncHandler(updateCommunity));
router.post("/:id/members", authenticate, validate({ params: communityIdParams }), asyncHandler(joinCommunity));
router.delete("/:id/members/me", authenticate, validate({ params: communityIdParams }), asyncHandler(leaveCommunity));

router.get("/:id/posts", authenticate, validate({ params: communityIdParams, query: contentQuery }), asyncHandler(listCommunityPosts));
router.post("/:id/posts", authenticate, validate({ params: communityIdParams, body: contentBody }), asyncHandler(createCommunityPost));
router.patch("/:id/posts/:postId", authenticate, validate({ params: z.object({ id: objectIdSchema, postId: objectIdSchema }), body: z.object({ text: z.string().trim().min(1).max(4000).optional(), imageUrl: z.string().url().nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0) }), asyncHandler(updateCommunityPost));
router.delete("/:id/posts/:postId", authenticate, validate({ params: z.object({ id: objectIdSchema, postId: objectIdSchema }) }), asyncHandler(deleteCommunityPost));
router.get("/:id/announcements", authenticate, validate({ params: communityIdParams, query: contentQuery }), asyncHandler(listCommunityAnnouncements));
router.post("/:id/announcements", authenticate, validate({ params: communityIdParams, body: contentBody }), asyncHandler(createCommunityAnnouncement));
router.patch("/:id/announcements/:announcementId", authenticate, validate({ params: z.object({ id: objectIdSchema, announcementId: objectIdSchema }), body: z.object({ text: z.string().trim().min(1).max(4000).optional(), imageUrl: z.string().url().nullable().optional(), pinned: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0) }), asyncHandler(updateCommunityAnnouncement));
router.delete("/:id/announcements/:announcementId", authenticate, validate({ params: z.object({ id: objectIdSchema, announcementId: objectIdSchema }) }), asyncHandler(deleteCommunityAnnouncement));
router.get("/:id/messages", authenticate, validate({ params: communityIdParams, query: messageQuery }), asyncHandler(listCommunityMessages));
router.put("/:id/messages/read", authenticate, validate({ params: communityIdParams, body: z.object({ lastReadMessageId: objectIdSchema }).strict() }), asyncHandler(markCommunityMessagesRead));
router.patch("/:id/notification-preferences/me", authenticate, validate({ params: communityIdParams, body: z.object({ level: z.enum(["all", "announcements", "mentions", "muted"]) }).strict() }), asyncHandler(updateCommunityNotificationPreference));
router.patch("/:id/messages/:messageId", authenticate, validate({ params: z.object({ id: objectIdSchema, messageId: objectIdSchema }), body: z.object({ text: z.string().trim().min(1).max(4000) }).strict() }), asyncHandler(updateCommunityMessage));
router.delete("/:id/messages/:messageId", authenticate, validate({ params: z.object({ id: objectIdSchema, messageId: objectIdSchema }) }), asyncHandler(deleteCommunityMessage));
router.put("/:id/messages/:messageId/reactions/:emoji", authenticate, validate({ params: z.object({ id: objectIdSchema, messageId: objectIdSchema, emoji: z.string().trim().min(1).max(32) }) }), asyncHandler((req, res) => toggleCommunityReaction(req, res, true)));
router.delete("/:id/messages/:messageId/reactions/:emoji", authenticate, validate({ params: z.object({ id: objectIdSchema, messageId: objectIdSchema, emoji: z.string().trim().min(1).max(32) }) }), asyncHandler((req, res) => toggleCommunityReaction(req, res, false)));
router.put("/:id/messages/:messageId/pin", authenticate, validate({ params: z.object({ id: objectIdSchema, messageId: objectIdSchema }) }), asyncHandler((req, res) => setCommunityMessagePin(req, res, true)));
router.delete("/:id/messages/:messageId/pin", authenticate, validate({ params: z.object({ id: objectIdSchema, messageId: objectIdSchema }) }), asyncHandler((req, res) => setCommunityMessagePin(req, res, false)));
router.post("/:id/messages/:messageId/reports", authenticate, validate({ params: z.object({ id: objectIdSchema, messageId: objectIdSchema }), body: messageReportBody }), asyncHandler(createCommunityMessageReport));
router.post("/:id/messages", authenticate, validate({ params: communityIdParams, body: messageBody }), asyncHandler(sendCommunityMessage));
router.post("/:id/reports", authenticate, validate({ params: communityIdParams, body: reportBodySchema }), asyncHandler(createTargetReport("community")));

router.get("/:id", optionalAuthenticate, validate({ params: communityIdParams }), asyncHandler(getCommunity));

export default router;
