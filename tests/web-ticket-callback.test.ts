import assert from "node:assert/strict";
import test from "node:test";
import "./test-env";
import { webCallbackUrl } from "../Controller/ticket.controller";
import { env } from "../Config/env";

test("web checkout returns to the configured website ticket verification route", () => {
  const callback = new URL(webCallbackUrl("CC-1784370000000-A1B2C3D4"));
  const expectedOrigin = new URL(env.WEB_BASE_URL || "http://localhost:5173").origin;
  assert.equal(callback.origin, expectedOrigin);
  assert.equal(callback.pathname, "/checkout/return/CC-1784370000000-A1B2C3D4");
  assert.equal(callback.search, "");
});
