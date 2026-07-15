import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { env } from "../Config/env";
import { ACCESS_TOKEN_TYPE, REFRESH_TOKEN_TYPE, type UserRole } from "../Constant";
import { AppError } from "./AppError";

interface AccessTokenPayload extends JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  tokenVersion: number;
  type: typeof ACCESS_TOKEN_TYPE;
}

interface RefreshTokenPayload extends JwtPayload {
  sub: string;
  jti: string;
  family: string;
  type: typeof REFRESH_TOKEN_TYPE;
}

const baseOptions: SignOptions = {
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
  algorithm: "HS256",
};

export const signAccessToken = (payload: {
  userId: string;
  email: string;
  role: UserRole;
  tokenVersion: number;
}): string => {
  return jwt.sign(
    {
      email: payload.email,
      role: payload.role,
      tokenVersion: payload.tokenVersion,
      type: ACCESS_TOKEN_TYPE,
    },
    env.JWT_ACCESS_SECRET,
    {
      ...baseOptions,
      subject: payload.userId,
      expiresIn: env.ACCESS_TOKEN_TTL as SignOptions["expiresIn"],
    },
  );
};

export const signRefreshToken = (userId: string, family: string = randomUUID()): {
  token: string;
  tokenId: string;
  family: string;
  expiresAt: Date;
} => {
  const tokenId = randomUUID();
  const expiresAt = new Date(
    Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const token = jwt.sign(
    {
      family,
      type: REFRESH_TOKEN_TYPE,
    },
    env.JWT_REFRESH_SECRET,
    {
      ...baseOptions,
      subject: userId,
      jwtid: tokenId,
      expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
    },
  );

  return {
    token,
    tokenId,
    family,
    expiresAt,
  };
};

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ["HS256"],
    }) as AccessTokenPayload;

    if (payload.type !== ACCESS_TOKEN_TYPE || !payload.sub) {
      throw new Error("Unexpected access token payload");
    }

    return payload;
  } catch {
    throw new AppError(401, "Access token is invalid or expired", "INVALID_ACCESS_TOKEN");
  }
};

export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  try {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ["HS256"],
    }) as RefreshTokenPayload;

    if (
      payload.type !== REFRESH_TOKEN_TYPE ||
      !payload.sub ||
      !payload.jti ||
      !payload.family
    ) {
      throw new Error("Unexpected refresh token payload");
    }

    return payload;
  } catch {
    throw new AppError(401, "Refresh token is invalid or expired", "INVALID_REFRESH_TOKEN");
  }
};

