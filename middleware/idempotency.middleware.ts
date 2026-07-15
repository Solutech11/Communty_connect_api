import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../utils/AppError";

const keySchema = z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/);

export const requireIdempotencyKey = (
  request: Request,
  _response: Response,
  next: NextFunction,
): void => {
  const parsed = keySchema.safeParse(request.header("idempotency-key"));

  if (!parsed.success) {
    next(
      new AppError(
        400,
        "A valid Idempotency-Key header is required",
        "IDEMPOTENCY_KEY_REQUIRED",
      ),
    );
    return;
  }

  request.idempotencyKey = parsed.data;
  next();
};
