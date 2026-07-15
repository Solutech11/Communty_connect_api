import bcrypt from "bcrypt";
import type { Request, Response } from "express";
import { env } from "../Config/env";
import { UserModel } from "../models/Auth/User.model";
import { RefreshTokenModel } from "../models/Auth/RefreshToken.model";
import { VerificationTokenModel } from "../models/Auth/VerificationToken.model";
import { WalletModel } from "../models/Wallet/Wallet.model";
import { AppError } from "../utils/AppError";
import { createOtp, hashOtp, secureEqual, sha256 } from "../utils/crypto.utils";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt.utils";
import { otpEmailTemplate, sendEmail } from "../utils/mailer.utils";
import { sendSuccess } from "../utils/response.utils";

const buildWalletNumber = (): string => {
  const random = Math.floor(100_000_000 + Math.random() * 900_000_000);
  return `CC${random}`;
};

const createSession = async (
  user: { _id: unknown; email: string; role: "member" | "moderator" | "admin"; tokenVersion: number },
  request: Request,
  family?: string,
) => {
  const userId = String(user._id);
  const refresh = signRefreshToken(userId, family);

  await RefreshTokenModel.create({
    userId,
    tokenId: refresh.tokenId,
    family: refresh.family,
    tokenHash: sha256(refresh.token),
    expiresAt: refresh.expiresAt,
    createdByIpHash: request.ip ? sha256(request.ip) : undefined,
    userAgentHash: request.header("user-agent")
      ? sha256(request.header("user-agent") as string)
      : undefined,
  });

  return {
    accessToken: signAccessToken({
      userId,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    }),
    refreshToken: refresh.token,
    accessTokenExpiresIn: env.ACCESS_TOKEN_TTL,
    refreshTokenExpiresAt: refresh.expiresAt,
  };
};

const issueVerificationOtp = async (user: {
  _id: unknown;
  email: string;
  firstName: string;
}): Promise<void> => {
  const otp = createOtp();

  await VerificationTokenModel.findOneAndUpdate(
    { userId: String(user._id), purpose: "verify_email" },
    {
      tokenHash: hashOtp(otp),
      attempts: 0,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      $unset: { usedAt: 1 },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );

  await sendEmail({
    toEmail: user.email,
    toName: user.firstName,
    subject: "Verify your Community Connect account",
    html: otpEmailTemplate(user.firstName, otp, "email verification"),
  });
};

export const register = async (request: Request, response: Response): Promise<Response> => {
  const { firstName, lastName, email, password, phone } = request.body;
  const normalizedEmail = email.toLowerCase();

  if (await UserModel.exists({ email: normalizedEmail })) {
    throw new AppError(409, "An account already uses this email", "EMAIL_IN_USE");
  }

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  const bootstrapAdmin = env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase() === normalizedEmail;
  const user = await UserModel.create({
    firstName,
    lastName,
    email: normalizedEmail,
    phone,
    passwordHash,
    role: bootstrapAdmin ? "admin" : "member",
  });

  try {
    await WalletModel.create({
      userId: user._id,
      walletNumber: buildWalletNumber(),
      currency: env.PAYSTACK_CURRENCY,
    });
    await issueVerificationOtp(user);
  } catch (error) {
    await Promise.all([
      WalletModel.deleteOne({ userId: user._id }),
      UserModel.deleteOne({ _id: user._id }),
    ]);
    throw error;
  }

  return sendSuccess(response, 201, "Account created. Check your email for the verification code.", {
    userId: user._id,
    email: user.email,
  });
};

export const verifyEmail = async (request: Request, response: Response): Promise<Response> => {
  const { email, otp } = request.body;
  const user = await UserModel.findOne({ email: email.toLowerCase() });

  if (!user) {
    throw new AppError(400, "The verification code is invalid", "INVALID_VERIFICATION_CODE");
  }

  const record = await VerificationTokenModel.findOne({
    userId: user._id,
    purpose: "verify_email",
  }).select("+tokenHash");

  if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
    throw new AppError(400, "The verification code is invalid or expired", "INVALID_VERIFICATION_CODE");
  }

  if (record.attempts >= 5) {
    throw new AppError(429, "Too many verification attempts", "VERIFICATION_ATTEMPTS_EXCEEDED");
  }

  if (!secureEqual(record.tokenHash, hashOtp(otp))) {
    record.attempts += 1;
    await record.save();
    throw new AppError(400, "The verification code is invalid", "INVALID_VERIFICATION_CODE");
  }

  record.usedAt = new Date();
  user.status = "active";
  user.emailVerifiedAt = new Date();
  await Promise.all([record.save(), user.save()]);

  const session = await createSession(user, request);
  return sendSuccess(response, 200, "Email verified", { user, session });
};

export const resendVerification = async (request: Request, response: Response): Promise<Response> => {
  const user = await UserModel.findOne({ email: request.body.email.toLowerCase() });

  if (user && user.status === "pending_verification") {
    await issueVerificationOtp(user);
  }

  return sendSuccess(
    response,
    200,
    "If the account requires verification, a new code has been sent.",
  );
};

export const login = async (request: Request, response: Response): Promise<Response> => {
  const { email, password } = request.body;
  const user = await UserModel.findOne({ email: email.toLowerCase() }).select("+passwordHash");

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError(401, "Email or password is incorrect", "INVALID_CREDENTIALS");
  }

  if (user.status === "pending_verification") {
    throw new AppError(403, "Verify your email before signing in", "EMAIL_NOT_VERIFIED");
  }

  if (user.status !== "active") {
    throw new AppError(403, "This account is not active", "ACCOUNT_NOT_ACTIVE");
  }

  user.lastLoginAt = new Date();
  await user.save();

  const session = await createSession(user, request);
  user.passwordHash = undefined as never;
  return sendSuccess(response, 200, "Signed in", { user, session });
};

export const refreshSession = async (request: Request, response: Response): Promise<Response> => {
  const { refreshToken } = request.body;
  const payload = verifyRefreshToken(refreshToken);
  const tokenHash = sha256(refreshToken);
  const stored = await RefreshTokenModel.findOne({ tokenId: payload.jti }).select("+tokenHash");

  if (!stored || !secureEqual(stored.tokenHash, tokenHash) || stored.expiresAt.getTime() <= Date.now()) {
    await RefreshTokenModel.updateMany(
      { family: payload.family, revokedAt: { $exists: false } },
      { revokedAt: new Date() },
    );
    throw new AppError(401, "Refresh token reuse was detected", "REFRESH_TOKEN_REUSE");
  }

  if (stored.revokedAt) {
    await RefreshTokenModel.updateMany(
      { family: stored.family, revokedAt: { $exists: false } },
      { revokedAt: new Date() },
    );
    throw new AppError(401, "Refresh token reuse was detected", "REFRESH_TOKEN_REUSE");
  }

  const user = await UserModel.findById(payload.sub);

  if (!user || user.status !== "active") {
    throw new AppError(401, "Account is unavailable", "ACCOUNT_UNAVAILABLE");
  }

  const session = await createSession(user, request, stored.family);
  const newPayload = verifyRefreshToken(session.refreshToken);
  stored.revokedAt = new Date();
  stored.replacedByTokenId = newPayload.jti;
  await stored.save();

  return sendSuccess(response, 200, "Session refreshed", { session });
};

export const logout = async (request: Request, response: Response): Promise<Response> => {
  const { refreshToken } = request.body;

  try {
    const payload = verifyRefreshToken(refreshToken);
    await RefreshTokenModel.updateOne(
      { tokenId: payload.jti, userId: request.auth?.id },
      { revokedAt: new Date() },
    );
  } catch {
    // Logout is intentionally idempotent and does not reveal token validity.
  }

  return sendSuccess(response, 200, "Signed out");
};

export const forgotPassword = async (request: Request, response: Response): Promise<Response> => {
  const user = await UserModel.findOne({ email: request.body.email.toLowerCase(), status: "active" });

  if (user) {
    const otp = createOtp();
    await VerificationTokenModel.findOneAndUpdate(
      { userId: user._id, purpose: "reset_password" },
      {
        tokenHash: hashOtp(otp),
        attempts: 0,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        $unset: { usedAt: 1 },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
    await sendEmail({
      toEmail: user.email,
      toName: user.firstName,
      subject: "Reset your Community Connect password",
      html: otpEmailTemplate(user.firstName, otp, "password reset"),
    });
  }

  return sendSuccess(response, 200, "If the account exists, a password reset code has been sent.");
};

export const resetPassword = async (request: Request, response: Response): Promise<Response> => {
  const { email, otp, newPassword } = request.body;
  const user = await UserModel.findOne({ email: email.toLowerCase(), status: "active" });

  if (!user) {
    throw new AppError(400, "The reset code is invalid or expired", "INVALID_RESET_CODE");
  }

  const record = await VerificationTokenModel.findOne({
    userId: user._id,
    purpose: "reset_password",
  }).select("+tokenHash");

  if (
    !record ||
    record.usedAt ||
    record.expiresAt.getTime() <= Date.now() ||
    record.attempts >= 5 ||
    !secureEqual(record.tokenHash, hashOtp(otp))
  ) {
    if (record && !record.usedAt) {
      record.attempts += 1;
      await record.save();
    }
    throw new AppError(400, "The reset code is invalid or expired", "INVALID_RESET_CODE");
  }

  user.passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
  user.tokenVersion += 1;
  record.usedAt = new Date();
  await Promise.all([
    user.save(),
    record.save(),
    RefreshTokenModel.updateMany({ userId: user._id, revokedAt: { $exists: false } }, { revokedAt: new Date() }),
  ]);

  return sendSuccess(response, 200, "Password reset. Sign in with your new password.");
};





