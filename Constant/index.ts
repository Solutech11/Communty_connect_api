export const USER_ROLES = ["member", "moderator", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_PREFERRED_SETTINGS = ["indoor", "outdoor"] as const;
export type UserPreferredSetting = (typeof USER_PREFERRED_SETTINGS)[number];

export const USER_PREFERRED_GROUP_SIZES = ["small", "medium", "large"] as const;
export type UserPreferredGroupSize = (typeof USER_PREFERRED_GROUP_SIZES)[number];

// This is a personalization preference only. Authorization continues to use
// USER_ROLES and must never depend on this value.
export const USER_PARTICIPATION_ROLES = ["participant", "organizer"] as const;
export type UserParticipationRole = (typeof USER_PARTICIPATION_ROLES)[number];

export const EVENT_STATUSES = [
  "draft",
  "pending_approval",
  "published",
  "rejected",
  "deactivated",
  "cancelled",
  "completed",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const PLATFORM_CHARGE_TYPES = [
  "deposit",
  "withdrawal",
  "ticket_purchase",
  "community_membership",
] as const;
export type PlatformChargeType = (typeof PLATFORM_CHARGE_TYPES)[number];

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
