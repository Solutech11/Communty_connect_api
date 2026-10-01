import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { FriendshipModel } from "../models/Social/Friendship.model";
import { UserModel } from "../models/Auth/User.model";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/response.utils";
import { createAppAndEmailNotification } from "../utils/notificationService.utils";
import { blockedUserIds, requireUnblocked, withUserLocks } from "../utils/userBlock.utils";

const pairKeyFor = (left: string, right: string): string => [left, right].sort().join(":");
const profileFields = "firstName lastName avatarUrl state lga interests";

interface PopulatedProfile {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  state?: string;
  lga?: string;
  interests?: string[];
}

interface PopulatedFriendship {
  _id: Types.ObjectId;
  requesterId: PopulatedProfile;
  addresseeId: PopulatedProfile;
  pairKey: string;
  status: string;
  respondedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const friendshipDto = (record: PopulatedFriendship) => ({
  _id: record._id.toString(),
  requesterId: record.requesterId._id.toString(),
  addresseeId: record.addresseeId._id.toString(),
  requester: record.requesterId,
  addressee: record.addresseeId,
  status: record.status,
  respondedAt: record.respondedAt,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const populateFriendship = async (id: Types.ObjectId) => {
  const record = await FriendshipModel.findById(id)
    .populate("requesterId", profileFields)
    .populate("addresseeId", profileFields);

  if (!record) {
    throw new AppError(404, "Friendship was not found", "FRIENDSHIP_NOT_FOUND");
  }

  return friendshipDto(record.toObject() as unknown as PopulatedFriendship);
};

export const listFriends = async (request: Request, response: Response): Promise<Response> => {
  const excluded = await blockedUserIds(request.auth!.id);
  const records = await FriendshipModel.find({
    status: "accepted",
    requesterId: { $nin: excluded }, addresseeId: { $nin: excluded },
    $or: [{ requesterId: request.auth?.id }, { addresseeId: request.auth?.id }],
  })
    .populate("requesterId", profileFields)
    .populate("addresseeId", profileFields)
    .sort({ updatedAt: -1 });
  return sendSuccess(response, 200, "Friends retrieved", {
    friendships: records.map((record) =>
      friendshipDto(record.toObject() as unknown as PopulatedFriendship)),
  });
};

export const listFriendRequests = async (request: Request, response: Response): Promise<Response> => {
  const excluded = await blockedUserIds(request.auth!.id);
  const records = await FriendshipModel.find({
    requesterId: { $nin: excluded },
    addresseeId: request.auth?.id,
    status: "pending",
  })
    .populate("requesterId", profileFields)
    .populate("addresseeId", profileFields)
    .sort({ createdAt: -1 });
  return sendSuccess(response, 200, "Friend requests retrieved", {
    requests: records.map((record) =>
      friendshipDto(record.toObject() as unknown as PopulatedFriendship)),
  });
};

export const suggestions = async (request: Request, response: Response): Promise<Response> => {
  const links = await FriendshipModel.find({
    $or: [{ requesterId: request.auth?.id }, { addresseeId: request.auth?.id }],
  }).lean();
  const excluded = new Set<string>([request.auth?.id as string]);
  for (const id of await blockedUserIds(request.auth!.id)) excluded.add(id);

  for (const link of links) {
    excluded.add(link.requesterId.toString());
    excluded.add(link.addresseeId.toString());
  }

  const users = await UserModel.find({
    _id: { $nin: [...excluded] },
    status: "active",
  })
    .select("firstName lastName avatarUrl state lga interests")
    .limit(20);
  return sendSuccess(response, 200, "Friend suggestions retrieved", { users });
};

export const sendFriendRequest = async (request: Request, response: Response): Promise<Response> => {
  const targetId = request.params.userId as string;

  if (targetId === request.auth?.id) {
    throw new AppError(400, "You cannot send a friend request to yourself", "INVALID_FRIEND_REQUEST");
  }

  if (!(await UserModel.exists({ _id: targetId, status: "active" }))) {
    throw new AppError(404, "User was not found", "USER_NOT_FOUND");
  }

  const friendship = await withUserLocks([request.auth!.id, targetId], async () => {
    await requireUnblocked(request.auth!.id, targetId);
    const pairKey = pairKeyFor(request.auth!.id, targetId);
    const existing = await FriendshipModel.findOne({ pairKey });
    if (existing && ["pending", "accepted"].includes(existing.status)) return existing;
    if (existing?.status === "blocked") throw new AppError(403, "This connection is unavailable", "CONNECTION_UNAVAILABLE");
    return FriendshipModel.findOneAndUpdate({ pairKey }, {
      $set: { requesterId: request.auth!.id, addresseeId: targetId, status: "pending" },
      $unset: { respondedAt: 1 }, $setOnInsert: { pairKey },
    }, { upsert: true, new: true });
  });
  if (friendship!.status === "pending" && friendship!.requesterId.toString() === request.auth!.id) void createAppAndEmailNotification({
    userId: friendship!.addresseeId.toString(),
    type: "connection_request",
    title: "New connection request",
    body: "Someone in your community would like to connect.",
    data: { friendshipId: friendship!._id.toString(), route: "Friends" },
    dedupeKey: `friend-request:${friendship!._id.toString()}:${friendship!.updatedAt.getTime()}`,
  });
  return sendSuccess(response, 201, "Friend request sent", {
    friendship: await populateFriendship(friendship!._id),
  });
};

export const respondToFriendRequest = async (
  request: Request,
  response: Response,
): Promise<Response> => {
  const status = request.body.action === "accept" ? "accepted" : "declined";
  const pending = await FriendshipModel.findOne({ _id: request.params.id, addresseeId: request.auth!.id }).lean();
  const friendship = pending ? await withUserLocks([request.auth!.id, pending.requesterId.toString()], async () => {
    await requireUnblocked(request.auth!.id, pending.requesterId.toString());
    return FriendshipModel.findOneAndUpdate(
      { _id: request.params.id as string, addresseeId: request.auth!.id, status: "pending" },
      { status, respondedAt: new Date() }, { new: true },
    );
  }) : null;

  if (!friendship) {
    throw new AppError(404, "Pending friend request was not found", "FRIEND_REQUEST_NOT_FOUND");
  }

  if (status === "accepted") {
    void createAppAndEmailNotification({
      userId: friendship.requesterId.toString(),
      type: "connection_accepted",
      title: "Connection request accepted",
      body: "You have a new Community Connect friend.",
      data: { friendshipId: friendship._id.toString(), route: "Friends" },
      dedupeKey: `friend-accepted:${friendship._id.toString()}`,
    });
  } else {
    void createAppAndEmailNotification({
      userId: friendship.requesterId.toString(),
      type: "connection_declined",
      title: "Connection request declined",
      body: "Your connection request was declined.",
      data: { route: "Friends" },
      dedupeKey: `friend-declined:${friendship._id.toString()}`,
    });
  }

  return sendSuccess(response, 200, `Friend request ${status}`, {
    friendship: await populateFriendship(friendship._id),
  });
};

export const removeFriend = async (request: Request, response: Response): Promise<Response> => {
  const result = await FriendshipModel.deleteOne({
    _id: request.params.id as string,
    $or: [{ requesterId: request.auth?.id }, { addresseeId: request.auth?.id }],
  });

  if (result.deletedCount === 0) {
    throw new AppError(404, "Friendship was not found", "FRIENDSHIP_NOT_FOUND");
  }

  return sendSuccess(response, 200, "Friend removed");
};
