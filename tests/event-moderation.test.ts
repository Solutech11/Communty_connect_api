import assert from "node:assert/strict";
import test from "node:test";
import "./test-env";
import {
  isModeratableEventImageUrl,
  markUnreviewableEventImage,
  parseEventModerationResponse,
} from "../Community_AI/Groq";

const approvedChecks = {
  content: { acceptable: true, reasons: [] },
  image: { acceptable: true, reasons: [] },
  pricing: { acceptable: true, reasons: [] },
  communityGuidelines: { acceptable: true, reasons: [] },
};

test("event moderation fails closed when a category conflicts with an approved verdict", () => {
  const result = parseEventModerationResponse({
    verdict: "approved",
    reasons: [],
    checks: {
      ...approvedChecks,
      communityGuidelines: {
        acceptable: false,
        reasons: ["Remove content that violates the Community Connect guidelines."],
      },
    },
  });

  assert.equal(result.verdict, "rejected");
  assert.deepEqual(result.reasons, ["Remove content that violates the Community Connect guidelines."]);
});

test("unreviewable images force an event moderation rejection", () => {
  const result = markUnreviewableEventImage({
    verdict: "approved",
    reasons: [],
    checks: approvedChecks,
    model: "qwen/qwen3.8-27b",
  });

  assert.equal(result.verdict, "rejected");
  assert.equal(result.checks.image.acceptable, false);
  assert.match(result.reasons[0] || "", /uploaded through Community Connect/i);
});

test("only secure Cloudinary cover images are sent to the vision provider", () => {
  assert.equal(
    isModeratableEventImageUrl("https://res.cloudinary.com/community-connect/image/upload/event.webp"),
    true,
  );
  assert.equal(isModeratableEventImageUrl("http://res.cloudinary.com/example/event.webp"), false);
  assert.equal(isModeratableEventImageUrl("https://example.com/event.webp"), false);
});
