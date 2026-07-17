import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import { AdminModel } from "../models/Admin/Admin.model";
import { AdminSessionModel } from "../models/Admin/AdminSession.model";
import { UserModel } from "../models/Auth/User.model";
import { AppError } from "../utils/AppError";
import { secureEqual, sha256 } from "../utils/crypto.utils";
import { logger } from "../utils/logger.utils";

export const ADMIN_SESSION_COOKIE = "cc_admin_session";
export const ADMIN_CSRF_COOKIE = "cc_admin_csrf";
export const ADMIN_LOGIN_CSRF_COOKIE = "cc_admin_login_csrf";

export const parseCookies = (request: Request): Record<string, string> => {
  const cookies: Record<string, string> = {};

  for (const part of (request.header("cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) {
      continue;
    }

    const key = part.slice(0, separator).trim();
    try {
      cookies[key] = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      // Malformed cookies are ignored rather than reflected into an error page.
    }
  }

  return cookies;
};

export const authenticateAdminPage = async (
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const cookies = parseCookies(request);
    const token = cookies[ADMIN_SESSION_COOKIE];
    const csrfToken = cookies[ADMIN_CSRF_COOKIE];

    if (!token || !csrfToken) {
      response.redirect("/admin/login");
      return;
    }

    const session = await AdminSessionModel.findOne({
      tokenHash: sha256(token),
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    }).select("+csrfTokenHash");

    if (
      !session
      || !secureEqual(session.csrfTokenHash, sha256(csrfToken))
      || !secureEqual(session.ipHash, sha256(request.ip || "unknown"))
      || !secureEqual(
        session.userAgentHash,
        sha256(request.header("user-agent") || "unknown"),
      )
    ) {
      response.clearCookie(ADMIN_SESSION_COOKIE, { path: "/admin" });
      response.clearCookie(ADMIN_CSRF_COOKIE, { path: "/admin" });
      response.redirect("/admin/login");
      return;
    }

    const admin = await AdminModel.findOne({ _id: session.adminId, active: true }).lean();
    const user = admin
      ? await UserModel.findOne({ _id: admin.userId, role: "admin", status: "active" }).lean()
      : null;

    if (!admin || !user) {
      response.redirect("/admin/login");
      return;
    }

    request.admin = {
      adminId: admin._id.toString(),
      userId: user._id.toString(),
      sessionId: session._id.toString(),
      csrfToken,
      permissions: admin.permissions,
    };
    response.setHeader("Cache-Control", "no-store");
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAdminCsrf = (
  request: Request,
  _response: Response,
  next: NextFunction,
): void => {
  const submitted = typeof request.body?._csrf === "string" ? request.body._csrf : "";

  if (!request.admin || !submitted || !secureEqual(submitted, request.admin.csrfToken)) {
    next(new AppError(403, "The admin form expired. Refresh and try again.", "INVALID_CSRF_TOKEN"));
    return;
  }

  next();
};

export const requireAdminPermission = (permission: string) => {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (!request.admin?.permissions.includes(permission)) {
      next(new AppError(403, "Admin permission is required", "ADMIN_PERMISSION_REQUIRED"));
      return;
    }

    next();
  };
};

export const adminErrorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  const appError = error instanceof AppError
    ? error
    : new AppError(500, "The admin operation could not be completed", "ADMIN_OPERATION_FAILED");

  logger.error(
    { error, requestId: request.requestId, method: request.method, path: request.path },
    "Admin portal request failed",
  );
  response.status(appError.statusCode).render("admin/error", {
    title: "Admin error",
    message: appError.message,
    requestId: request.requestId,
  });
};
