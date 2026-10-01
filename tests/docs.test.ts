import assert from "node:assert/strict";
import test from "node:test";
import "./test-env";
import { openApiDocument } from "../Config/swagger";
import { apiEndpoints } from "../docs/endpoint-registry";
import {
  queryParameterContracts,
  requestBodyContracts,
  requestBodyEnumContracts,
  requestBodySchemaContracts,
} from "../docs/openapi-contracts";

const schemaAtPath = (
  schema: unknown,
  path: string,
): Record<string, unknown> | undefined => {
  let current = schema as Record<string, unknown> | undefined;

  for (const segment of path.split(".")) {
    if (!current) return undefined;

    if (segment.endsWith("[]")) {
      const property = segment.slice(0, -2);
      const properties = current.properties as Record<string, Record<string, unknown>> | undefined;
      const arraySchema = properties?.[property];
      current = arraySchema?.items as Record<string, unknown> | undefined;
      continue;
    }

    const properties = current.properties as Record<string, Record<string, unknown>> | undefined;
    current = properties?.[segment];
  }

  return current;
};

const getOperation = (key: string): Record<string, unknown> => {
  const endpoint = apiEndpoints.find((candidate) => (
    candidate.method.toUpperCase() + " " + candidate.path === key
  ));
  assert.ok(endpoint, "Missing registry entry for " + key);

  const pathItem = openApiDocument.paths[endpoint.path] as Record<string, unknown>;
  return pathItem[endpoint.method] as Record<string, unknown>;
};

const getSuccessSchema = (operation: Record<string, unknown>): Record<string, unknown> => {
  const responses = operation.responses as Record<string, Record<string, unknown>>;
  const success = Object.entries(responses).find(([status]) => /^2\d\d$/.test(status));
  assert.ok(success, "Missing success response");

  const content = success[1].content as Record<string, Record<string, unknown>>;
  const jsonContent = content["application/json"];
  if (!jsonContent) throw new Error("Missing JSON success response");
  return jsonContent.schema as Record<string, unknown>;
};

test("OpenAPI contains one unique operation for every endpoint registry entry", () => {
  const keys = apiEndpoints.map((endpoint) => `${endpoint.method}:${endpoint.path}`);

  assert.equal(new Set(keys).size, keys.length);

  for (const endpoint of apiEndpoints) {
    const pathItem = openApiDocument.paths[endpoint.path] as Record<string, unknown> | undefined;

    assert.ok(pathItem, `Missing OpenAPI path: ${endpoint.path}`);
    assert.ok(
      pathItem[endpoint.method],
      `Missing OpenAPI operation: ${endpoint.method.toUpperCase()} ${endpoint.path}`,
    );
  }
});


test("every OpenAPI operation exposes concrete request contracts and success examples", () => {
  for (const endpoint of apiEndpoints) {
    const key = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
    const pathItem = openApiDocument.paths[endpoint.path] as Record<string, unknown>;
    const operation = pathItem[endpoint.method] as Record<string, unknown>;
    const responses = operation.responses as Record<string, Record<string, unknown>>;
    const successEntry = Object.entries(responses).find(([status]) => /^2\d\d$/.test(status));

    assert.ok(successEntry, `Missing success response: ${key}`);
    const content = successEntry[1].content as Record<string, Record<string, unknown>>;
    assert.ok(content?.["application/json"]?.schema, `Missing success schema: ${key}`);
    assert.ok(
      content?.["application/json"]?.example || content?.["application/json"]?.examples,
      `Missing success example: ${key}`,
    );

    if (endpoint.requestBody) {
      const requestBody = operation.requestBody as Record<string, unknown>;
      assert.ok(requestBody, `Missing request body: ${key}`);
      const requestContent = requestBody.content as Record<string, Record<string, unknown>>;
      const media = Object.values(requestContent)[0];
      assert.ok(media?.schema, `Missing request schema: ${key}`);
      assert.ok(media?.example, `Missing request example: ${key}`);
    }
  }
});

test("path parameters expose their validated formats and length limits", () => {
  const objectIdParameters = new Set([
    "id", "userId", "requestId", "callId", "messageId", "postId", "announcementId", "ticketTypeId",
  ]);

  for (const endpoint of apiEndpoints) {
    const key = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
    const pathParameters = [...endpoint.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
    const operation = getOperation(key);
    const parameters = operation.parameters as Array<Record<string, unknown>>;

    for (const name of pathParameters) {
      const parameter = parameters.find((candidate) => candidate.in === "path" && candidate.name === name);
      assert.ok(parameter, "Missing documented path parameter " + name + " on " + key);
      assert.equal(parameter.required, true);
      const schema = parameter.schema as Record<string, unknown>;
      assert.equal(schema.type, "string");

      if (objectIdParameters.has(name)) {
        assert.equal(schema.pattern, "^[a-fA-F0-9]{24}$", "Incorrect ObjectId format for " + name + " on " + key);
      } else if (name === "emoji") {
        assert.equal(schema.minLength, 1);
        assert.equal(schema.maxLength, 32);
      } else if (name === "reference" || name === "orderNumber") {
        assert.equal(schema.minLength, name === "reference" ? 16 : 12);
        assert.equal(schema.maxLength, 80);
      }
    }
  }
});

test("every documented request body has a complete validator-shaped schema contract", () => {
  assert.deepEqual(
    Object.keys(requestBodySchemaContracts).sort(),
    Object.keys(requestBodyContracts).sort(),
    "Every request body must have an explicit schema contract rather than only an example-inferred shape",
  );

  for (const [key, body] of Object.entries(requestBodyContracts)) {
    const schema = requestBodySchemaContracts[key];
    assert.ok(schema, "Missing explicit request schema for " + key);
    assert.equal(schema.type, "object", "Expected object request schema for " + key);

    const properties = schema.properties as Record<string, unknown> | undefined;
    assert.ok(properties, "Missing request properties for " + key);
    const required = schema.required as string[] | undefined;
    for (const property of required || []) {
      assert.ok(properties[property], "Required request property is undocumented: " + key + " " + property);
    }

    if (body.contentType === "application/json") {
      assert.notEqual(schema.additionalProperties, undefined, "JSON request strictness must be documented: " + key);
      if (key !== "POST /webhooks/paystack") {
        assert.equal(schema.additionalProperties, false, "JSON request should reject unknown fields: " + key);
      }

      const operation = getOperation(key);
      const requestBody = operation.requestBody as Record<string, unknown>;
      const content = requestBody.content as Record<string, Record<string, unknown>>;
      const media = content[body.contentType];
      const emittedSchema = media?.schema as Record<string, unknown> | undefined;
      assert.ok(emittedSchema, "Swagger did not emit the request schema for " + key);
      assert.deepEqual(
        Object.keys(emittedSchema.properties as Record<string, unknown>).sort(),
        Object.keys(properties).sort(),
        "Swagger request fields differ from the explicit contract for " + key,
      );
    }
  }
});

test("every route-validated request enum is listed in its Swagger schema", () => {
  for (const [key, enumContracts] of Object.entries(requestBodyEnumContracts)) {
    const operation = getOperation(key);
    const requestBody = operation.requestBody as Record<string, unknown>;
    const content = requestBody.content as Record<string, Record<string, unknown>>;
    const media = Object.values(content)[0];
    if (!media) throw new Error("Missing request body media type for " + key);
    const requestSchema = media.schema as Record<string, unknown>;

    for (const [path, values] of Object.entries(enumContracts)) {
      const fieldSchema = schemaAtPath(requestSchema, path);
      assert.ok(fieldSchema, "Missing request enum schema at " + key + " " + path);
      assert.deepEqual(fieldSchema.enum, [...values], "Incorrect request enum at " + key + " " + path);
    }
  }
});

test("request enum contracts cover every enum-bearing body validator", () => {
  const expected = {
    "POST /auth/register": { "location.type": ["Point"] },
    "PATCH /users/me": {
      "location.type": ["Point"],
      preferredSetting: ["indoor", "outdoor"],
      preferredGroupSize: ["small", "medium", "large"],
      participationRole: ["participant", "organizer"],
    },
    "POST /users/{id}/reports": { reason: ["spam", "harassment", "hate", "violence", "scam", "unsafe", "misinformation", "other"] },
    "PATCH /friends/requests/{id}": { action: ["accept", "decline", "reject"] },
    "POST /chat/conversations": { type: ["direct", "group", "support"] },
    "POST /chat/conversations/{id}/messages": { type: ["text", "image"] },
    "PATCH /communities/{id}/settings": {
      joinPolicy: ["open", "approval", "invite_only", "access_code"],
      messagePermission: ["everyone", "moderators"],
    },
    "PATCH /communities/{id}/members/{userId}": {
      role: ["moderator", "member"],
      status: ["active", "removed"],
    },
    "PATCH /communities/{id}/join-requests/{requestId}": { status: ["approved", "rejected"] },
    "POST /communities/{id}/calls": { type: ["voice", "video"] },
    "PATCH /communities/{id}/notification-preferences/me": { level: ["all", "announcements", "mentions", "muted"] },
    "POST /communities/{id}/messages/{messageId}/reports": { reason: ["spam", "harassment", "hate_speech", "unsafe", "inappropriate", "other"] },
    "POST /communities/{id}/reports": { reason: ["spam", "harassment", "hate", "violence", "scam", "unsafe", "misinformation", "other"] },
    "POST /events": { setting: ["indoor", "outdoor", "online", "hybrid"], "coordinates.type": ["Point"] },
    "PATCH /events/{id}": { setting: ["indoor", "outdoor", "online", "hybrid"], "coordinates.type": ["Point"] },
    "POST /events/{id}/reports": { reason: ["spam", "harassment", "hate", "violence", "scam", "unsafe", "misinformation", "other"] },
    "POST /communities": { visibility: ["public", "private"], membershipType: ["free", "premium"] },
    "PATCH /communities/{id}": { visibility: ["public", "private"], membershipType: ["free", "premium"] },
    "POST /disputes": { category: ["payment", "withdrawal", "transfer", "ticket", "event", "harassment", "other"] },
    "PATCH /disputes/{id}/status": { status: ["open", "under_review", "awaiting_user", "resolved", "closed"] },
    "POST /uploads/files": { folder: ["community-chat"] },
    "POST /uploads/images": { folder: ["avatars", "events", "communities", "disputes", "chat", "uploads"] },
  } as const;

  assert.deepEqual(requestBodyEnumContracts, expected);
});

test("enum query parameters are listed in their Swagger operations", () => {
  for (const [key, contracts] of Object.entries(queryParameterContracts)) {
    const operation = getOperation(key);
    const parameters = operation.parameters as Array<Record<string, unknown>>;

    for (const contract of contracts) {
      const values = contract.schema.enum;
      if (!Array.isArray(values)) continue;

      const parameter = parameters.find((candidate) => (
        candidate.in === "query" && candidate.name === contract.name
      ));
      assert.ok(parameter, "Missing query parameter " + contract.name + " on " + key);
      const schema = parameter.schema as Record<string, unknown>;
      assert.deepEqual(schema.enum, values, "Incorrect query enum for " + contract.name + " on " + key);
    }
  }
});

test("every Zod query enum is represented with the same values in Swagger", () => {
  const expected = [
    ["GET /users/me/communities", "role", ["owner", "moderator", "member"]],
    ["GET /users/me/communities", "status", ["pending", "active"]],
    ["GET /users/me/communities", "unreadOnly", ["true", "false"]],
    ["GET /communities/{id}/members", "role", ["owner", "moderator", "member"]],
    ["GET /communities/{id}/members", "status", ["active", "banned"]],
    ["GET /communities/{id}/join-requests", "status", ["pending", "approved", "rejected"]],
    ["GET /notifications", "unread", ["true", "false"]],
    ["GET /disputes", "status", ["open", "under_review", "awaiting_user", "resolved", "closed"]],
    ["GET /wallet/transactions", "type", ["topup", "internal_transfer", "withdrawal", "ticket_purchase", "community_purchase", "refund", "adjustment"]],
    ["GET /wallet/transactions", "status", ["pending", "processing", "successful", "failed", "reversed"]],
    ["GET /wallet/transactions", "direction", ["credit", "debit"]],
  ] as const;

  for (const [key, name, values] of expected) {
    const contract = queryParameterContracts[key]?.find((parameter) => parameter.name === name);
    assert.ok(contract, "Missing documented query field " + name + " on " + key);
    assert.deepEqual(contract.schema.enum, [...values], "Incorrect query enum on " + key + " " + name);
  }
});

test("success response schemas expose enums for documented model fields", () => {
  const expectations = [
    ["POST /auth/verify-email", "data.user.role", ["member", "moderator", "admin"]],
    ["POST /auth/verify-email", "data.user.status", ["pending_verification", "active", "suspended", "deleted"]],
    ["POST /auth/verify-email", "data.user.location.type", ["Point"]],
    ["POST /auth/verify-email", "data.user.preferredSetting", ["indoor", "outdoor"]],
    ["POST /events", "data.event.status", ["draft", "pending_approval", "published", "rejected", "deactivated", "cancelled", "completed"]],
    ["POST /events", "data.event.setting", ["indoor", "outdoor", "online", "hybrid"]],
    ["POST /events", "data.event.moderation.provider", ["groq", "test_override"]],
    ["POST /events", "data.event.moderation.verdict", ["approved", "rejected"]],
    ["GET /events", "data.events[].moderation.verdict", ["approved", "rejected"]],
    ["POST /communities", "data.community.membershipType", ["free", "premium"]],
    ["POST /communities", "data.community.joinPolicy", ["open", "approval", "invite_only", "access_code"]],
    ["GET /communities/{id}/settings", "data.settings.messagePermission", ["everyone", "moderators"]],
    ["GET /wallet/transactions", "data.transactions[].type", ["topup", "internal_transfer", "withdrawal", "ticket_purchase", "community_purchase", "refund", "adjustment"]],
    ["GET /wallet/transactions", "data.transactions[].provider", ["internal", "paystack"]],
    ["GET /wallet", "data.wallet.status", ["active", "frozen", "closed"]],
    ["POST /chat/conversations", "data.conversation.type", ["direct", "group", "support", "ai"]],
    ["POST /chat/conversations/{id}/messages", "data.message.type", ["text", "image", "system"]],
    ["POST /communities/{id}/calls", "data.call.status", ["active", "ended"]],
    ["POST /communities/{id}/join-requests", "data.joinRequest.status", ["pending", "approved", "rejected", "cancelled"]],
    ["POST /events/{id}/reports", "data.report.targetType", ["event", "community", "user", "community_message"]],
    ["POST /events/{id}/reports", "data.report.reason", ["spam", "harassment", "hate", "hate_speech", "violence", "scam", "unsafe", "inappropriate", "misinformation", "other"]],
    ["POST /disputes", "data.dispute.priority", ["low", "normal", "high", "urgent"]],
    ["GET /ai/sessions", "data.sessions[].purpose", ["assistant", "event_copy", "recommendations", "chat_summary", "moderation"]],
    ["POST /uploads/files", "data.attachment.type", ["image", "pdf", "file"]],
    ["PATCH /communities/{id}/notification-preferences/me", "data.level", ["all", "announcements", "mentions", "muted"]],
    ["GET /tickets", "data.tickets[].status", ["pending", "paid", "cancelled", "refunded"]],
    ["GET /tickets/{orderNumber}", "data.order.status", ["pending", "paid", "cancelled", "refunded"]],
    ["GET /events/{id}/attendees", "data.attendees[].status", ["pending", "paid", "cancelled", "refunded"]],
  ] as const;

  for (const [key, path, expectedValues] of expectations) {
    const fieldSchema = schemaAtPath(getSuccessSchema(getOperation(key)), path);
    assert.ok(fieldSchema, "Missing response enum schema at " + key + " " + path);
    assert.deepEqual(fieldSchema.enum, [...expectedValues], "Incorrect response enum at " + key + " " + path);
  }
});

test("ticket API documentation exposes complete tier, order, and validation schemas", () => {
  const eventSchema = getSuccessSchema(getOperation("GET /events/{id}"));
  const tierSchema = schemaAtPath(eventSchema, "data.ticketTypes[]");
  assert.ok(tierSchema, "Missing ticket type response schema");
  assert.deepEqual(tierSchema.required, ["_id", "eventId", "title", "priceKobo", "sold", "active", "createdAt", "updatedAt"]);
  const tierProperties = tierSchema.properties as Record<string, Record<string, unknown>>;
  const tierPriceSchema = tierProperties.priceKobo;
  const tierCapacitySchema = tierProperties.capacity;
  assert.ok(tierPriceSchema);
  assert.ok(tierCapacitySchema);
  assert.equal(tierPriceSchema.type, "integer");
  assert.equal(tierPriceSchema.minimum, 0);
  assert.equal(tierPriceSchema.maximum, 1_000_000_000_000);
  assert.equal(tierCapacitySchema.maximum, 1_000_000);

  const ticketListSchema = getSuccessSchema(getOperation("GET /tickets"));
  const orderSchema = schemaAtPath(ticketListSchema, "data.tickets[]");
  assert.ok(orderSchema, "Missing ticket order response schema");
  const orderProperties = orderSchema.properties as Record<string, Record<string, unknown>>;
  assert.ok(orderProperties.paymentReference);
  assert.ok(orderProperties.idempotencyKey);
  assert.ok(orderProperties.organizerProceedsKobo);
  const orderStatusSchema = orderProperties.status;
  assert.ok(orderStatusSchema);
  assert.deepEqual(orderStatusSchema.enum, ["pending", "paid", "cancelled", "refunded"]);

  const addTier = getOperation("POST /events/{id}/ticket-types");
  const addBody = (addTier.requestBody as Record<string, unknown>).content as Record<string, Record<string, unknown>>;
  const addSchema = Object.values(addBody)[0]?.schema as Record<string, unknown>;
  const addProperties = addSchema.properties as Record<string, Record<string, unknown>>;
  const titleSchema = addProperties.title;
  const priceSchema = addProperties.priceKobo;
  const capacitySchema = addProperties.capacity;
  assert.ok(titleSchema);
  assert.ok(priceSchema);
  assert.ok(capacitySchema);
  assert.deepEqual(addSchema.required, ["title", "priceKobo"]);
  assert.equal(titleSchema.minLength, 2);
  assert.equal(titleSchema.maxLength, 80);
  assert.equal(priceSchema.type, "integer");
  assert.equal(capacitySchema.maximum, 1_000_000);

  const patchTier = getOperation("PATCH /events/{id}/ticket-types/{ticketTypeId}");
  const patchBody = (patchTier.requestBody as Record<string, unknown>).content as Record<string, Record<string, unknown>>;
  const patchSchema = Object.values(patchBody)[0]?.schema as Record<string, unknown>;
  assert.equal(patchSchema.minProperties, 1);

  const orderOperation = getOperation("POST /events/{id}/orders");
  const orderResponses = orderOperation.responses as Record<string, Record<string, unknown>>;
  assert.ok(orderResponses["200"], "Missing idempotent order response");
  const createdBody = orderResponses["201"]?.content as Record<string, Record<string, unknown>>;
  const createdSchema = Object.values(createdBody)[0]?.schema as Record<string, Record<string, unknown>>;
  const dataSchema = ((createdSchema.properties as Record<string, Record<string, unknown>>).data);
  assert.ok(dataSchema);
  assert.equal((dataSchema.oneOf as unknown[]).length, 2, "Checkout and free-ticket response shapes must both be documented");
});

test("check-in preview documentation includes request, response, enum, and error contracts", () => {
  const operation = getOperation("POST /events/{eventId}/check-ins/verify");
  assert.deepEqual(operation.security, [{ bearerAuth: [] }]);

  const requestBody = operation.requestBody as { content: Record<string, { schema: Record<string, unknown> }> };
  const requestSchema = requestBody.content["application/json"]?.schema;
  assert.ok(requestSchema);
  assert.deepEqual(requestSchema.required, ["qrToken"]);
  assert.equal(requestSchema.additionalProperties, false);
  const qrSchema = (requestSchema.properties as Record<string, Record<string, unknown>>).qrToken;
  assert.deepEqual([qrSchema?.minLength, qrSchema?.maxLength], [32, 4096]);

  const successSchema = getSuccessSchema(operation);
  assert.deepEqual(schemaAtPath(successSchema, "data.status")?.enum, ["valid"]);
  assert.deepEqual(schemaAtPath(successSchema, "data.ticket.paymentStatus")?.enum, ["paid"]);
  assert.deepEqual(schemaAtPath(successSchema, "data.checkedInAt")?.type, ["string", "null"]);
  assert.deepEqual(schemaAtPath(successSchema, "data.attendee.avatarUrl")?.type, ["string", "null"]);

  const responses = operation.responses as Record<string, { content: Record<string, {
    examples: Record<string, { value: { data?: Record<string, unknown>; error?: { code: string } } }>;
    schema: Record<string, unknown>;
  }> }>;
  const successExamples = responses["200"]?.content["application/json"]?.examples;
  assert.equal(successExamples?.available?.value.data?.canCheckIn, true);
  assert.equal(successExamples?.alreadyCheckedIn?.value.data?.canCheckIn, false);
  assert.equal(typeof successExamples?.alreadyCheckedIn?.value.data?.checkedInAt, "string");
  assert.equal(successExamples?.outsideWindow?.value.data?.checkedInAt, null);

  const notFound = responses["404"]?.content["application/json"];
  assert.deepEqual(schemaAtPath(notFound?.schema, "error.code")?.enum, ["INVALID_TICKET", "EVENT_NOT_FOUND"]);
  assert.equal(notFound?.examples.invalidTicket?.value.error?.code, "INVALID_TICKET");
  assert.equal(notFound?.examples.eventNotFound?.value.error?.code, "EVENT_NOT_FOUND");
});
