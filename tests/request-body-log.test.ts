import assert from "node:assert/strict";
import test from "node:test";
import { requestBodyLogFields, sanitizeRequestBodyForLog } from "../utils/requestBodyLog.utils";

test("request body logger preserves allowlisted non-sensitive metadata", () => {
  assert.deepEqual(
    sanitizeRequestBodyForLog({
      action: "decline",
      limit: 8,
      countryCode: "ng",
      title: "Private event title",
      description: "Event details supplied by a user",
    }),
    {
      action: "decline",
      limit: 8,
      countryCode: "NG",
      title: "[REDACTED]",
      description: "[REDACTED]",
    },
  );
});

test("request body logger redacts secrets, personal data, and free text recursively", () => {
  assert.deepEqual(
    sanitizeRequestBodyForLog({
      password: "not-for-logs",
      email: "person@example.com",
      message: "private conversation",
      eventId: "event-id",
      preferences: { setting: "online", latitude: 6.5 },
      ticketTypes: [{ title: "VIP", priceKobo: 600_000 }],
    }),
    {
      password: "[REDACTED]",
      email: "[REDACTED]",
      message: "[REDACTED]",
      eventId: "[REDACTED]",
      preferences: { setting: "online", latitude: "[REDACTED]" },
      ticketTypes: { itemCount: 1 },
    },
  );
});

test("request body logger never includes Paystack webhook payloads", () => {
  assert.deepEqual(
    sanitizeRequestBodyForLog(
      {
        event: "charge.success",
        data: {
          id: 123,
          reference: "payment-reference",
          amount: 101_000,
          status: "success",
          email: "person@example.com",
        },
      },
      "/api/v1/webhooks/paystack?source=test",
      128,
    ),
    {
      eventType: "charge.success",
      dataFields: ["id", "reference", "amount", "status"],
      dataFieldCount: 5,
      payloadByteLength: 128,
    },
  );
});

test("request body logger handles absent and unexpected body shapes safely", () => {
  assert.equal(sanitizeRequestBodyForLog(undefined), null);
  assert.equal(sanitizeRequestBodyForLog("free-form body"), "[REDACTED]");
  assert.deepEqual(sanitizeRequestBodyForLog(["secret", "data"]), { itemCount: 2 });
});

test("request body logging is omitted unless enabled", () => {
  assert.deepEqual(requestBodyLogFields(false, { action: "accept" }, "/api/v1/events"), {});
  assert.deepEqual(
    requestBodyLogFields(true, { action: "accept" }, "/api/v1/events"),
    { requestBody: { action: "accept" } },
  );
});
