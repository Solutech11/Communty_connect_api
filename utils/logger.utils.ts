import pino from "pino";
import { env } from "../Config/env";

export const logger = pino({
  serializers: { error: pino.stdSerializers.err },
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.password",
      "req.body.currentPassword",
      "req.body.newPassword",
      "req.body.otp",
      "req.body.refreshToken",
      "req.body.accountNumber",
      "req.body.token",
      "rawBody",
    ],
    censor: "[REDACTED]",
  },
  base: {
    service: "community-connect-api",
    environment: env.NODE_ENV,
  },
});
