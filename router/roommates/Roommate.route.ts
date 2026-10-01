import { Router } from "express";
import { z } from "zod";
import * as controller from "../../Controller/roommate.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate.middleware";
import { roommateRateLimiter } from "../../middleware/security.middleware";
import { asyncHandler } from "../../utils/asyncHandler.utils";
import { idParamsSchema, objectIdSchema } from "../../schemas/common.schemas";
import { roommateDraftSchema, roommatePageSchema, contactConsentSchema } from "../../schemas/roommate.schemas";

const router = Router();
router.use(authenticate, roommateRateLimiter);
router.get("/questions", asyncHandler(controller.roommateQuestions));
router.get("/profiles/me", asyncHandler(controller.getRoommateProfile));
router.put("/profiles/me", validate({ body: roommateDraftSchema }), asyncHandler(controller.saveRoommateProfile));
router.patch("/profiles/me/visibility", validate({ body: z.object({
  visibility: z.enum(["discoverable", "paused"]),
}).strict() }), asyncHandler(controller.setRoommateVisibility));
router.get("/candidates", validate({ query: roommatePageSchema }), asyncHandler(controller.listRoommateCandidates));
router.put("/decisions/:userId", validate({ params: z.object({ userId: objectIdSchema }),
  body: z.object({ action: z.enum(["like", "pass"]) }).strict(),
}), asyncHandler(controller.decideRoommate));
router.get("/connections", validate({ query: roommatePageSchema }), asyncHandler(controller.listRoommateConnections));
router.get("/connections/:id", validate({ params: idParamsSchema }), asyncHandler(controller.getRoommateConnection));
router.delete("/connections/:id", validate({ params: idParamsSchema }), asyncHandler(controller.endRoommateConnection));
router.put("/connections/:id/contact-consents/me", validate({ params: idParamsSchema, body: contactConsentSchema }), asyncHandler(controller.saveRoommateConsent));
router.delete("/connections/:id/contact-consents/me", validate({ params: idParamsSchema }), asyncHandler(controller.revokeRoommateConsent));
router.get("/connections/:id/contacts", validate({ params: idParamsSchema }), asyncHandler(controller.getRoommateContacts));
router.post("/connections/:id/requests", validate({ params: idParamsSchema }), asyncHandler(controller.requestRoommatePairing));
router.patch("/connections/:id/requests/:requestId", validate({
  params: z.object({ id: objectIdSchema, requestId: objectIdSchema }),
  body: z.object({ action: z.enum(["accept", "decline", "cancel"]) }).strict(),
}), asyncHandler(controller.respondRoommatePairing));
router.delete("/connections/:id/pairing", validate({ params: idParamsSchema }), asyncHandler(controller.endRoommateConnection));
export default router;
