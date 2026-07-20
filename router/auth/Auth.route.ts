import { Router } from "express";
import { z } from "zod";
import {
  forgotPassword,
  login,
  logout,
  refreshSession,
  register,
  resendVerification,
  resetPassword,
  verifyEmail,
} from "../../Controller/auth.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate.middleware";
import { asyncHandler } from "../../utils/asyncHandler.utils";
import { passwordSchema } from "../../schemas/common.schemas";

const router = Router();
const email = z.string().trim().email().max(254);
const otp = z.string().regex(/^\d{6}$/);
// GeoJSON requires longitude before latitude. Requiring both values prevents
// persisting malformed points that MongoDB's 2dsphere index would reject.
const geoPoint = z.object({
  type: z.literal("Point").default("Point"),
  coordinates: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ]),
}).strict();

router.post(
  "/register",
  validate({
    body: z.object({
      firstName: z.string().trim().min(2).max(60),
      lastName: z.string().trim().min(2).max(60),
      email,
      password: passwordSchema,
      phone: z.string().trim().min(7).max(24).optional(),
      location: geoPoint.optional(),
    }).strict(),
  }),
  asyncHandler(register),
);

router.post(
  "/verify-email",
  validate({ body: z.object({ email, otp }).strict() }),
  asyncHandler(verifyEmail),
);

router.post(
  "/resend-verification",
  validate({ body: z.object({ email }).strict() }),
  asyncHandler(resendVerification),
);

router.post(
  "/login",
  validate({ body: z.object({ email, password: z.string().min(1).max(128) }).strict() }),
  asyncHandler(login),
);

router.post(
  "/refresh",
  validate({ body: z.object({ refreshToken: z.string().min(100).max(4096) }).strict() }),
  asyncHandler(refreshSession),
);

router.post(
  "/logout",
  authenticate,
  validate({ body: z.object({ refreshToken: z.string().min(100).max(4096) }).strict() }),
  asyncHandler(logout),
);

router.post(
  "/forgot-password",
  validate({ body: z.object({ email }).strict() }),
  asyncHandler(forgotPassword),
);

router.post(
  "/reset-password",
  validate({ body: z.object({ email, otp, newPassword: passwordSchema }).strict() }),
  asyncHandler(resetPassword),
);

export default router;
