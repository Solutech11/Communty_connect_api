import type { ErrorRequestHandler, RequestHandler } from "express";
import mongoose from "mongoose";
import { env } from "../Config/env";
import { AppError } from "../utils/AppError";
import { logger } from "../utils/logger.utils";

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(new AppError(404, `Route ${request.method} ${request.path} was not found`, "NOT_FOUND"));
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  let normalized = error;

  if (error instanceof mongoose.Error.CastError) {
    normalized = new AppError(400, "A resource identifier is invalid", "INVALID_IDENTIFIER");
  }

  if (error instanceof mongoose.Error.ValidationError) {
    normalized = new AppError(422, "Stored data validation failed", "MODEL_VALIDATION_ERROR");
  }

  if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
    normalized = new AppError(409, "A unique value is already in use", "DUPLICATE_RESOURCE");
  }

  const appError = normalized instanceof AppError
    ? normalized
    : new AppError(500, "An unexpected server error occurred", "INTERNAL_SERVER_ERROR");

  logger.error(
    {
      error,
      requestId: request.requestId,
      method: request.method,
      path: request.path,
    },
    "Request failed",
  );

  response.status(appError.statusCode).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.code === "VALIDATION_ERROR" ? appError.details : undefined,
      stack: !env.isProduction && !appError.isOperational ? appError.stack : undefined,
    },
    requestId: request.requestId,
  });
};
