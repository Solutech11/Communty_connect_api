import { Router } from "express";
import { z } from "zod";
import {
  listFriendRequests,
  listFriends,
  removeFriend,
  respondToFriendRequest,
  sendFriendRequest,
  suggestions,
} from "../../Controller/friend.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate.middleware";
import { idParamsSchema, objectIdSchema } from "../../schemas/common.schemas";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();
router.use(authenticate);
router.get("/", asyncHandler(listFriends));
router.get("/requests", asyncHandler(listFriendRequests));
router.get("/suggestions", asyncHandler(suggestions));
router.post(
  "/requests/:userId",
  validate({ params: z.object({ userId: objectIdSchema }) }),
  asyncHandler(sendFriendRequest),
);
router.patch(
  "/requests/:id",
  validate({ params: idParamsSchema, body: z.object({ action: z.enum(["accept", "decline", "reject"]) }).strict() }),
  asyncHandler(respondToFriendRequest),
);
router.delete("/:id", validate({ params: idParamsSchema }), asyncHandler(removeFriend));

export default router;
