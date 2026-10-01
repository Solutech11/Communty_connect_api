import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import "./test-env";

// This suite uses an isolated database and requires a local Mongo replica set
// plus Redis. It never connects to the application database or real providers.
test("roommate lifecycle with real transactions: concurrent acceptance, privacy and revocation", {
  skip: process.env.RUN_ROOMMATE_INTEGRATION !== "true",
}, async () => {
  const mongoUri = "mongodb://127.0.0.1:27017/community_connect_roommate_test";
  const { redisClient } = await import("../DB/redis.js");
  const { UserModel } = await import("../models/Auth/User.model.js");
  const { RoommateProfileModel } = await import("../models/Roommate/RoommateProfile.model.js");
  const { RoommateConnectionModel } = await import("../models/Roommate/RoommateConnection.model.js");
  const { RoommateDecisionModel } = await import("../models/Roommate/RoommateDecision.model.js");
  const { RoommateRequestModel } = await import("../models/Roommate/RoommateRequest.model.js");
  const { ConversationModel } = await import("../models/Chat/Conversation.model.js");
  const { UserBlockModel } = await import("../models/Social/UserBlock.model.js");
  const { roommateExampleAnswers } = await import("../docs/roommate-contracts.js");
  const controller = await import("../Controller/roommate.controller.js");
  const { blockUser } = await import("../Controller/userBlock.controller.js");
  const { AppError } = await import("../utils/AppError.js");
  const call = async (operation: (req: Request, res: Response) => Promise<Response>, id: string,
    params: Record<string, string> = {}, body: Record<string, unknown> = {}, query: Record<string, string> = {}) => {
    let value: unknown;
    const request = { auth: { id }, params, body, query, app: { get: () => undefined } } as unknown as Request;
    const response = { status() { return this; }, setHeader() {}, json(result: unknown) { value = result; return this; } } as unknown as Response;
    await operation(request, response);
    return value as { data: Record<string, unknown> };
  };
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 3000 });
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    assert.ok(hello.setName, "Roommate integration requires a Mongo replica set");
    await redisClient.connect();
    await Promise.all([UserModel, RoommateProfileModel, RoommateConnectionModel, RoommateDecisionModel,
      RoommateRequestModel, ConversationModel, UserBlockModel].map((model) => model.init()));
    const users = await UserModel.create(["a", "b", "c"].map((suffix) => ({
      firstName: "Test", lastName: suffix, email: `roommate-${Date.now()}-${suffix}@example.com`,
      passwordHash: "fixture-only", status: "active" as const, emailVerifiedAt: new Date(), phone: "+2348011111111",
      interests: ["reading"], hobbies: ["walking"],
    })));
    const [a, b, c] = users.map((user) => user._id.toString()) as [string, string, string];
    const future = new Date(); future.setUTCFullYear(future.getUTCFullYear() + 1);
    const from = future.toISOString().slice(0, 10); future.setUTCMonth(future.getUTCMonth() + 2);
    const answers = { ...roommateExampleAnswers, moveInFrom: from, moveInTo: future.toISOString().slice(0, 10) };
    for (const id of [a, b, c]) {
      await call(controller.saveRoommateProfile, id, {}, answers);
      await call(controller.setRoommateVisibility, id, {}, { visibility: "discoverable" });
    }
    const discover = await call(controller.listRoommateCandidates, a, {}, {}, { page: "1", limit: "20" });
    assert.equal((discover.data.candidates as unknown[]).length, 2);
    for (const peer of [b, c]) {
      await call(controller.decideRoommate, a, { userId: peer }, { action: "like" });
      await call(controller.decideRoommate, peer, { userId: a }, { action: "like" });
    }
    const connections = await RoommateConnectionModel.find({ participantIds: a });
    assert.equal(connections.length, 2);
    const ab = connections.find((item) => item.participantIds.some((id) => id.toString() === b))!;
    const ac = connections.find((item) => item.participantIds.some((id) => id.toString() === c))!;
    await call(controller.decideRoommate, b, { userId: a }, { action: "like" });
    assert.equal(await RoommateConnectionModel.countDocuments({ participantIds: a }), 2);
    const abParams = { id: ab._id.toString() };
    await assert.rejects(call(controller.getRoommateContacts, a, abParams), (err: unknown) => err instanceof AppError && err.code === "CONTACT_CONSENT_REQUIRED");
    await call(controller.saveRoommateConsent, a, abParams, { fields: ["email"] });
    await call(controller.saveRoommateConsent, b, abParams, { fields: ["phone"] });
    assert.deepEqual((await call(controller.getRoommateContacts, a, abParams)).data.contacts, { phone: "+2348011111111" });
    await call(controller.requestRoommatePairing, a, abParams);
    await call(controller.requestRoommatePairing, a, { id: ac._id.toString() });
    const requests = await RoommateRequestModel.find({ requesterId: a, status: "pending" });
    const reqB = requests.find((item) => item.recipientId.toString() === b)!;
    const reqC = requests.find((item) => item.recipientId.toString() === c)!;
    const outcomes = await Promise.allSettled([
      call(controller.respondRoommatePairing, b, { ...abParams, requestId: reqB._id.toString() }, { action: "accept" }),
      call(controller.respondRoommatePairing, c, { id: ac._id.toString(), requestId: reqC._id.toString() }, { action: "accept" }),
    ]);
    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(await RoommateProfileModel.countDocuments({ visibility: "paired" }), 2);
    assert.equal(await RoommateConnectionModel.countDocuments({ status: "paired" }), 1);
    const paired = await RoommateConnectionModel.findOne({ status: "paired" });
    const selected = paired!.participantIds.find((id) => id.toString() !== a)!.toString();
    const observer = selected === b ? c : b;
    const visible = await call(controller.listRoommateCandidates, observer, {}, {}, { page: "1", limit: "20" });
    assert.equal((visible.data.candidates as unknown[]).length, 0);
    await call(blockUser, a, { userId: selected });
    assert.equal(await RoommateProfileModel.countDocuments({ visibility: "paired" }), 0);
    assert.equal(await RoommateProfileModel.countDocuments({ visibility: "paused" }), 2);
    await assert.rejects(call(controller.getRoommateContacts, a, { id: paired!._id.toString() }), (err: unknown) => err instanceof AppError && err.statusCode === 403);
  } finally {
    if (mongoose.connection.readyState === 1) {
      assert.equal(mongoose.connection.name, "community_connect_roommate_test");
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
    if (redisClient.isOpen) await redisClient.quit();
  }
});
