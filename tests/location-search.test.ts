import assert from "node:assert/strict";
import test, { mock } from "node:test";
import axios from "axios";
import "./test-env";
import { locationReverseQuerySchema, locationSearchQuerySchema } from "../schemas/location.schemas";
import { mapGeoapifyResult, reverseGeoapifyState, searchGeoapifyLocations } from "../utils/geoapify.utils";
import { openApiDocument } from "../Config/swagger";

test("location query trims text, caps limit, and requires a complete valid coordinate pair", () => {
  assert.deepEqual(locationSearchQuerySchema.parse({
    q: "  Eko Hotel  ", countryCode: "ng", latitude: "6.5244", longitude: "3.3792", limit: "20",
  }), {
    q: "Eko Hotel", countryCode: "NG", latitude: 6.5244, longitude: 3.3792, limit: 8,
  });
  for (const query of [
    {}, { q: " " }, { q: "Eko", latitude: "6.5" },
    { q: "Eko", latitude: "91", longitude: "3" },
    { q: "Eko", latitude: "6", longitude: "181" },
    { q: "Eko", countryCode: "NGA" }, { q: "Eko", limit: "0" },
  ]) {
    assert.equal(locationSearchQuerySchema.safeParse(query).success, false);
  }
});

test("Geoapify mapping preserves available fields and leaves absent address parts null", () => {
  assert.deepEqual(mapGeoapifyResult({
    place_id: "provider-id", name: "Eko Hotel & Suites", formatted: "Eko Hotel, Lagos, Nigeria",
    address_line2: "Victoria Island, Lagos, Nigeria", lat: 6.4281, lon: 3.4219,
    state: "Lagos", county: "Eti-Osa",
  }), {
    id: "provider-id", name: "Eko Hotel & Suites", label: "Eko Hotel, Lagos, Nigeria",
    address: "Victoria Island, Lagos, Nigeria", latitude: 6.4281, longitude: 3.4219,
    state: "Lagos", localArea: "Eti-Osa",
  });
  const result = mapGeoapifyResult({ formatted: "Lagos, Nigeria", lat: 6.5, lon: 3.4 });
  assert.ok(result?.id);
  assert.equal(result?.state, null);
  assert.equal(result?.localArea, null);
  assert.equal(mapGeoapifyResult({ formatted: "Bad", lat: 91, lon: 3 }), null);
});

test("reverse lookup validates coordinates, sends them to Geoapify, and returns the state", async () => {
  assert.equal(locationReverseQuerySchema.safeParse({ latitude: "91", longitude: "3" }).success, false);
  assert.equal(locationReverseQuerySchema.safeParse({ latitude: "6.5" }).success, false);
  const get = mock.method(axios, "get", async (url: string, config?: { params?: Record<string, string | number> }) => {
    assert.equal(url, "https://api.geoapify.com/v1/geocode/reverse");
    assert.equal(config?.params?.lat, 6.5244);
    assert.equal(config?.params?.lon, 3.3792);
    assert.equal(config?.params?.apiKey, "test-key");
    return { data: { results: [{ state: "Lagos" }] } };
  });
  try {
    assert.equal(await reverseGeoapifyState(locationReverseQuerySchema.parse({ latitude: "6.5244", longitude: "3.3792" })), "Lagos");
  } finally { get.mock.restore(); }
});

test("provider request keeps the key server-side and uses longitude,latitude proximity", async () => {
  const get = mock.method(axios, "get", async (
    _url: string,
    config?: { params?: Record<string, string | number> },
  ) => {
    assert.equal(_url, "https://api.geoapify.com/v1/geocode/autocomplete");
    assert.equal(config?.params?.text, "Eko Hotel");
    assert.equal(config?.params?.filter, "countrycode:ng");
    assert.equal(config?.params?.bias, "proximity:3.3792,6.5244");
    assert.equal(config?.params?.limit, 8);
    assert.equal(config?.params?.apiKey, "test-key");
    return { data: { results: [] } };
  });
  try {
    const query = locationSearchQuerySchema.parse({
      q: "Eko Hotel", countryCode: "NG", latitude: "6.5244", longitude: "3.3792",
    });
    assert.deepEqual(await searchGeoapifyLocations(query), []);
    assert.equal(get.mock.callCount(), 1);
  } finally {
    get.mock.restore();
  }
});

test("provider failures use a safe error and Swagger documents auth and nullable fields", async () => {
  const get = mock.method(axios, "get", async () => {
    throw new Error("provider URL contained test-key");
  });
  try {
    await assert.rejects(
      searchGeoapifyLocations(locationSearchQuerySchema.parse({ q: "Eko Hotel" })),
      (error: unknown) => {
        const failure = error as { statusCode?: number; code?: string; message?: string };
        assert.equal(failure.statusCode, 502);
        assert.equal(failure.code, "LOCATION_PROVIDER_UNAVAILABLE");
        assert.equal(failure.message?.includes("test-key"), false);
        return true;
      },
    );
  } finally {
    get.mock.restore();
  }

  const operation = (openApiDocument.paths["/locations/search"] as Record<string, unknown>).get as Record<string, unknown>;
  assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
  const parameters = operation.parameters as Array<{ name: string; required: boolean }>;
  assert.equal(parameters.find((field) => field.name === "q")?.required, true);
  const responses = operation.responses as Record<string, Record<string, unknown>>;
  const schema = ((responses["200"]?.content as Record<string, Record<string, unknown>>)["application/json"]?.schema) as Record<string, unknown>;
  const data = (schema.properties as Record<string, Record<string, unknown>>).data!;
  const results = (data.properties as Record<string, Record<string, unknown>>).results!;
  const item = results.items as Record<string, unknown>;
  const fields = item.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(fields.state?.type, ["string", "null"]);
  assert.deepEqual(fields.localArea?.type, ["string", "null"]);
});
