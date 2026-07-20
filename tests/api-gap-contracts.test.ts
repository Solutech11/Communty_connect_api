import assert from "node:assert/strict";
import test from "node:test";
import { successContracts } from "../docs/openapi-contracts";

const dataFor = (key: string): Record<string, unknown> => {
  const data = successContracts[key]?.example.data;
  assert.ok(data && typeof data === "object", `Missing data example for ${key}`);
  return data as Record<string, unknown>;
};

const first = <T>(items: T[]): T => {
  const item = items[0];
  assert.ok(item);
  return item;
};

test("social and chat contracts expose safe profiles and conversation summaries", () => {
  const friendshipData = dataFor("GET /friends");
  const friendship = first(friendshipData.friendships as Array<Record<string, unknown>>);
  assert.equal(typeof friendship.requesterId, "string");
  assert.equal(typeof friendship.addresseeId, "string");
  assert.equal(typeof friendship.requester, "object");
  assert.equal(typeof friendship.addressee, "object");

  const chatData = dataFor("GET /chat/conversations");
  const conversation = first(chatData.conversations as Array<Record<string, unknown>>);
  assert.ok(Array.isArray(conversation.participantIds));
  assert.ok(Array.isArray(conversation.participants));
  assert.equal(typeof conversation.unreadCount, "number");
  assert.equal(typeof conversation.lastMessagePreview, "object");
});

test("attendee and dispute contracts expose reporting fields needed by the app", () => {
  const attendeeData = dataFor("GET /events/{id}/attendees");
  const attendee = first(attendeeData.attendees as Array<Record<string, unknown>>);
  assert.equal(typeof attendee.checkedIn, "boolean");
  assert.equal(typeof attendee.checkedInAt, "string");
  assert.equal(typeof attendeeData.summary, "object");

  const disputeData = dataFor("GET /disputes/{id}");
  const dispute = disputeData.dispute as Record<string, unknown>;
  const message = first(dispute.messages as Array<Record<string, unknown>>);
  assert.equal(typeof message.authorId, "object");
  assert.equal(typeof message.message, "string");
  assert.ok(Array.isArray(message.attachments));
});

test("event and community contracts expose stored image URLs", () => {
  const eventData = dataFor("GET /events/{id}");
  const event = eventData.event as Record<string, unknown>;
  assert.equal(typeof event.coverImageUrl, "string");

  const communityData = dataFor("GET /communities/{id}");
  const community = communityData.community as Record<string, unknown>;
  assert.equal(typeof community.imageUrl, "string");
});
