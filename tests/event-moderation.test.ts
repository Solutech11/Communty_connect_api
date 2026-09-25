import assert from "node:assert/strict";
import test from "node:test";
import "./test-env";
import {
  createTestingAutoApproval,
  isModeratableEventImageUrl,
  mapTicketTypesForModeration,
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

test("testing auto-approval marks every moderation check approved without Groq", () => {
  const result = createTestingAutoApproval();

  assert.equal(result.verdict, "approved");
  assert.equal(result.model, "testing-auto-approval");
  assert.ok(Object.values(result.checks).every((check) => check.acceptable));
});

test("moderation receives the attendee-facing naira price instead of stored kobo", () => {
  const [ticket] = mapTicketTypesForModeration([{
    title: "General Admission",
    priceKobo: 600_000,
  }]);

  assert.deepEqual(ticket, {
    title: "General Admission",
    priceNaira: 6_000,
    currency: "NGN",
  });
  assert.equal("priceKobo" in ticket, false);
});
