import { Router } from "express";
import { z } from "zod";
import {
  getTicketOrder,
  listMyTickets,
  resumeTicketCheckout,
  verifyTicketOrder,
} from "../../Controller/ticket.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireIdempotencyKey } from "../../middleware/idempotency.middleware";
import { validate } from "../../middleware/validate.middleware";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();
const orderParams = z.object({
  orderNumber: z.string().regex(/^CC-\d+-[A-F0-9]{8}$/),
});

router.use(authenticate);
router.get("/", asyncHandler(listMyTickets));
router.get("/:orderNumber", validate({ params: orderParams }), asyncHandler(getTicketOrder));
router.post(
  "/:orderNumber/checkout",
  validate({ params: orderParams, body: z.object({}).strict().optional() }),
  requireIdempotencyKey,
  asyncHandler(resumeTicketCheckout),
);
router.get(
  "/:orderNumber/verify",
  validate({ params: orderParams }),
  asyncHandler(verifyTicketOrder),
);

export default router;
