import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { AppError } from "../utils/AppError";

interface ValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

export const validate = (schemas: ValidationSchemas) => {
  return (request: Request, _response: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        request.body = schemas.body.parse(request.body);
      }

      if (schemas.params) {
        request.params = schemas.params.parse(request.params) as Request["params"];
      }

      if (schemas.query) {
        Object.assign(request.query, schemas.query.parse(request.query));
      }

      next();
    } catch (error) {
      const details = error && typeof error === "object" && "issues" in error
        ? (error as { issues: unknown }).issues
        : undefined;
      next(new AppError(422, "Request validation failed", "VALIDATION_ERROR", details));
    }
  };
};
