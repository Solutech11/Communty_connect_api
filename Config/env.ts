import "dotenv/config";
import { z } from "zod";

const durationPattern = /^\d+(s|m|h|d)$/;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(5000),
  API_PREFIX: z.string().startsWith("/").default("/api/v1"),
  APP_NAME: z.string().min(1).default("Community Connect"),
  APP_BASE_URL: z.string().url().default("http://localhost:5000"),
  FRONTEND_URLS: z.string().default("http://localhost:8081,http://localhost:19006"),
  TRUST_PROXY: z.coerce.number().int().min(0).max(3).default(1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  LOG_REQUEST_BODIES: z.enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(64),
  JWT_REFRESH_SECRET: z.string().min(64),
  JWT_ISSUER: z.string().min(1).default("community-connect-api"),
  JWT_AUDIENCE: z.string().min(1).default("community-connect-mobile"),
  ACCESS_TOKEN_TTL: z.string().regex(durationPattern).default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(180).default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  OTP_PEPPER: z.string().min(32),
  FIELD_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  PAYSTACK_SECRET_KEY: z.string().min(10),
  PAYSTACK_PUBLIC_KEY: z.string().min(10),
  PAYSTACK_BASE_URL: z.string().url().default("https://api.paystack.co"),
  PAYSTACK_CALLBACK_URL: z.string().min(1),
  WEB_BASE_URL: z.string().url().or(z.literal("")).default(""),
  PAYSTACK_CURRENCY: z.string().length(3).default("NGN"),
  MIN_TOPUP_KOBO: z.coerce.number().int().positive().default(10000),
  MIN_WITHDRAWAL_KOBO: z.coerce.number().int().positive().default(100000),
  DEPOSIT_CHARGE_BPS: z.coerce.number().int().min(0).max(10_000).default(100),
  WITHDRAWAL_CHARGE_BPS: z.coerce.number().int().min(0).max(10_000).default(100),
  TICKET_CHARGE_BPS: z.coerce.number().int().min(0).max(10_000).default(500),
  COMMUNITY_CHARGE_BPS: z.coerce.number().int().min(0).max(10_000).default(500),
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  ZEPTOMAIL_API_URL: z.string().url().default("https://api.zeptomail.com/v1.1/email"),
  ZEPTOMAIL_SEND_MAIL_TOKEN: z.string().default(""),
  MAIL_FROM_ADDRESS: z.string().email(),
  MAIL_FROM_NAME: z.string().min(1).default("Community Connect"),
  GROQ_API_KEY: z.string().min(1),
  GROQ_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  GROQ_MODEL: z.string().min(1).default("openai/gpt-oss-20b"),
  GROQ_MODERATION_MODEL: z.string().min(1).default("qwen/qwen3.8-27b"),
  GROQ_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(100).max(4000).default(800),
  EVENT_AUTO_APPROVE_FOR_TESTING: z.enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  GEOAPIFY_API_KEY: z.string().trim().default(""),
  EXPO_ACCESS_TOKEN: z.string().optional().default(""),
  MAX_IMAGE_SIZE_BYTES: z.coerce.number().int().positive().default(5242880),
  MAX_COMMUNITY_FILE_SIZE_BYTES: z.coerce.number().int().positive().max(26214400).default(10485760),
  LIVEKIT_URL: z.string().url().or(z.literal("")).default(""),
  LIVEKIT_API_KEY: z.string().optional().default(""),
  LIVEKIT_API_SECRET: z.string().optional().default(""),
  CALL_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  JSON_BODY_LIMIT: z.string().default("100kb"),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().or(z.literal("")).optional().default(""),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

  throw new Error(`Invalid backend environment configuration:\n${issues}`);
}

if (parsed.data.NODE_ENV === "production") {
  // This test-only moderation bypass must never be able to publish in production.
  if (parsed.data.EVENT_AUTO_APPROVE_FOR_TESTING) {
    throw new Error("EVENT_AUTO_APPROVE_FOR_TESTING cannot be enabled in production.");
  }

  if (!parsed.data.ZEPTOMAIL_SEND_MAIL_TOKEN) {
    throw new Error("ZEPTOMAIL_SEND_MAIL_TOKEN is required in production.");
  }

  const unsafePlaceholders = [
    parsed.data.JWT_ACCESS_SECRET,
    parsed.data.JWT_REFRESH_SECRET,
    parsed.data.OTP_PEPPER,
    parsed.data.PAYSTACK_SECRET_KEY,
    parsed.data.CLOUDINARY_API_SECRET,
    parsed.data.ZEPTOMAIL_SEND_MAIL_TOKEN,
    parsed.data.GROQ_API_KEY,
    parsed.data.GEOAPIFY_API_KEY,
  ].some((value) => /replace|placeholder|change-me/i.test(value));

  if (unsafePlaceholders || /^0{64}$/.test(parsed.data.FIELD_ENCRYPTION_KEY)) {
    throw new Error("Production cannot start with placeholder secrets or the example encryption key.");
  }
}

const configuredBrowserOrigins = parsed.data.FRONTEND_URLS.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const appOrigin = new URL(parsed.data.APP_BASE_URL).origin;
const websiteOrigin = parsed.data.WEB_BASE_URL ? new URL(parsed.data.WEB_BASE_URL).origin : null;

export const env = {
  ...parsed.data,
  // The server-rendered admin portal posts back to APP_BASE_URL. Include that
  // same origin so CORS does not reject its browser form submissions.
  // Android WebSockets send the socket host as Origin; include the development
  // LAN origin in FRONTEND_URLS when it differs from APP_BASE_URL.
  allowedOrigins: [...new Set([...configuredBrowserOrigins, appOrigin, ...(websiteOrigin ? [websiteOrigin] : [])])],
  isProduction: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
};
