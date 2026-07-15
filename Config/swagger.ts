import { env } from "./env";
import { apiEndpoints } from "../docs/endpoint-registry";

type OpenApiPathItem = Record<string, unknown>;
const paths: Record<string, OpenApiPathItem> = {};

for (const endpoint of apiEndpoints) {
  const pathParameters = [...endpoint.path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
  const parameters: Array<Record<string, unknown>> = [...pathParameters];

  if (endpoint.idempotency) {
    parameters.push({
      name: "Idempotency-Key",
      in: "header",
      required: true,
      description: "A unique 16-128 character key reused only when retrying this exact operation.",
      schema: { type: "string", minLength: 16, maxLength: 128 },
    });
  }

  const operation: Record<string, unknown> = {
    tags: [endpoint.tag],
    summary: endpoint.summary,
    description: endpoint.description,
    operationId: `${endpoint.method}_${endpoint.path.replace(/[^a-zA-Z0-9]+/g, "_")}`,
    parameters,
    security: endpoint.auth ? [{ bearerAuth: [] }] : [],
    responses: {
      "200": { description: "Successful response", content: { "application/json": { schema: { $ref: "#/components/schemas/SuccessResponse" } } } },
      "201": { description: "Resource created", content: { "application/json": { schema: { $ref: "#/components/schemas/SuccessResponse" } } } },
      "202": { description: "Request accepted for asynchronous completion", content: { "application/json": { schema: { $ref: "#/components/schemas/SuccessResponse" } } } },
      "400": { $ref: "#/components/responses/BadRequest" },
      "401": { $ref: "#/components/responses/Unauthorized" },
      "403": { $ref: "#/components/responses/Forbidden" },
      "409": { $ref: "#/components/responses/Conflict" },
      "422": { $ref: "#/components/responses/ValidationError" },
      "429": { $ref: "#/components/responses/RateLimited" },
      "500": { $ref: "#/components/responses/ServerError" },
    },
    ...(endpoint.roles ? { "x-required-roles": endpoint.roles } : {}),
  };

  if (endpoint.requestBody) {
    operation.requestBody = {
      required: endpoint.method !== "delete",
      content: {
        "application/json": {
          schema: { type: "object", additionalProperties: true },
          description: "See endpoint description and Zod validation errors for accepted fields.",
        },
      },
    };
  }

  paths[endpoint.path] = {
    ...(paths[endpoint.path] || {}),
    [endpoint.method]: operation,
  };
}

paths["/health"] = {
  get: {
    tags: ["System"],
    summary: "Health check",
    security: [],
    responses: { "200": { description: "Service process is running" } },
  },
};

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Community Connect API",
    version: "1.0.0",
    description: "Secure REST and realtime backend for events, communities, chat, AI, wallet, notifications, and disputes. Money is represented in kobo.",
  },
  servers: [
    { url: `${env.APP_BASE_URL}${env.API_PREFIX}`, description: env.NODE_ENV },
  ],
  tags: [...new Set(apiEndpoints.map((endpoint) => endpoint.tag))].map((name) => ({ name })),
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Short-lived access token. Refresh tokens are accepted only by /auth/refresh.",
      },
    },
    schemas: {
      SuccessResponse: {
        type: "object",
        required: ["success", "message"],
        properties: {
          success: { type: "boolean", const: true },
          message: { type: "string" },
          data: { type: ["object", "array", "null"] },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["success", "error", "requestId"],
        properties: {
          success: { type: "boolean", const: false },
          error: {
            type: "object",
            required: ["code", "message"],
            properties: { code: { type: "string" }, message: { type: "string" }, details: {} },
          },
          requestId: { type: "string" },
        },
      },
    },
    responses: Object.fromEntries(
      [
        ["BadRequest", 400, "Bad request"],
        ["Unauthorized", 401, "Authentication failed"],
        ["Forbidden", 403, "Authorization failed"],
        ["Conflict", 409, "Resource state conflict"],
        ["ValidationError", 422, "Zod validation failed"],
        ["RateLimited", 429, "Rate limit exceeded"],
        ["ServerError", 500, "Unexpected server error"],
      ].map(([name, status, description]) => [
        name,
        {
          description,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
          "x-status-code": status,
        },
      ]),
    ),
  },
};
