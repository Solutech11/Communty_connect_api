import { z } from "zod";
import type { EndpointDefinition } from "./endpoint-registry";
import type { OpenApiSchema, RequestBodyContract, SuccessContract, QueryParameterContract } from "./openapi-contracts";
import { roommateDraftSchema, contactConsentSchema, roommateOptions } from "../schemas/roommate.schemas";

const definitions: Array<[EndpointDefinition["method"], string, string, boolean?]> = [
  ["get", "/roommates/questions", "Get roommate questions"],
  ["get", "/roommates/profiles/me", "Get my roommate profile"],
  ["put", "/roommates/profiles/me", "Save my roommate profile", true],
  ["patch", "/roommates/profiles/me/visibility", "Activate or pause discovery", true],
  ["get", "/roommates/candidates", "Discover compatible roommates"],
  ["put", "/roommates/decisions/{userId}", "Like or pass a candidate", true],
  ["get", "/roommates/connections", "List roommate connects"],
  ["get", "/roommates/connections/{id}", "Get a roommate connect"],
  ["delete", "/roommates/connections/{id}", "End a roommate connect"],
  ["put", "/roommates/connections/{id}/contact-consents/me", "Choose contacts to share", true],
  ["delete", "/roommates/connections/{id}/contact-consents/me", "Revoke contact sharing"],
  ["get", "/roommates/connections/{id}/contacts", "Get mutually consented contacts"],
  ["post", "/roommates/connections/{id}/requests", "Request a roommate pairing"],
  ["patch", "/roommates/connections/{id}/requests/{requestId}", "Respond to a roommate request", true],
  ["delete", "/roommates/connections/{id}/pairing", "End a confirmed pairing"],
  ["get", "/users/me/blocks", "List users I blocked"],
  ["put", "/users/me/blocks/{userId}", "Block a user"],
  ["delete", "/users/me/blocks/{userId}", "Unblock a user"],
];
export const roommateEndpoints: EndpointDefinition[] = definitions.map(([method, path, summary, requestBody]) => ({
  method, path, summary, requestBody, tag: path.startsWith("/roommates") ? "Roommates" : "Users", auth: true,
  description: summary + ". Enforces active authentication, ownership, visibility, and either-direction blocks. Acceptance makes both profiles private. Contacts require separate mutual consent. Budgets are personal annual rent shares in integer kobo, not payments.",
}));

const id = "507f1f77bcf86cd799439011";
const otherId = "507f1f77bcf86cd799439012";
export const roommateExampleAnswers = {
  adultConfirmed: true, housingMode: "seeking", state: "Lagos", lgas: ["Ikeja"],
  minAnnualRentKobo: 50000000, maxAnnualRentKobo: 100000000,
  moveInFrom: "2027-01-01", moveInTo: "2027-03-31", gender: "undisclosed",
  acceptableGenders: [...roommateOptions.gender], cleanliness: "balanced", sleepSchedule: "flexible",
  guests: "sometimes", socialPreference: "balanced", smokes: false, acceptsSmoking: false,
  hasPets: false, acceptsPets: true, description: "Looking for a considerate roommate.",
};
const profile = { _id: id, userId: otherId, visibility: "discoverable", questionnaireVersion: 1,
  activeConnectionId: null, ...roommateExampleAnswers };
const user = { _id: otherId, firstName: "Ada", lastName: "Okafor", avatarUrl: "https://example.com/avatar.jpg",
  bio: "Enjoys reading", interests: ["reading"], hobbies: ["walking"] };
const connection = { _id: id, status: "active", user, profile, conversationId: otherId,
  friendship: { _id: id, status: "pending", requesterId: id, addresseeId: otherId },
  pairingRequest: { _id: id, status: "pending", requesterId: id, recipientId: otherId },
  myContactFields: ["email"], otherHasConsented: false, pairedAt: null, updatedAt: "2026-10-01T00:00:00.000Z" };
const responseData: Record<string, unknown> = {
  "GET /roommates/questions": { version: 1, options: roommateOptions, currency: "NGN", rentPeriod: "year", eligibility: "Self-declared age 18 or older" },
  "GET /roommates/profiles/me": { profile }, "PUT /roommates/profiles/me": { profile },
  "PATCH /roommates/profiles/me/visibility": { profile },
  "GET /roommates/candidates": { candidates: [{ user, profile, score: 80, reasons: ["Shared interests and hobbies"] }], page: 1, limit: 20, total: 1 },
  "PUT /roommates/decisions/{userId}": { matched: true, connectionId: id },
  "GET /roommates/connections": { connections: [connection], page: 1, limit: 20, total: 1 },
  "GET /roommates/connections/{id}": { connection },
  "DELETE /roommates/connections/{id}": { ended: true },
  "PUT /roommates/connections/{id}/contact-consents/me": { consented: true },
  "DELETE /roommates/connections/{id}/contact-consents/me": { consented: false },
  "GET /roommates/connections/{id}/contacts": { contacts: { phone: "+2348012345678", email: "ada@example.com" } },
  "POST /roommates/connections/{id}/requests": { requestId: id },
  "PATCH /roommates/connections/{id}/requests/{requestId}": { status: "accepted" },
  "DELETE /roommates/connections/{id}/pairing": { ended: true },
  "GET /users/me/blocks": { blocks: [{ _id: id, userId: id, targetId: { _id: otherId,
    firstName: "Ada", lastName: "Okafor", avatarUrl: "https://example.com/avatar.jpg" },
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }], page: 1, limit: 20, total: 1 },
  "PUT /users/me/blocks/{userId}": { blocked: true }, "DELETE /users/me/blocks/{userId}": { blocked: false },
};
const bodies: Record<string, { validator: z.ZodType; example: Record<string, unknown> }> = {
  "PUT /roommates/profiles/me": { validator: roommateDraftSchema, example: roommateExampleAnswers },
  "PATCH /roommates/profiles/me/visibility": { validator: z.object({ visibility: z.enum(["discoverable", "paused"]) }).strict(), example: { visibility: "discoverable" } },
  "PUT /roommates/decisions/{userId}": { validator: z.object({ action: z.enum(["like", "pass"]) }).strict(), example: { action: "like" } },
  "PUT /roommates/connections/{id}/contact-consents/me": { validator: contactConsentSchema, example: { fields: ["phone", "email"] } },
  "PATCH /roommates/connections/{id}/requests/{requestId}": { validator: z.object({ action: z.enum(["accept", "decline", "cancel"]) }).strict(), example: { action: "accept" } },
};

export const attachRoommateContracts = (contracts: {
  success: Record<string, SuccessContract>; bodies: Record<string, RequestBodyContract>;
  schemas: Record<string, OpenApiSchema>; queries: Record<string, QueryParameterContract[]>;
  responses: Record<string, Record<string, OpenApiSchema>>;
}, infer: (value: unknown, additional?: boolean) => OpenApiSchema): void => {
  const shaped = (value: unknown): OpenApiSchema => {
    const schema = infer(value);
    if (Array.isArray(value)) schema.items = value.length ? shaped(value[0]) : {};
    else if (value && typeof value === "object") {
      schema.required = Object.keys(value);
      schema.properties = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, shaped(child)]));
    }
    return schema;
  };
  const nullable = (schema: OpenApiSchema): OpenApiSchema => ({ ...schema, nullable: true });
  const enumeration = (values: readonly string[]) => ({ type: "string", enum: values });
  const profileSchema = shaped(profile);
  const props = profileSchema.properties as Record<string, OpenApiSchema>;
  props.visibility = enumeration(["draft", "discoverable", "paused", "paired"]);
  props.adultConfirmed = { type: "boolean", const: true };
  props.activeConnectionId = nullable({ type: "string" });
  profileSchema.required = ["_id", "userId", "visibility", "questionnaireVersion", "activeConnectionId"];
  for (const [key, values] of Object.entries(roommateOptions)) props[key] = enumeration(values);
  props.acceptableGenders = { type: "array", items: enumeration(roommateOptions.gender) };
  for (const key of ["moveInFrom", "moveInTo"]) props[key] = { type: "string", format: "date" };
  const userSchema = shaped(user);
  userSchema.required = ["_id", "firstName", "lastName", "interests", "hobbies"];
  const connectionSchema = shaped(connection);
  const connectionProps = connectionSchema.properties as Record<string, OpenApiSchema>;
  connectionProps.user = userSchema;
  connectionProps.status = enumeration(["active", "paired", "closed"]);
  connectionProps.profile = nullable(profileSchema);
  connectionProps.conversationId = nullable({ type: "string" });
  connectionProps.pairedAt = nullable({ type: "string", format: "date-time" });
  connectionProps.myContactFields = { type: "array", items: enumeration(["phone", "email"]) };
  for (const key of ["friendship", "pairingRequest"] as const) {
    const schema = nullable(shaped(connection[key]));
    (schema.properties as Record<string, OpenApiSchema>).status = enumeration(key === "friendship"
      ? ["pending", "accepted", "declined", "blocked"] : ["pending", "accepted", "declined", "cancelled", "closed"]);
    connectionProps[key] = schema;
  }
  for (const endpoint of roommateEndpoints) {
    const key = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
    contracts.success[key] = { status: 200, description: endpoint.summary,
      example: { success: true, message: endpoint.summary, data: responseData[key] } };
  }
  for (const [key, body] of Object.entries(bodies)) {
    const schema = z.toJSONSchema(body.validator, { io: "input", unrepresentable: "any" }) as OpenApiSchema;
    delete schema.$schema;
    contracts.bodies[key] = { contentType: "application/json", description: "Validated input. Drafts may omit answers; activation requires all matching answers. Unknown fields are rejected.", schema, example: body.example };
    contracts.schemas[key] = schema;
  }
  for (const key of ["GET /roommates/candidates", "GET /roommates/connections", "GET /users/me/blocks"]) {
    contracts.queries[key] = [
      { name: "page", description: "One-based page", schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 } },
      { name: "limit", description: "Page size", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
    ];
  }
  for (const key of ["GET /roommates/profiles/me", "PUT /roommates/profiles/me", "PATCH /roommates/profiles/me/visibility"]) {
    contracts.responses[key] = { "data.profile": key.startsWith("GET") ? nullable(profileSchema) : profileSchema };
  }
  const candidateSchema = shaped({ user, profile, score: 80, reasons: ["Compatible area"] });
  (candidateSchema.properties as Record<string, OpenApiSchema>).user = userSchema;
  (candidateSchema.properties as Record<string, OpenApiSchema>).profile = profileSchema;
  contracts.responses["GET /roommates/candidates"] = { "data.candidates[]": candidateSchema };
  contracts.responses["GET /roommates/connections"] = { "data.connections[]": connectionSchema };
  contracts.responses["GET /roommates/connections/{id}"] = { "data.connection": connectionSchema };
  contracts.responses["PUT /roommates/decisions/{userId}"] = {
    "data.matched": { type: "boolean" }, "data.connectionId": nullable({ type: "string" }),
  };
  contracts.responses["GET /roommates/connections/{id}/contacts"] = { "data.contacts": {
    type: "object", additionalProperties: false,
    properties: { phone: { type: "string" }, email: { type: "string", format: "email" } },
  } };
  contracts.responses["PATCH /roommates/connections/{id}/requests/{requestId}"] = {
    "data.status": enumeration(["accepted", "declined", "cancelled"]),
  };
  const blockedUserSchema = shaped({ _id: otherId, firstName: "Ada", lastName: "Okafor", avatarUrl: "https://example.com/avatar.jpg" });
  blockedUserSchema.required = ["_id", "firstName", "lastName"];
  contracts.responses["GET /users/me/blocks"] = { "data.blocks[].targetId": nullable(blockedUserSchema) };
  for (const endpoint of roommateEndpoints) {
    const key = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
    contracts.responses[key] = { data: shaped(responseData[key]), ...contracts.responses[key] };
  }
};
