import express from "express";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { env } from "./Config/env";
import { openApiDocument } from "./Config/swagger";
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

export default app;
