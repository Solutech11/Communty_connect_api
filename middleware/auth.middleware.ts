import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../Constant";
import { UserModel } from "../models/Auth/User.model";
import { AppError } from "../utils/AppError";
import { verifyAccessToken } from "../utils/jwt.utils";

export const authenticate = async (
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authorization = request.header("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      throw new AppError(401, "Authentication is required", "AUTHENTICATION_REQUIRED");
    }

    const payload = verifyAccessToken(authorization.slice(7));
    const user = await UserModel.findById(payload.sub)
      .select("email role tokenVersion status")
      .lean();

    if (!user || user.status !== "active") {
      throw new AppError(401, "Account is unavailable", "ACCOUNT_UNAVAILABLE");
    }

    if (user.tokenVersion !== payload.tokenVersion) {
      throw new AppError(401, "Session has been revoked", "SESSION_REVOKED");
    }

    request.auth = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };

    next();
  } catch (error) {
    next(error);
  }
};

export const optionalAuthenticate = async (
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  if (!request.header("authorization")) {
    next();
    return;
  }

  await authenticate(request, response, next);
};

export const authorize = (...roles: UserRole[]) => {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (!request.auth) {
      next(new AppError(401, "Authentication is required", "AUTHENTICATION_REQUIRED"));
      return;
    }

    if (!roles.includes(request.auth.role)) {
      next(new AppError(403, "You are not allowed to perform this action", "FORBIDDEN"));
      return;
    }

    next();
  };
};
