import bcrypt from "bcrypt";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { env } from "../Config/env";
import { ADMIN_PERMISSIONS, AdminModel } from "../models/Admin/Admin.model";
import { AdminSessionModel } from "../models/Admin/AdminSession.model";
import { PlatformEarningModel } from "../models/Admin/PlatformEarning.model";
import { RefreshTokenModel } from "../models/Auth/RefreshToken.model";
import { UserModel } from "../models/Auth/User.model";
import { WalletModel } from "../models/Wallet/Wallet.model";
import { EventModel } from "../models/Event/Event.model";
import { TicketTypeModel } from "../models/Event/TicketType.model";
import {
  ADMIN_CSRF_COOKIE,
  ADMIN_LOGIN_CSRF_COOKIE,
  ADMIN_SESSION_COOKIE,
  parseCookies,
} from "../middleware/admin.middleware";
import { passwordSchema } from "../schemas/common.schemas";
import { AppError } from "../utils/AppError";
import { createOpaqueToken, secureEqual, sha256 } from "../utils/crypto.utils";
import { logger } from "../utils/logger.utils";

const adminLoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
  _csrf: z.string().min(32).max(256),
}).strict();

const createAdminSchema = z.object({
  firstName: z.string().trim().min(2).max(60),
  lastName: z.string().trim().min(2).max(60),
  email: z.string().trim().email().max(254),
  password: passwordSchema,
  _csrf: z.string().min(32).max(256),
}).strict();

const idParamsSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/),
});

const cookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: "strict" as const,
  path: "/admin",
};

const issueLoginCsrf = (response: Response): string => {
  const token = createOpaqueToken(32);
  response.cookie(ADMIN_LOGIN_CSRF_COOKIE, token, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000,
  });
  return token;
};

const buildWalletNumber = (): string => {
  const random = Math.floor(100_000_000 + Math.random() * 900_000_000);
  return "CC" + random;
};

const allocateWalletNumber = async (): Promise<string> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const walletNumber = buildWalletNumber();
    if (!(await WalletModel.exists({ walletNumber }))) {
      return walletNumber;
    }
  }

  throw new AppError(503, "A wallet number could not be allocated. Please retry.", "WALLET_NUMBER_UNAVAILABLE");
};

const redirectWithMessage = (response: Response, message: string): void => {
  response.redirect("/admin?message=" + encodeURIComponent(message));
};

const parseUserId = (request: Request): string => {
  const parsed = idParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    throw new AppError(400, "User identifier is invalid", "INVALID_IDENTIFIER");
  }

  return parsed.data.id;
};

export const renderAdminLogin = async (
  request: Request,
  response: Response,
): Promise<void> => {
  if (parseCookies(request)[ADMIN_SESSION_COOKIE]) {
    response.redirect("/admin");
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  response.render("admin/login", {
    title: "Admin sign in",
    csrfToken: issueLoginCsrf(response),
    error: undefined,
  });
};

export const loginAdmin = async (request: Request, response: Response): Promise<void> => {
  const parsed = adminLoginSchema.safeParse(request.body);
  const loginCsrf = parseCookies(request)[ADMIN_LOGIN_CSRF_COOKIE];

  if (!parsed.success || !loginCsrf || !secureEqual(loginCsrf, request.body?._csrf || "")) {
    response.status(400).render("admin/login", {
      title: "Admin sign in",
      csrfToken: issueLoginCsrf(response),
      error: "The sign-in form expired. Please try again.",
    });
    return;
  }

  const user = await UserModel.findOne({
    email: parsed.data.email.toLowerCase(),
    role: "admin",
  }).select("+passwordHash");

  if (
    !user
    || user.status !== "active"
    || !(await bcrypt.compare(parsed.data.password, user.passwordHash))
  ) {
    response.status(401).render("admin/login", {
      title: "Admin sign in",
      csrfToken: issueLoginCsrf(response),
      error: "Email or password is incorrect.",
    });
    return;
  }

  const admin = await AdminModel.findOneAndUpdate(
    { userId: user._id },
    {
      $set: { lastLoginAt: new Date() },
      // Existing administrators receive newly introduced portal permissions.
      $addToSet: { permissions: { $each: ADMIN_PERMISSIONS } },
      $setOnInsert: { active: true },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (!admin.active) {
    throw new AppError(403, "This admin profile is inactive", "ADMIN_INACTIVE");
  }

  const sessionToken = createOpaqueToken(48);
  const csrfToken = createOpaqueToken(32);
  await AdminSessionModel.create({
    adminId: admin._id,
    tokenHash: sha256(sessionToken),
    csrfTokenHash: sha256(csrfToken),
    ipHash: sha256(request.ip || "unknown"),
    userAgentHash: sha256(request.header("user-agent") || "unknown"),
    expiresAt: new Date(Date.now() + env.ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000),
  });

  response.cookie(ADMIN_SESSION_COOKIE, sessionToken, {
    ...cookieOptions,
    maxAge: env.ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000,
  });
  response.cookie(ADMIN_CSRF_COOKIE, csrfToken, {
    ...cookieOptions,
    maxAge: env.ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000,
  });
  response.clearCookie(ADMIN_LOGIN_CSRF_COOKIE, { path: "/admin" });
  response.redirect("/admin");
};

export const logoutAdmin = async (request: Request, response: Response): Promise<void> => {
  await AdminSessionModel.updateOne(
    { _id: request.admin?.sessionId, revokedAt: { $exists: false } },
    { revokedAt: new Date() },
  );
  response.clearCookie(ADMIN_SESSION_COOKIE, { path: "/admin" });
  response.clearCookie(ADMIN_CSRF_COOKIE, { path: "/admin" });
  response.redirect("/admin/login");
};

export const renderAdminDashboard = async (
  request: Request,
  response: Response,
): Promise<void> => {
  const tabValues = ["overview", "moderation", "members", "administrators", "finance"] as const;
  const requestedTab = typeof request.query.tab === "string" ? request.query.tab : "overview";
  const activeTab = tabValues.includes(requestedTab as typeof tabValues[number])
    ? requestedTab as typeof tabValues[number]
    : "overview";
  const tabDetails = {
    overview: { label: "Community Connect", heading: "Operations overview", subtitle: "A calm view of platform activity and the work that needs attention." },
    moderation: { label: "Event workspace", heading: "Event moderation", subtitle: "Review new listings and open complete event and ticket records." },
    members: { label: "Member workspace", heading: "Member accounts", subtitle: "Help members and respond to account activity." },
    administrators: { label: "Access workspace", heading: "Administrator team", subtitle: "Manage access for trusted platform operators." },
    finance: { label: "Finance workspace", heading: "Platform revenue", subtitle: "Review completed platform charges and proceeds." },
  }[activeTab];
  const [
    users,
    events,
    admins,
    recentEarnings,
    userCount,
    suspendedUserCount,
    pendingEventCount,
    publishedEventCount,
    earningTotals,
    earningBreakdown,
  ] = await Promise.all([
    UserModel.find()
      .select("firstName lastName email role status createdAt lastLoginAt")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
    EventModel.find()
      .populate("creatorId", "firstName lastName email")
      .sort({ submittedAt: -1, createdAt: -1 })
      .limit(100)
      .lean(),
    AdminModel.find()
      .populate("userId", "firstName lastName email status")
      .sort({ createdAt: -1 })
      .lean(),
    PlatformEarningModel.find({ status: "earned" })
      .populate("payerUserId", "firstName lastName email")
      .populate("beneficiaryUserId", "firstName lastName email")
      .sort({ earnedAt: -1 })
      .limit(100)
      .lean(),
    UserModel.countDocuments(),
    UserModel.countDocuments({ status: "suspended" }),
    EventModel.countDocuments({ status: "pending_approval" }),
    EventModel.countDocuments({ status: "published" }),
    PlatformEarningModel.aggregate<{ totalKobo: number }>([
      { $match: { status: "earned" } },
      { $group: { _id: null, totalKobo: { $sum: "$feeAmountKobo" } } },
    ]),
    PlatformEarningModel.aggregate<{ _id: string; totalKobo: number; count: number }>([
      { $match: { status: "earned" } },
      {
        $group: {
          _id: "$sourceType",
          totalKobo: { $sum: "$feeAmountKobo" },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalKobo: -1 } },
    ]),
  ]);

  response.render("admin/dashboard", {
    title: "Community Connect Admin",
    activeTab,
    tabDetails,
    csrfToken: request.admin?.csrfToken,
    permissions: request.admin?.permissions || [],
    users,
    events,
    admins,
    recentEarnings,
    earningBreakdown,
    stats: {
      userCount,
      suspendedUserCount,
      pendingEventCount,
      publishedEventCount,
      totalEarningsKobo: earningTotals[0]?.totalKobo || 0,
    },
    message: typeof request.query.message === "string" ? request.query.message.slice(0, 180) : "",
    formatNaira: (kobo: number) => {
      return new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
      }).format(kobo / 100);
    },
  });
};

export const createAdminFromPortal = async (
  request: Request,
  response: Response,
): Promise<void> => {
  const parsed = createAdminSchema.safeParse(request.body);
  if (!parsed.success) {
    throw new AppError(422, "Enter a valid name, email, and strong password", "VALIDATION_ERROR");
  }

  const email = parsed.data.email.toLowerCase();
  if (await UserModel.exists({ email })) {
    throw new AppError(409, "An account already uses this email", "EMAIL_IN_USE");
  }

  const user = await UserModel.create({
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    email,
    passwordHash: await bcrypt.hash(parsed.data.password, env.BCRYPT_ROUNDS),
    role: "admin",
    status: "active",
    emailVerifiedAt: new Date(),
  });

  try {
    await WalletModel.create({
      userId: user._id,
      walletNumber: await allocateWalletNumber(),
      currency: env.PAYSTACK_CURRENCY,
    });
    await AdminModel.create({
      userId: user._id,
      active: true,
      permissions: [...ADMIN_PERMISSIONS],
    });
  } catch (error) {
    await Promise.all([
      WalletModel.deleteOne({ userId: user._id }),
      AdminModel.deleteOne({ userId: user._id }),
      UserModel.deleteOne({ _id: user._id }),
    ]);
    throw error;
  }

  logger.info(
    { actorAdminId: request.admin?.adminId, createdAdminUserId: user._id.toString() },
    "Administrator created from portal",
  );
  redirectWithMessage(response, "Administrator account created.");
};

export const blockUserFromAdmin = async (request: Request, response: Response): Promise<void> => {
  const userId = parseUserId(request);
  const user = await UserModel.findById(userId);

  if (!user || user.status === "deleted") {
    throw new AppError(404, "User was not found", "USER_NOT_FOUND");
  }
  if (user.role === "admin") {
    throw new AppError(403, "Administrator accounts cannot be blocked from this portal", "ADMIN_BLOCK_FORBIDDEN");
  }
  if (user.status !== "active") {
    throw new AppError(409, "Only active users can be blocked", "USER_NOT_ACTIVE");
  }

  user.status = "suspended";
  user.tokenVersion += 1;
  await Promise.all([
    user.save(),
    RefreshTokenModel.updateMany(
      { userId: user._id, revokedAt: { $exists: false } },
      { revokedAt: new Date() },
    ),
  ]);

  logger.info(
    { actorAdminId: request.admin?.adminId, targetUserId: user._id.toString() },
    "User blocked from admin portal",
  );
  redirectWithMessage(response, "User blocked and active sessions revoked.");
};

export const unblockUserFromAdmin = async (request: Request, response: Response): Promise<void> => {
  const userId = parseUserId(request);
  const user = await UserModel.findById(userId);

  if (!user || user.status === "deleted") {
    throw new AppError(404, "User was not found", "USER_NOT_FOUND");
  }
  if (user.role === "admin") {
    throw new AppError(403, "Administrator accounts cannot be changed from this portal", "ADMIN_STATUS_FORBIDDEN");
  }
  if (user.status !== "suspended") {
    throw new AppError(409, "Only blocked users can be unblocked", "USER_NOT_BLOCKED");
  }

  user.status = "active";
  user.tokenVersion += 1;
  await user.save();

  logger.info(
    { actorAdminId: request.admin?.adminId, targetUserId: user._id.toString() },
    "User unblocked from admin portal",
  );
  redirectWithMessage(response, "User unblocked. They can sign in again.");
};

export const approveEventFromAdmin = async (
  request: Request,
  response: Response,
): Promise<void> => {
  if (!mongoose.isValidObjectId(request.params.id)) {
    throw new AppError(400, "Event identifier is invalid", "INVALID_IDENTIFIER");
  }

  const event = await EventModel.findOne({
    _id: request.params.id,
    status: "pending_approval",
  });
  if (!event) {
    throw new AppError(404, "Pending event was not found", "EVENT_NOT_FOUND");
  }

  const ticketCount = await TicketTypeModel.countDocuments({ eventId: event._id, active: true });
  if (ticketCount === 0 || event.startsAt.getTime() <= Date.now() || event.endsAt <= event.startsAt) {
    throw new AppError(422, "Event no longer meets publishing requirements", "EVENT_NOT_PUBLISHABLE");
  }

  event.status = "published";
  event.approvedBy = request.admin?.userId as never;
  event.approvedAt = new Date();
  event.publishedAt = new Date();
  event.deactivationReason = undefined;
  await event.save();
  response.redirect(`/admin/events/${event._id}?message=${encodeURIComponent("Event approved and published.")}`);
};

export const deactivateEventFromAdmin = async (
  request: Request,
  response: Response,
): Promise<void> => {
  if (!mongoose.isValidObjectId(request.params.id)) {
    throw new AppError(400, "Event identifier is invalid", "INVALID_IDENTIFIER");
  }

  const reason = typeof request.body.reason === "string"
    ? request.body.reason.trim().slice(0, 300)
    : "";
  if (reason.length < 5) {
    throw new AppError(422, "Enter a deactivation reason", "DEACTIVATION_REASON_REQUIRED");
  }

  const event = await EventModel.findOneAndUpdate(
    { _id: request.params.id, status: "published" },
    {
      $set: {
        status: "deactivated",
        deactivatedAt: new Date(),
        deactivatedBy: request.admin?.userId,
        deactivationReason: reason,
      },
    },
    { new: true, runValidators: true },
  );

  if (!event) {
    throw new AppError(404, "Published event was not found", "EVENT_NOT_FOUND");
  }

  response.redirect(`/admin/events/${event._id}?message=${encodeURIComponent("Event deactivated.")}`);
};
