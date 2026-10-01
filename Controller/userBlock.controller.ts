import type { Request, Response } from "express";
import mongoose from "mongoose";
import type { Namespace } from "socket.io";
import { UserBlockModel } from "../models/Social/UserBlock.model";
import { UserModel } from "../models/Auth/User.model";
import { ConversationModel } from "../models/Chat/Conversation.model";
import { RoommateConnectionModel } from "../models/Roommate/RoommateConnection.model";
import { closeRoommateConnection } from "../utils/roommateLifecycle.utils";
import { pairKeyFor, withUserLocks } from "../utils/userBlock.utils";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/response.utils";

export const listUserBlocks = async (request: Request, response: Response): Promise<Response> => {
  const page = Number(request.query.page);
  const limit = Number(request.query.limit);
  const blocks = await UserBlockModel.find({ userId: request.auth!.id })
    .populate("targetId", "firstName lastName avatarUrl").sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit).limit(limit).lean();
  return sendSuccess(response, 200, "Blocked users retrieved", { blocks, page, limit,
    total: await UserBlockModel.countDocuments({ userId: request.auth!.id }) });
};

export const blockUser = async (request: Request, response: Response): Promise<Response> => {
  const userId = request.auth!.id;
  const targetId = request.params.userId as string;
  if (userId === targetId) throw new AppError(400, "You cannot block yourself", "INVALID_BLOCK_TARGET");
  await withUserLocks([userId, targetId], () => mongoose.connection.transaction(async (session) => {
    if (!(await UserModel.exists({ _id: targetId, status: "active" }).session(session))) {
      throw new AppError(404, "User was not found", "USER_NOT_FOUND");
    }
    await UserBlockModel.updateOne({ userId, targetId }, { $setOnInsert: { userId, targetId } }, { upsert: true, session });
    const connection = await RoommateConnectionModel.findOne({ pairKey: pairKeyFor(userId, targetId) }).session(session);
    if (connection) await closeRoommateConnection(connection._id.toString(), session);
  }));
  const conversations = await ConversationModel.find({ type: "direct", participantIds: { $all: [userId, targetId], $size: 2 } }).select("_id").lean();
  const io = request.app.get("io") as Namespace | undefined;
  if (io) {
    for (const conversation of conversations) io.in(`conversation:${conversation._id}`).socketsLeave(`conversation:${conversation._id}`);
    io.to([`user:${userId}`, `user:${targetId}`]).emit("social:access-changed", {});
  }
  return sendSuccess(response, 200, "User blocked", { blocked: true });
};

export const unblockUser = async (request: Request, response: Response): Promise<Response> => {
  await withUserLocks([request.auth!.id, request.params.userId as string], async () => {
    await UserBlockModel.deleteOne({ userId: request.auth!.id, targetId: request.params.userId });
  });
  return sendSuccess(response, 200, "User unblocked", { blocked: false });
};
