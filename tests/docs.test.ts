import assert from "node:assert/strict";
import test from "node:test";
import "./test-env";
import { openApiDocument } from "../Config/swagger";
import { apiEndpoints } from "../docs/endpoint-registry";

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
