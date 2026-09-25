import assert from "node:assert/strict";
import test from "node:test";
import {
  prioritizeTicketedRecommendations,
  rankEventRecommendations,
} from "../Community_AI/EventRecommendation.algorithm";

const now = new Date("2026-07-16T10:00:00.000Z");
const profile = {
  interests: ["music"],
  state: "Lagos",
  lga: "Ikeja",
  learnedActivityWeights: { technology: 2 },
  learnedTagWeights: { coding: 2 },
};

test("nearby events remain ahead when distance is the strongest signal", () => {
  const ranked = rankEventRecommendations({
    profile,
    userCoordinates: [3.35, 6.6],
    radiusKm: 100,
    now,
    events: [
      {
        _id: "far-music",
        title: "Far music festival",
        activityType: "music",
        setting: "outdoor",
        state: "Lagos",
        lga: "Badagry",
        tags: ["music"],
        startsAt: "2026-07-20T10:00:00.000Z",
        coordinates: { type: "Point", coordinates: [2.88, 6.42] },
      },
      {
        _id: "near-tech",
        title: "Nearby coding meetup",
        activityType: "technology",
        setting: "indoor",
        state: "Lagos",
        lga: "Ikeja",
        tags: ["coding"],
        startsAt: "2026-07-18T10:00:00.000Z",
        coordinates: { type: "Point", coordinates: [3.351, 6.601] },
      },
    ],
  });

  assert.equal(ranked[0]?.event._id, "near-tech");
  assert.ok((ranked[0]?.distanceKm || 1) < 1);
});

test("ticket history and interests personalize events at similar distances", () => {
  const ranked = rankEventRecommendations({
    profile,
    userCoordinates: [3.35, 6.6],
    radiusKm: 100,
    now,
    events: [
      {
        _id: "generic",
        title: "General meetup",
        activityType: "networking",
        setting: "indoor",
        state: "Lagos",
        lga: "Ikeja",
        tags: [],
        startsAt: "2026-07-18T10:00:00.000Z",
        coordinates: { type: "Point", coordinates: [3.36, 6.61] },
      },
      {
        _id: "learned",
        title: "Coding workshop",
        activityType: "technology",
        setting: "indoor",
        state: "Lagos",
        lga: "Ikeja",
        tags: ["coding"],
        startsAt: "2026-07-18T10:00:00.000Z",
        coordinates: { type: "Point", coordinates: [3.36, 6.61] },
      },
    ],
  });

  assert.equal(ranked[0]?.event._id, "learned");
  assert.ok(ranked[0]?.reasons.includes("Similar to events you joined"));
});

test("upcoming events with paid tickets stay ahead of other recommendations", () => {
  const ranked = rankEventRecommendations({
    profile,
    userCoordinates: [3.35, 6.6],
    radiusKm: 500,
    now,
    events: [
      {
        _id: "popular-match",
        title: "Nearby event matching interests",
        activityType: "music",
        setting: "indoor",
        state: "Lagos",
        lga: "Ikeja",
        tags: ["music"],
        startsAt: "2026-07-18T10:00:00.000Z",
        coordinates: { type: "Point", coordinates: [3.351, 6.601] },
      },
      {
        _id: "ticketed",
        title: "Ticketed upcoming event",
        activityType: "arts",
        setting: "outdoor",
        state: "Oyo",
        lga: "Ibadan",
        tags: [],
        startsAt: "2026-07-19T10:00:00.000Z",
        coordinates: { type: "Point", coordinates: [4.0, 7.4] },
      },
    ],
  });

  const prioritized = prioritizeTicketedRecommendations(ranked, new Set(["ticketed"]), 2);

  assert.equal(prioritized[0]?.event._id, "ticketed");
  assert.equal(prioritized[1]?.event._id, "popular-match");
});
