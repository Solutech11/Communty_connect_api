import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test, { mock } from "node:test";
import { Types } from "mongoose";
import { io as connectClient, type Socket as ClientSocket } from "socket.io-client";
import type { Server } from "socket.io";
import "./test-env";
import Socket from "../Socket/Socket";
import { UserModel } from "../models/Auth/User.model";
import { ConversationModel } from "../models/Chat/Conversation.model";
import { UserBlockModel } from "../models/Social/UserBlock.model";
import { CommunityModel } from "../models/Community/Community.model";
import { signAccessToken } from "../utils/jwt.utils";
import { emitConversationMessage } from "../utils/chatRealtime.utils";

const senderId = "507f1f77bcf86cd799439011";
const recipientId = "507f1f77bcf86cd799439012";
const outsiderId = "507f1f77bcf86cd799439013";
const conversationId = "507f1f77bcf86cd799439014";

const ready = async (client: ClientSocket): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("Socket ready timeout")), 5_000);
    const onReady = () => finish();
    const onError = (error: Error) => finish(error);
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      client.off("socket:ready", onReady);
      client.off("connect_error", onError);
      if (error) reject(error); else resolve();
    };
    client.once("socket:ready", onReady);
    client.once("connect_error", onError);
    client.connect();
  });
};

const join = async (client: ClientSocket, id: string): Promise<boolean> => {
  return new Promise<boolean>((resolve, reject) => {
    client.timeout(3_000).emit("conversation:join", id, (error: Error | null, joined: boolean) => {
      if (error) reject(error); else resolve(joined);
    });
  });
};

test("authenticated devices receive messages before joining, after joining once, and after reconnect; outsiders receive none", { timeout: 20_000 }, async () => {
  const userMock = mock.method(UserModel, "findById", () => ({
    select: () => ({ lean: async () => ({ status: "active", tokenVersion: 0 }) }),
  }));
  const conversationMock = mock.method(ConversationModel, "findOne", (query: { _id: string; participantIds: string }) => {
    const result = query._id === conversationId && [senderId, recipientId].includes(query.participantIds)
      ? { type: "direct", participantIds: [new Types.ObjectId(senderId), new Types.ObjectId(recipientId)] }
      : null;
    return Object.assign(Promise.resolve(result), { lean: async () => result });
  });
  const blockMock = mock.method(UserBlockModel, "exists", () => ({ session: async () => null }));
  const communityMock = mock.method(CommunityModel, "findById", async () => null);
  const http = createServer();
  const clients: ClientSocket[] = [];
  let server: Server | undefined;
  try {
    http.listen(0, "127.0.0.1");
    await once(http, "listening");
    server = await Socket(http);
    const address = http.address();
    assert.ok(address && typeof address !== "string");
    const url = "http://127.0.0.1:" + address.port + "/chat";
    for (const userId of [senderId, recipientId, outsiderId]) {
      clients.push(connectClient(url, {
        auth: { token: signAccessToken({ userId, email: "fixture@example.com", role: "member", tokenVersion: 0 }) },
        transports: ["websocket"], autoConnect: false, reconnection: false,
      }));
    }
    const [sender, recipient, outsider] = clients;
    assert.ok(sender && recipient && outsider);
    await Promise.all(clients.map(ready));
    const counts = [0, 0, 0];
    clients.forEach((client, index) => client.on("message:new", () => { counts[index] = (counts[index] || 0) + 1; }));
    const deliver = async (id: string) => {
      const received = new Promise<{ _id: string }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          recipient.off("message:new", onMessage);
          reject(new Error("Recipient did not receive the realtime message"));
        }, 5_000);
        const onMessage = (message: { _id: string }) => {
          clearTimeout(timeout);
          resolve(message);
        };
        recipient.once("message:new", onMessage);
      });
      emitConversationMessage(server!.of("/chat"), conversationId, [senderId, recipientId], {
        _id: id, conversationId, senderId, text: "Fixture message", createdAt: new Date().toISOString(),
      });
      assert.equal((await received)._id, id);
      await delay(25);
    };

    // The receiving device is authenticated but its conversation join has not completed.
    await deliver("before-join");
    assert.deepEqual(counts, [1, 1, 0]);
    assert.equal(await join(sender, conversationId), true);
    assert.equal(await join(recipient, conversationId), true);
    assert.equal(await join(outsider, conversationId), false);
    await deliver("after-join");
    assert.deepEqual(counts, [2, 2, 0]);

    recipient.disconnect();
    await ready(recipient);
    await deliver("after-reconnect");
    assert.deepEqual(counts, [3, 3, 0]);
    assert.equal(await join(recipient, conversationId), true);

    const communityAck = await new Promise<{ code: string }>((resolve, reject) => {
      sender.timeout(3_000).emit("community:join", { communityId: conversationId }, (error: Error | null, response: { code: string }) => {
        if (error) reject(error); else resolve(response);
      });
    });
    // A hexadecimal ID containing digits now reaches membership authorization.
    assert.equal(communityAck.code, "COMMUNITY_NOT_FOUND");
  } finally {
    clients.forEach((client) => client.disconnect());
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    else if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
    userMock.mock.restore();
    conversationMock.mock.restore();
    blockMock.mock.restore();
    communityMock.mock.restore();
  }
});
