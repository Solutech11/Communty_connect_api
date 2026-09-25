import path from "node:path";
import express from "express";
import type { IncomingMessage } from "node:http";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { env } from "./Config/env";
import { openApiDocument } from "./Config/swagger";
import { startTicketReservationCron } from "./Cron/ticketReservation.cron";
import { connectMongo, disconnectMongo } from "./DB/mongo";
import { connectRedis, disconnectRedis } from "./DB/redis";
import {
  aiRateLimiter,
  authRateLimiter,
  globalRateLimiter,
  rejectMongoOperators,
  requestSlowdown,
  securityMiddleware,
} from "./middleware/security.middleware";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { adminErrorHandler } from "./middleware/admin.middleware";
import { requestContext } from "./middleware/requestContext.middleware";
import apiRouter from "./router";
import adminRouter from "./router/admin/Admin.web";
import Socket from "./Socket/Socket";
import { logger } from "./utils/logger.utils";
import { requestBodyLogFields } from "./utils/requestBodyLog.utils";

const app = express();

const requestBodyFieldsForLog = (request: IncomingMessage): Record<string, unknown> => {
  const parsedRequest = request as IncomingMessage & {
    body?: unknown;
    originalUrl?: string;
    rawBody?: Buffer;
  };

  return requestBodyLogFields(
    env.LOG_REQUEST_BODIES,
    parsedRequest.body,
    parsedRequest.originalUrl || request.url || "",
    parsedRequest.rawBody?.length,
  );
};

app.disable("x-powered-by");
app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "views"));
app.set("view cache", env.isProduction);
app.set("trust proxy", env.TRUST_PROXY);
app.use(requestContext);
app.use(
  pinoHttp({
    logger,
    // Emit a received and completed entry for every request, including health
    // checks, so operators can trace whether a client request reached the API.
    autoLogging: true,
    customReceivedMessage: () => "Request received",
    customSuccessMessage: () => "Request sent",
    customErrorMessage: () => "Request failed",
    customLogLevel: (_request, response, error) => {
      if (error || response.statusCode >= 500) {
        return "error";
      }

      if (response.statusCode >= 400) {
        return "warn";
      }

      return "info";
    },
    // Keep the request serializer limited to routing metadata. A separately
    // sanitized body snapshot is attached when the response completes, after
    // JSON and route-level multipart parsers have run.
    serializers: {
      req: (request) => ({
        method: request.method,
        url: request.url?.split("?")[0],
      }),
      res: (response) => ({ statusCode: response.statusCode }),
    },
    customSuccessObject: (_request, _response, logObject) => ({
      ...logObject,
      ...requestBodyFieldsForLog(_request),
    }),
    customErrorObject: (_request, _response, _error, logObject) => ({
      ...logObject,
      ...requestBodyFieldsForLog(_request),
    }),
    customProps: (request) => ({ requestId: request.requestId }),
  }),
);
app.use("/admin/assets", express.static(path.join(process.cwd(), "public", "admin"), {
  dotfiles: "deny",
  fallthrough: false,
  immutable: env.isProduction,
  maxAge: env.isProduction ? "1d" : 0,
}));
app.use(securityMiddleware);
app.use(
  express.json({
    limit: env.JSON_BODY_LIMIT,
    strict: true,
    // Preserve the exact bytes Paystack signed. Parsing/re-serializing JSON
    // would change the payload and make webhook verification unreliable.
    verify: (request, _response, buffer) => {
      (request as express.Request).rawBody = Buffer.from(buffer);
    },
  }),
);
app.use(express.urlencoded({ extended: false, limit: env.JSON_BODY_LIMIT }));
app.use(rejectMongoOperators);
app.use(requestSlowdown);
app.use(globalRateLimiter);

app.get("/health", (_request, response) => {
  response.status(200).json({
    success: true,
    service: "community-connect-api",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/docs.json", (_request, response) => {
  response.json(openApiDocument);
});
app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiDocument, {
    customSiteTitle: "Community Connect API",
    swaggerOptions: { persistAuthorization: true },
  }),
);

app.use("/admin", adminRouter);
app.use("/admin", adminErrorHandler);

app.use(`${env.API_PREFIX}/auth`, authRateLimiter);
app.use(`${env.API_PREFIX}/ai`, aiRateLimiter);
app.use(env.API_PREFIX, apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

export const startApp = async (): Promise<void> => {
  // Fail startup before listening if required persistence or locking is unavailable.
  await Promise.all([connectMongo(), connectRedis()]);

  const server = app.listen(env.PORT, () => {
    logger.info(
      { environment: env.NODE_ENV, port: env.PORT },
      "Community Connect API started",
    );
  });

  server.on("error", (error) => {
    logger.fatal({ error }, "HTTP server error");
  });

  const io = await Socket(server);
  // REST message controllers reuse this authenticated namespace for socket emits.
  app.set("io", io.of("/chat"));
  const stopTicketReservationCron = startTicketReservationCron();
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info({ signal }, "Graceful shutdown started");
    // A hard deadline prevents deployments from hanging forever on a broken
    // provider or network connection during shutdown.
    const forceExitTimer = setTimeout(() => {
      logger.fatal("Graceful shutdown timed out");
      process.exit(1);
    }, 15_000);
    forceExitTimer.unref();
    stopTicketReservationCron();

    await new Promise<void>((resolve) => {
      io.close(() => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
          reject(error);
          return;
        }

        resolve();
      });
    });
    await Promise.allSettled([disconnectMongo(), disconnectRedis()]);
    clearTimeout(forceExitTimer);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
};

if (require.main === module) {
  startApp().catch((error) => {
    logger.fatal({ error }, "Application bootstrap failed");
    process.exit(1);
  });
}

export default app;
