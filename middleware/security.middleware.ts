import compression from "compression";
import cors, { type CorsOptions } from "cors";
import type { NextFunction, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { slowDown } from "express-slow-down";
import helmet from "helmet";
import hpp from "hpp";
import { RedisStore } from "rate-limit-redis";
import { env } from "../Config/env";
import { redisClient } from "../DB/redis";
import { AppError } from "../utils/AppError";

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Native mobile requests usually have no Origin header. Browser origins remain allowlisted.
    if (!origin || env.allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new AppError(403, "Origin is not allowed", "CORS_ORIGIN_DENIED"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Request-Id"],
  exposedHeaders: ["X-Request-Id", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"],
  credentials: false,
  maxAge: 86400,
};

const rateLimitStore = (prefix: string) => {
  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) => redisClient.sendCommand(args),
  });
};

export const securityMiddleware = [
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: env.isProduction ? undefined : false,
  }),
  cors(corsOptions),
  compression(),
  hpp(),
];

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: rateLimitStore("rl:global:"),
  message: {
    success: false,
    error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests. Try again later." },
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: rateLimitStore("rl:auth:"),
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: { code: "AUTH_RATE_LIMIT_EXCEEDED", message: "Too many authentication attempts." },
  },
});

export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: rateLimitStore("rl:ai:"),
  keyGenerator: (request) => request.auth?.id || request.ip || "unknown",
});

export const requestSlowdown = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 100,
  delayMs: (hits) => Math.min((hits - 100) * 50, 2_000),
});

const inspectKeys = (value: unknown, depth = 0): void => {
  if (depth > 12) {
    throw new AppError(400, "Request object is too deeply nested", "REQUEST_TOO_DEEP");
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      inspectKeys(item, depth + 1);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith("$") || key.includes(".")) {
        throw new AppError(400, "Request contains a forbidden key", "FORBIDDEN_REQUEST_KEY");
      }
      inspectKeys(child, depth + 1);
    }
  }
};

export const rejectMongoOperators = (
  request: Request,
  _response: Response,
  next: NextFunction,
): void => {
  try {
    inspectKeys(request.body);
    inspectKeys(request.query);
    inspectKeys(request.params);
    next();
  } catch (error) {
    next(error);
  }
};
