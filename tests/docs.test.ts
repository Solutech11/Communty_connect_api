import assert from "node:assert/strict";
import test from "node:test";
import "./test-env";
import { openApiDocument } from "../Config/swagger";
import { apiEndpoints } from "../docs/endpoint-registry";
import {
  queryParameterContracts,
  requestBodyEnumContracts,
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
    assert.ok(content?.["application/json"]?.example, `Missing success example: ${key}`);

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

test("success response schemas expose enums for documented model fields", () => {
  const expectations = [
    ["POST /events", "data.event.status", ["draft", "pending_approval", "published", "rejected", "deactivated", "cancelled", "completed"]],
    ["GET /events", "data.events[].moderation.verdict", ["approved", "rejected"]],
    ["POST /communities", "data.community.membershipType", ["free", "premium"]],
    ["POST /wallet/transfers", "data.transaction.direction", ["credit", "debit"]],
    ["POST /chat/conversations", "data.conversation.type", ["direct", "group", "support", "ai"]],
    ["GET /ai/sessions", "data.sessions[].purpose", ["assistant", "event_copy", "recommendations", "chat_summary", "moderation"]],
    ["PATCH /communities/{id}/notification-preferences/me", "data.level", ["all", "announcements", "mentions", "muted"]],
  ] as const;

  for (const [key, path, expectedValues] of expectations) {
    const fieldSchema = schemaAtPath(getSuccessSchema(getOperation(key)), path);
    assert.ok(fieldSchema, "Missing response enum schema at " + key + " " + path);
    assert.deepEqual(fieldSchema.enum, [...expectedValues], "Incorrect response enum at " + key + " " + path);
  }
});
