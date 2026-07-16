import express from "express";
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
import { requestContext } from "./middleware/requestContext.middleware";
import apiRouter from "./router";
import Socket from "./Socket/Socket";
import { logger } from "./utils/logger.utils";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", env.TRUST_PROXY);
app.use(requestContext);
app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (request) => request.url === "/health",
    },
    customProps: (request) => ({ requestId: request.id }),
  }),
);
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
