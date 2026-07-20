import assert from "node:assert/strict";
import test from "node:test";
import "./test-env";
import { env } from "../Config/env";
import { redisClient } from "../DB/redis";
import { isCorsOriginAllowed } from "../middleware/security.middleware";

test("rate limiters do not command Redis before application bootstrap", async () => {
  assert.equal(redisClient.isOpen, false);

  const errors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]): void => {
    errors.push(args);
  };

  try {
    const security = await import("../middleware/security.middleware.js");
    await new Promise<void>((resolve) => setTimeout(resolve, 25));

    assert.equal(typeof security.globalRateLimiter, "function");
    assert.equal(typeof security.authRateLimiter, "function");
    assert.equal(typeof security.aiRateLimiter, "function");
    assert.deepEqual(errors, []);
    assert.equal(redisClient.isOpen, false);
  } finally {
    console.error = originalConsoleError;
  }
});


test("CORS allows the API origin used by the server-rendered admin portal", () => {
  assert.ok(env.allowedOrigins.includes(new URL(env.APP_BASE_URL).origin));
});


test("development CORS accepts local browser and Expo origins", () => {
  assert.equal(isCorsOriginAllowed("http://localhost:5173"), true);
  assert.equal(isCorsOriginAllowed("http://192.168.1.2:8081"), true);
});
