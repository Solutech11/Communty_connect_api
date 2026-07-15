export const USER_ROLES = ["member", "moderator", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const EVENT_STATUSES = ["draft", "published", "cancelled", "completed"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const TRANSACTION_STATUSES = [
  "pending",
  "processing",
  "successful",
  "failed",
  "reversed",
] as const;

export const DISPUTE_STATUSES = [
  "open",
  "under_review",
  "awaiting_user",
  "resolved",
  "closed",
] as const;

export const ACCESS_TOKEN_TYPE = "access";
export const REFRESH_TOKEN_TYPE = "refresh";
export const KOBO_PER_NAIRA = 100;

export const CACHE_KEYS = {
  banks: "paystack:banks:ngn",
  idempotency: (userId: string, key: string) => `idempotency:${userId}:${key}`,
  lock: (scope: string, id: string) => `lock:${scope}:${id}`,
  otpCooldown: (email: string, purpose: string) => `otp:${purpose}:${email}`,
} as const;
