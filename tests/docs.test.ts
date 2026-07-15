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
