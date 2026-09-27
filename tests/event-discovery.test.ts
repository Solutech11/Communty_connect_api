import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { mock } from "node:test";
import "./test-env";
import { discoveryFilter, discoverySort, listDiscoverEvents } from "../Controller/eventDiscovery.controller";
import { EventModel } from "../models/Event/Event.model";

test("discovery keeps past published events visible while upcoming sections exclude them", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  assert.deepEqual(discoveryFilter("past", "Lagos", now), {
    status: "published", endsAt: { $lt: now }, state: "Lagos",
  });
  assert.deepEqual(discoveryFilter("recent", undefined, now), {
    status: "published", startsAt: { $gte: now },
  });
  assert.deepEqual(discoverySort("recent"), { publishedAt: -1, startsAt: 1, _id: 1 });
  assert.deepEqual(discoverySort("past"), { endsAt: -1, _id: 1 });
});

test("trending ranking counts paid quantities from the last seven days and falls back to soonest", async () => {
  const count = mock.method(EventModel, "countDocuments", async () => 0);
  const aggregate = mock.method(EventModel, "aggregate", async () => []);
  const populate = mock.method(EventModel, "populate", async () => []);
  const request = { query: { section: "trending", state: "Lagos", page: "1", limit: "3" } } as unknown as Request;
  let body: unknown;
  const response = { status() { return this; }, json(value: unknown) { body = value; return this; } } as unknown as Response;
  try {
    await listDiscoverEvents(request, response);
    const pipeline = aggregate.mock.calls[0]?.arguments[0] as unknown as Record<string, unknown>[];
    assert.ok(pipeline);
    assert.deepEqual((pipeline[0]!.$match as Record<string, unknown>).state, "Lagos");
    const lookup = pipeline[1]!.$lookup as { pipeline: Record<string, unknown>[] };
    const match = lookup.pipeline[0]!.$match as Record<string, unknown>;
    assert.equal(match.status, "paid");
    assert.ok(Array.isArray(match.$or));
    assert.deepEqual(lookup.pipeline[1]!.$group, { _id: null, count: { $sum: "$quantity" } });
    assert.deepEqual(pipeline[4]!.$sort, { trendingTickets: -1, startsAt: 1, _id: 1 });
    assert.deepEqual(pipeline[6]!.$limit, 3);
    assert.equal((body as { success: boolean }).success, true);
  } finally {
    populate.mock.restore(); aggregate.mock.restore(); count.mock.restore();
  }
});
