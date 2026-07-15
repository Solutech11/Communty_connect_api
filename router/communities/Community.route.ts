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
import { authenticate, optionalAuthenticate } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate.middleware";
import { idParamsSchema, paginationSchema } from "../../schemas/common.schemas";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();
const communityBody = z.object({
  name: z.string().trim().min(3).max(100),
  description: z.string().trim().min(20).max(2000),
  imageUrl: z.string().url().optional(),
  category: z.string().trim().min(2).max(60),
  state: z.string().trim().max(80).optional(),
  lga: z.string().trim().max(100).optional(),
  visibility: z.enum(["public", "private"]).default("public"),
}).strict();

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
router.get("/:id", optionalAuthenticate, validate({ params: idParamsSchema }), asyncHandler(getCommunity));
router.post("/", authenticate, validate({ body: communityBody }), asyncHandler(createCommunity));
router.patch(
  "/:id",
  authenticate,
  validate({ params: idParamsSchema, body: communityBody.partial().refine((v) => Object.keys(v).length > 0) }),
  asyncHandler(updateCommunity),
);
router.post("/:id/members", authenticate, validate({ params: idParamsSchema }), asyncHandler(joinCommunity));
router.delete("/:id/members/me", authenticate, validate({ params: idParamsSchema }), asyncHandler(leaveCommunity));
router.get("/:id/members", authenticate, validate({ params: idParamsSchema }), asyncHandler(listMembers));

export default router;
