import assert from "node:assert/strict";
import test from "node:test";
import "./test-env";
import { calculatePlatformCharge } from "../utils/platformCharge.utils";

test("platform charges use configured integer basis points and round up to kobo", () => {
  assert.equal(calculatePlatformCharge(10_000, "deposit"), 100);
  assert.equal(calculatePlatformCharge(10_000, "withdrawal"), 100);
  assert.equal(calculatePlatformCharge(10_000, "ticket_purchase"), 500);
  assert.equal(calculatePlatformCharge(10_000, "community_membership"), 500);
  assert.equal(calculatePlatformCharge(1, "ticket_purchase"), 1);
  assert.equal(calculatePlatformCharge(0, "deposit"), 0);
});

test("platform charges reject unsafe monetary input", () => {
  assert.throws(() => calculatePlatformCharge(-1, "deposit"));
  assert.throws(() => calculatePlatformCharge(1.5, "deposit"));
  assert.throws(() => calculatePlatformCharge(Number.MAX_VALUE, "deposit"));
});
