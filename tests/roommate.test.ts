import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { Request, Response } from "express";
import { Types } from "mongoose";
import "./test-env";
import { completeRoommateProfileSchema, roommateDraftSchema, contactConsentSchema } from "../schemas/roommate.schemas";
import { roommatesCompatible, roommateScore, intervalOverlap } from "../utils/roommateMatching.utils";
import { roommateExampleAnswers } from "../docs/roommate-contracts";
import { contactExchangeAllowed, contactFingerprint } from "../utils/roommateContacts.utils";
import { RoommateProfileModel } from "../models/Roommate/RoommateProfile.model";
import { RoommateConnectionModel } from "../models/Roommate/RoommateConnection.model";
import { RoommateDecisionModel } from "../models/Roommate/RoommateDecision.model";
import { RoommateRequestModel } from "../models/Roommate/RoommateRequest.model";
import { UserBlockModel } from "../models/Social/UserBlock.model";
import { UserModel } from "../models/Auth/User.model";
import { getRoommateContacts, getRoommateConnection } from "../Controller/roommate.controller";
import { AppError } from "../utils/AppError";
import { closeRoommateConnection } from "../utils/roommateLifecycle.utils";
import type { ClientSession } from "mongoose";
import { ConversationModel } from "../models/Chat/Conversation.model";
import { sendMessage } from "../Controller/chat.controller";
import ChatSocket from "../Socket/routes/Chat.Socket";
import type { Socket, Namespace } from "socket.io";

const answers = () => completeRoommateProfileSchema.parse(roommateExampleAnswers);
const leftId = "507f1f77bcf86cd799439011";
const rightId = "507f1f77bcf86cd799439012";

test("activation requires complete answers, adult declaration, valid dates and ordered ranges", () => {
  assert.equal(roommateDraftSchema.safeParse({}).success, true);
  assert.equal(completeRoommateProfileSchema.safeParse({}).success, false);
  for (const patch of [{ adultConfirmed: false }, { moveInFrom: "2027-02-30" },
    { moveInTo: "2026-01-01" }, { maxAnnualRentKobo: 1 }, { unknown: true },
    { acceptableGenders: [] }, { housingMode: "hosting", lgas: ["Ikeja", "Epe"] }]) {
    assert.equal(completeRoommateProfileSchema.safeParse({ ...roommateExampleAnswers, ...patch }).success, false);
  }
});

test("housing mode, area, budget and move-in gates apply symmetrically", () => {
  const left = answers();
  for (const right of [
    { ...left, state: "Abuja" }, { ...left, lgas: ["Epe"] },
    { ...left, minAnnualRentKobo: left.maxAnnualRentKobo + 1, maxAnnualRentKobo: left.maxAnnualRentKobo + 100 },
    { ...left, moveInFrom: "2028-01-01", moveInTo: "2028-03-01" },
  ]) { assert.equal(roommatesCompatible(left, right), false); assert.equal(roommatesCompatible(right, left), false); }
  assert.equal(roommatesCompatible(left, { ...left, state: " lagos ", lgas: ["ikeja"] }), true);
  assert.equal(roommatesCompatible({ ...left, housingMode: "hosting" }, { ...left, housingMode: "hosting" }), false);
  assert.equal(roommatesCompatible(left, { ...left, housingMode: "hosting" }), true);
});

test("gender, smoking and pets require reciprocal compatibility", () => {
  const left = answers();
  assert.equal(roommatesCompatible({ ...left, acceptableGenders: ["woman"] }, { ...left, gender: "man" }), false);
  assert.equal(roommatesCompatible({ ...left, gender: "man" }, { ...left, acceptableGenders: ["woman"] }), false);
  assert.equal(roommatesCompatible(left, { ...left, smokes: true }), false);
  assert.equal(roommatesCompatible({ ...left, hasPets: true }, { ...left, acceptsPets: false }), false);
});

test("scoring is explainable, normalized and handles absent interests", () => {
  const left = answers();
  assert.equal(roommateScore(left, left, ["Reading", "reading"], ["reading"]).score, 100);
  assert.equal(roommateScore(left, left, [], []).score, 70);
  const different = { ...left, cleanliness: "relaxed" as const, sleepSchedule: "late" as const, guests: "often" as const, socialPreference: "quiet" as const };
  const result = roommateScore(left, different, ["reading"], ["gaming"]);
  assert.equal(result.score, 30);
  assert.ok(!result.reasons.includes("Shared interests and hobbies"));
  assert.equal(intervalOverlap(10, 10, 10, 10), 1);
  assert.equal(intervalOverlap(5, 15, 10, 10), 1);
  assert.equal(intervalOverlap(0, 10, 20, 30), 0);
});

test("contact consent requires both people and becomes invalid when selected contacts change", () => {
  const users = [{ _id: leftId, email: "left@example.com", phone: "+2348011111111" }, { _id: rightId, email: "right@example.com", phone: "+2348022222222" }];
  const consents = users.map((user) => ({ userId: user._id, fields: ["email"], contactFingerprint: contactFingerprint(user, ["email"]) }));
  assert.equal(contactExchangeAllowed(users, []), false);
  assert.equal(contactExchangeAllowed(users, consents.slice(0, 1)), false);
  assert.equal(contactExchangeAllowed(users, consents), true);
  assert.equal(contactExchangeAllowed([{ ...users[0]!, email: "new@example.com" }, users[1]!], consents), false);
  assert.equal(contactExchangeAllowed([{ ...users[0]!, phone: "+2348033333333" }, users[1]!], consents), true);
  assert.equal(contactExchangeAllowed(users.slice(0, 1), consents), false);
});

test("new models have unique ownership, pair, decision and pending-request constraints", () => {
  for (const model of [RoommateProfileModel, RoommateConnectionModel, RoommateDecisionModel, RoommateRequestModel, UserBlockModel]) {
    assert.ok(model.schema.indexes().some(([, options]: [unknown, { unique?: boolean }]) => options.unique));
  }
  assert.ok(RoommateRequestModel.schema.indexes().some(([, options]: [unknown, { partialFilterExpression?: { status?: string } }]) => options.partialFilterExpression?.status === "pending"));
  assert.equal(contactConsentSchema.safeParse({ fields: ["phone", "email"] }).success, true);
  assert.equal(contactConsentSchema.safeParse({ fields: [] }).success, false);
});

test("contacts endpoint returns only the other person's selected fields and uses no-store", async () => {
  const users = [{ _id: new Types.ObjectId(leftId), email: "left@example.com", phone: "+2348011111111" },
    { _id: new Types.ObjectId(rightId), email: "right@example.com", phone: "+2348022222222" }];
  const connection = { _id: new Types.ObjectId(), participantIds: users.map((user) => user._id), status: "active",
    consents: users.map((user) => ({ userId: user._id, fields: ["email"], contactFingerprint: contactFingerprint(user, ["email"]) })) };
  const connectionMock = mock.method(RoommateConnectionModel, "findOne", async () => connection);
  const blockMock = mock.method(UserBlockModel, "exists", () => ({ session: async () => null }));
  const userExists = mock.method(UserModel, "exists", async () => true);
  const userFind = mock.method(UserModel, "find", () => ({ select: () => ({ lean: async () => users }) }));
  let body: unknown;
  const headers: Record<string, string> = {};
  const response = { status() { return this; }, setHeader(key: string, value: string) { headers[key] = value; },
    json(value: unknown) { body = value; return this; } } as unknown as Response;
  const request = { auth: { id: leftId }, params: { id: connection._id.toString() } } as unknown as Request;
  try {
    await getRoommateContacts(request, response);
    assert.deepEqual((body as { data: unknown }).data, { contacts: { email: "right@example.com" } });
    assert.equal(headers["Cache-Control"], "no-store");
    connection.consents.pop();
    await assert.rejects(getRoommateContacts(request, response), (err: unknown) => err instanceof AppError && err.code === "CONTACT_CONSENT_REQUIRED");
    connection.status = "closed";
    await assert.rejects(getRoommateContacts(request, response), (err: unknown) => err instanceof AppError && err.code === "ROOMMATE_CONNECTION_CLOSED");
  } finally { connectionMock.mock.restore(); blockMock.mock.restore(); userExists.mock.restore(); userFind.mock.restore(); }
});

test("connection lookup rejects nonparticipants and blocked users", async () => {
  const connectionMock = mock.method(RoommateConnectionModel, "findOne", async () => null);
  const request = { auth: { id: leftId }, params: { id: rightId } } as unknown as Request;
  try {
    await assert.rejects(getRoommateConnection(request, {} as Response), (err: unknown) => err instanceof AppError && err.statusCode === 404);
  } finally { connectionMock.mock.restore(); }
  const blockedConnection = mock.method(RoommateConnectionModel, "findOne", async () => ({ participantIds: [new Types.ObjectId(leftId), new Types.ObjectId(rightId)] }));
  const blockMock = mock.method(UserBlockModel, "exists", () => ({ session: async () => ({ _id: rightId }) }));
  try {
    await assert.rejects(getRoommateConnection(request, {} as Response), (err: unknown) => err instanceof AppError && err.statusCode === 403);
  } finally { blockedConnection.mock.restore(); blockMock.mock.restore(); }
});

test("ending a pairing revokes contacts, pauses both profiles and closes pending requests", async () => {
  const connection = new RoommateConnectionModel({ pairKey: `${leftId}:${rightId}`, participantIds: [leftId, rightId], status: "paired",
    consents: [{ userId: leftId, fields: ["email"], contactFingerprint: "hash" }] });
  const find = mock.method(RoommateConnectionModel, "findById", () => ({ session: async () => connection }));
  const profiles = mock.method(RoommateProfileModel, "updateMany", async () => ({ modifiedCount: 2 }));
  const requests = mock.method(RoommateRequestModel, "updateMany", async () => ({ modifiedCount: 1 }));
  const save = mock.method(connection, "save", async () => connection);
  const session = {} as ClientSession;
  try {
    await closeRoommateConnection(connection._id.toString(), session);
    assert.equal(connection.status, "closed");
    assert.equal(connection.consents.length, 0);
    const update = profiles.mock.calls[0]?.arguments[1] as { $set: { visibility: string }; $unset: { activeConnectionId: number } };
    assert.equal(update.$set.visibility, "paused");
    assert.equal(update.$unset.activeConnectionId, 1);
    assert.equal(requests.mock.callCount(), 1);
  } finally { find.mock.restore(); profiles.mock.restore(); requests.mock.restore(); save.mock.restore(); }
});

test("direct REST messages enforce either-direction blocks before persistence", async () => {
  const find = mock.method(ConversationModel, "findOne", async () => ({
    _id: new Types.ObjectId(), type: "direct", participantIds: [new Types.ObjectId(leftId), new Types.ObjectId(rightId)],
  }));
  const block = mock.method(UserBlockModel, "exists", () => ({ session: async () => ({ _id: leftId }) }));
  try {
    const request = { auth: { id: leftId }, params: { id: rightId }, body: { text: "fixture" } } as unknown as Request;
    await assert.rejects(sendMessage(request, {} as Response), (err: unknown) => err instanceof AppError && err.code === "CONNECTION_UNAVAILABLE");
    assert.equal(block.mock.callCount(), 1);
  } finally { find.mock.restore(); block.mock.restore(); }
});

test("socket joins and already-joined typing fail closed after a block", async () => {
  const conversation = { _id: new Types.ObjectId(rightId), type: "direct",
    participantIds: [new Types.ObjectId(leftId), new Types.ObjectId(rightId)] };
  const find = mock.method(ConversationModel, "findOne", () => ({
    then: (resolve: (value: typeof conversation) => unknown) => Promise.resolve(conversation).then(resolve),
    lean: async () => conversation,
  }));
  const block = mock.method(UserBlockModel, "exists", () => ({ session: async () => ({ _id: leftId }) }));
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const room = `conversation:${rightId}`;
  const rooms = new Set([room]);
  let joined = 0;
  let emitted = 0;
  const socket = {
    id: "fixture-socket",
    conn: { transport: { name: "websocket" } },
    data: { userId: leftId }, rooms,
    on(event: string, handler: (...args: unknown[]) => unknown) { handlers.set(event, handler); },
    async join() { joined += 1; }, async leave(value: string) { rooms.delete(value); },
    to() { return { emit() { emitted += 1; } }; },
  } as unknown as Socket;
  try {
    ChatSocket(socket, {} as Namespace);
    let acknowledgement: { success: boolean } | undefined;
    await handlers.get("join-chat")!({ conversationId: rightId }, (value: { success: boolean }) => { acknowledgement = value; });
    assert.equal(acknowledgement?.success, false);
    assert.equal(joined, 0);
    handlers.get("typing:start")!({ conversationId: rightId });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(emitted, 0);
    assert.equal(rooms.has(room), false);
  } finally { find.mock.restore(); block.mock.restore(); }
});
