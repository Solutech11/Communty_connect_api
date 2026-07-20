import { Writable } from "node:stream";
import pino from "pino";
import { env } from "../Config/env";

type LogRecord = Record<string, unknown>;

const omittedPrettyFields = new Set([
  "level",
  "time",
  "pid",
  "hostname",
  "service",
  "environment",
  "msg",
  "req",
  "res",
  "responseTime",
  "error",
]);

const formatPrettyLog = (record: LogRecord): string => {
  const timestamp = typeof record.time === "number"
    ? new Date(record.time).toLocaleTimeString("en-GB")
    : "--:--:--";
  const level = pino.levels.labels[Number(record.level)]?.toUpperCase() || "LOG";
  const message = typeof record.msg === "string" ? record.msg : "";
  const request = record.req as { method?: string; url?: string } | undefined;
  const response = record.res as { statusCode?: number } | undefined;
  const responseTime = typeof record.responseTime === "number"
    ? " " + Math.round(record.responseTime) + "ms"
    : "";
  const requestSummary = request?.method && request.url
    ? " " + request.method + " " + request.url + " -> " + (response?.statusCode || "-") + responseTime
    : "";
  const header = "[" + timestamp + "] " + level.padEnd(5) + " " + message + requestSummary;

  const context = Object.fromEntries(
    Object.entries(record).filter(([key]) => !omittedPrettyFields.has(key)),
  );
  const error = record.error as { message?: string; stack?: string } | undefined;
  const contextOutput = Object.keys(context).length > 0
    ? "\n" + JSON.stringify(context, null, 2)
    : "";
  const errorOutput = error?.stack
    ? "\n" + error.stack
    : error?.message
      ? "\nError: " + error.message
      : "";

  return header + contextOutput + errorOutput;
};

const createDevelopmentDestination = (): Writable => {
  let pending = "";

  const writeLine = (line: string): void => {
    if (!line) {
      return;
    }

    try {
      process.stdout.write(formatPrettyLog(JSON.parse(line) as LogRecord) + "\n");
    } catch {
      // Do not lose a log entry if a third-party logger writes plain text.
      process.stdout.write(line + "\n");
    }
  };

  return new Writable({
    write(chunk, _encoding, callback) {
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      lines.forEach(writeLine);
      callback();
    },
    final(callback) {
      writeLine(pending);
      pending = "";
      callback();
    },
  });
};

const loggerOptions: pino.LoggerOptions = {
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
};

// Development terminals need readable multi-line entries; production keeps
// newline-delimited JSON for log aggregation and alerting systems.
export const logger = env.isProduction
  ? pino(loggerOptions)
  : pino(loggerOptions, createDevelopmentDestination());
