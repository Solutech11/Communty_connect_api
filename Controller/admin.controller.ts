import bcrypt from "bcrypt";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { env } from "../Config/env";
import { AdminModel } from "../models/Admin/Admin.model";
import { AdminSessionModel } from "../models/Admin/AdminSession.model";
import { PlatformEarningModel } from "../models/Admin/PlatformEarning.model";
import { UserModel } from "../models/Auth/User.model";
import { EventModel } from "../models/Event/Event.model";
import { TicketTypeModel } from "../models/Event/TicketType.model";
import {
  ADMIN_CSRF_COOKIE,
  ADMIN_LOGIN_CSRF_COOKIE,
  ADMIN_SESSION_COOKIE,
  parseCookies,
} from "../middleware/admin.middleware";
import { AppError } from "../utils/AppError";
import { createOpaqueToken, secureEqual, sha256 } from "../utils/crypto.utils";

const adminLoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
  _csrf: z.string().min(32).max(256),
}).strict();

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
      $setOnInsert: {
        active: true,
        permissions: ["users:read", "events:moderate", "earnings:read"],
      },
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
  const [
    users,
    events,
    recentEarnings,
    userCount,
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
    PlatformEarningModel.find({ status: "earned" })
      .populate("payerUserId", "firstName lastName email")
      .populate("beneficiaryUserId", "firstName lastName email")
      .sort({ earnedAt: -1 })
      .limit(100)
      .lean(),
    UserModel.countDocuments(),
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
    csrfToken: request.admin?.csrfToken,
    users,
    events,
    recentEarnings,
    earningBreakdown,
    stats: {
      userCount,
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
  response.redirect("/admin?message=" + encodeURIComponent("Event approved and published."));
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

  response.redirect("/admin?message=" + encodeURIComponent("Event deactivated."));
};
