import assert from "node:assert/strict";
import test from "node:test";
import "./test-env";
import { redisClient } from "../DB/redis";

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
