import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../Config/env";
import { AppError } from "./AppError";

const ENCRYPTION_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

export const sha256 = (value: string): string => {
  return createHash("sha256").update(value).digest("hex");
};

export const createOpaqueToken = (byteLength = 48): string => {
  return randomBytes(byteLength).toString("base64url");
};

export const createOtp = (): string => {
  const value = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return value.toString().padStart(6, "0");
};

export const hashOtp = (otp: string): string => {
  return createHmac("sha256", env.OTP_PEPPER).update(otp).digest("hex");
};

export const secureEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

export const encryptField = (plaintext: string): string => {
  const key = Buffer.from(env.FIELD_ENCRYPTION_KEY, "hex");
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, initializationVector);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    initializationVector.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
};

export const decryptField = (payload: string): string => {
  const [version, ivPart, tagPart, ciphertextPart] = payload.split(".");

  if (
    version !== ENCRYPTION_VERSION ||
    !ivPart ||
    !tagPart ||
    !ciphertextPart
  ) {
    throw new AppError(500, "Encrypted field format is invalid", "ENCRYPTION_FORMAT_INVALID");
  }

  const key = Buffer.from(env.FIELD_ENCRYPTION_KEY, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
};

export const createPaystackSignature = (rawBody: Buffer): string => {
  return createHmac("sha512", env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest("hex");
};

export const maskAccountNumber = (accountNumber: string): string => {
  return accountNumber.slice(-4).padStart(accountNumber.length, "*");
};
