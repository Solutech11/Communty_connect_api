import { Router } from "express";
import { paystackWebhook } from "../../Controller/webhook.controller";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();
router.post("/paystack", asyncHandler(paystackWebhook));

export default router;
