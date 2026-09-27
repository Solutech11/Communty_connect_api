import { Router } from "express";
import { reverseLocation, searchLocations } from "../../Controller/location.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { locationSearchRateLimiter } from "../../middleware/security.middleware";
import { validate } from "../../middleware/validate.middleware";
import { locationReverseQuerySchema, locationSearchQuerySchema } from "../../schemas/location.schemas";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();
router.get("/reverse", locationSearchRateLimiter, validate({ query: locationReverseQuerySchema }), asyncHandler(reverseLocation));
router.use(authenticate);
router.get("/search", locationSearchRateLimiter, validate({ query: locationSearchQuerySchema }), asyncHandler(searchLocations));

export default router;
