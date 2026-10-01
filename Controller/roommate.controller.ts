import type { Request, Response } from "express";
import mongoose from "mongoose";
import { UserModel } from "../models/Auth/User.model";
import { FriendshipModel } from "../models/Social/Friendship.model";
import { RoommateProfileModel } from "../models/Roommate/RoommateProfile.model";
import { RoommateDecisionModel } from "../models/Roommate/RoommateDecision.model";
import { RoommateConnectionModel } from "../models/Roommate/RoommateConnection.model";
import { RoommateRequestModel } from "../models/Roommate/RoommateRequest.model";
import { completeRoommateProfileSchema, roommateOptions } from "../schemas/roommate.schemas";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/response.utils";
import { roommateScore, roommatesCompatible } from "../utils/roommateMatching.utils";
import { blockedUserIds, pairKeyFor, requireUnblocked, withUserLocks } from "../utils/userBlock.utils";
import { withRedisLock } from "../utils/redisLock.utils";
import { ensureDirectConversation } from "../utils/directConversation.utils";
import { closeRoommateConnection } from "../utils/roommateLifecycle.utils";
import { contactFingerprint, contactExchangeAllowed } from "../utils/roommateContacts.utils";
import { createNotification } from "../utils/notificationService.utils";

const me = (request: Request): string => request.auth!.id;
const changed = (request: Request, ids: string[]): void => {
  request.app.get("io")?.to([...new Set(ids)].map((id) => `user:${id}`)).emit("roommates:changed", {});
};
const profileFields = Object.keys(completeRoommateProfileSchema.shape);
const publicUserFields = "firstName lastName avatarUrl bio interests hobbies";
const profileDto = (profile: Record<string, unknown>) => ({
  _id: String(profile._id), userId: String(profile.userId),
  visibility: profile.visibility, questionnaireVersion: profile.questionnaireVersion,
  activeConnectionId: profile.activeConnectionId ? String(profile.activeConnectionId) : null,
  ...Object.fromEntries(profileFields.filter((key) => profile[key] !== undefined).map((key) => [key, profile[key]])),
});
const requireComplete = (profile: unknown) => {
  const candidate = profile as Record<string, unknown>;
  const answers = Object.fromEntries(profileFields.map((key) => [key, candidate[key]]));
  const result = completeRoommateProfileSchema.safeParse(answers);
  if (!result.success || result.data.moveInTo < new Date().toISOString().slice(0, 10)) {
    throw new AppError(422, "Complete your roommate questions and choose a current move-in window", "ROOMMATE_PROFILE_INCOMPLETE");
  }
  return result.data;
};

const requireConnection = async (id: string, userId: string) => {
  const connection = await RoommateConnectionModel.findOne({ _id: id, participantIds: userId });
  if (!connection) throw new AppError(404, "Connect was not found", "ROOMMATE_CONNECTION_NOT_FOUND");
  const otherId = connection.participantIds.find((id) => id.toString() !== userId)!.toString();
  await requireUnblocked(userId, otherId);
  if (!(await UserModel.exists({ _id: otherId, status: "active" }))) {
    throw new AppError(404, "Connect is unavailable", "ROOMMATE_CONNECTION_NOT_FOUND");
  }
  return { connection, otherId };
};

const requireUsable = async (id: string, userId: string) => {
  const result = await requireConnection(id, userId);
  if (result.connection.status === "closed") {
    throw new AppError(409, "This connect has ended", "ROOMMATE_CONNECTION_CLOSED");
  }
  return result;
};

const connectionDto = async (id: string, userId: string) => {
  const { connection, otherId } = await requireConnection(id, userId);
  const [other, profile, friendship, pairingRequest] = await Promise.all([
    UserModel.findById(otherId).select(publicUserFields).lean(),
    RoommateProfileModel.findOne({ userId: otherId }).lean(),
    FriendshipModel.findOne({ pairKey: pairKeyFor(userId, otherId) }).lean(),
    RoommateRequestModel.findOne({ connectionId: id }).sort({ createdAt: -1, _id: -1 }).lean(),
  ]);
  const visible = profile && connection.status !== "closed"
    && (profile.visibility !== "paired" || profile.activeConnectionId?.toString() === id);
  const mine = connection.consents.find((consent) => consent.userId.toString() === userId);
  return {
    _id: id, status: connection.status, user: other,
    profile: visible ? profileDto(profile as unknown as Record<string, unknown>) : null,
    conversationId: connection.conversationId?.toString() || null,
    friendship: friendship ? { _id: friendship._id.toString(), status: friendship.status,
      requesterId: friendship.requesterId.toString(), addresseeId: friendship.addresseeId.toString() } : null,
    pairingRequest: pairingRequest ? { _id: pairingRequest._id.toString(), status: pairingRequest.status,
      requesterId: pairingRequest.requesterId.toString(), recipientId: pairingRequest.recipientId.toString() } : null,
    myContactFields: mine?.fields || [],
    otherHasConsented: connection.consents.some((consent) => consent.userId.toString() === otherId),
    pairedAt: connection.pairedAt || null, updatedAt: connection.updatedAt,
  };
};

export const roommateQuestions = async (_request: Request, response: Response): Promise<Response> =>
  sendSuccess(response, 200, "Roommate questions retrieved", {
    version: 1, options: roommateOptions, currency: "NGN", rentPeriod: "year",
    eligibility: "Self-declared age 18 or older",
  });

export const getRoommateProfile = async (request: Request, response: Response): Promise<Response> => {
  const profile = await RoommateProfileModel.findOne({ userId: me(request) }).lean();
  return sendSuccess(response, 200, "Roommate profile retrieved", {
    profile: profile ? profileDto(profile as unknown as Record<string, unknown>) : null,
  });
};

export const saveRoommateProfile = async (request: Request, response: Response): Promise<Response> => {
  const userId = me(request);
  const profile = await withUserLocks([userId], async () => {
    const current = await RoommateProfileModel.findOne({ userId });
    if (current?.visibility === "paired") throw new AppError(409, "End your pairing before changing your housing preferences", "ROOMMATE_ALREADY_PAIRED");
    if (current?.visibility === "discoverable") requireComplete(request.body);
    const omitted = Object.fromEntries(profileFields.filter((key) => request.body[key] === undefined).map((key) => [key, 1]));
    return RoommateProfileModel.findOneAndUpdate({ userId }, {
      $set: request.body, $unset: omitted, $inc: { revision: 1 }, $setOnInsert: { userId, visibility: "draft" },
    }, { upsert: true, new: true, runValidators: true });
  });
  return sendSuccess(response, 200, "Roommate profile saved", {
    profile: profileDto(profile!.toObject() as unknown as Record<string, unknown>),
  });
};

export const setRoommateVisibility = async (request: Request, response: Response): Promise<Response> => {
  const userId = me(request);
  const profile = await withUserLocks([userId], async () => {
    const record = await RoommateProfileModel.findOne({ userId });
    if (!record) throw new AppError(422, "Set up your roommate profile first", "ROOMMATE_PROFILE_INCOMPLETE");
    if (record.visibility === "paired") throw new AppError(409, "Your roommate profile is private while paired", "ROOMMATE_ALREADY_PAIRED");
    if (request.body.visibility === "discoverable") requireComplete(record.toObject());
    record.visibility = request.body.visibility;
    record.revision += 1;
    await record.save();
    return record;
  });
  return sendSuccess(response, 200, "Roommate visibility updated", {
    profile: profileDto(profile.toObject() as unknown as Record<string, unknown>),
  });
};

export const listRoommateCandidates = async (request: Request, response: Response): Promise<Response> => {
  const userId = me(request);
  const owner = await RoommateProfileModel.findOne({ userId, visibility: "discoverable" }).lean();
  if (!owner) throw new AppError(409, "Activate your roommate profile to discover people", "ROOMMATE_DISCOVERY_PAUSED");
  const answers = requireComplete(owner);
  const [blocks, decisions, connections, user] = await Promise.all([
    blockedUserIds(userId), RoommateDecisionModel.find({ userId }).select("targetId").lean(),
    RoommateConnectionModel.find({ participantIds: userId }).select("participantIds").lean(),
    UserModel.findById(userId).select("interests hobbies").lean(),
  ]);
  const excluded = new Set([userId, ...blocks, ...decisions.map((item) => item.targetId.toString()),
    ...connections.flatMap((item) => item.participantIds.map(String))]);
  const profiles = await RoommateProfileModel.find({
    visibility: "discoverable", userId: { $nin: [...excluded] },
    state: new RegExp(`^${answers.state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
  }).lean();
  const users = await UserModel.find({ _id: { $in: profiles.map((item) => item.userId) }, status: "active" })
    .select(publicUserFields).lean();
  const usersById = new Map(users.map((item) => [item._id.toString(), item]));
  const candidates = profiles.flatMap((profile) => {
    const targetUser = usersById.get(profile.userId.toString());
    const parsed = completeRoommateProfileSchema.safeParse(Object.fromEntries(profileFields.map((key) =>
      [key, (profile as unknown as Record<string, unknown>)[key]])));
    if (!targetUser || !parsed.success || parsed.data.moveInTo < new Date().toISOString().slice(0, 10)
      || !roommatesCompatible(answers, parsed.data)) return [];
    return [{ user: targetUser, profile: profileDto(profile as unknown as Record<string, unknown>),
      ...roommateScore(answers, parsed.data, [...(user?.interests || []), ...(user?.hobbies || [])],
        [...targetUser.interests, ...targetUser.hobbies]) }];
  }).sort((a, b) => b.score - a.score || a.user._id.toString().localeCompare(b.user._id.toString()));
  const page = Number(request.query.page);
  const limit = Number(request.query.limit);
  return sendSuccess(response, 200, "Roommate candidates retrieved", {
    candidates: candidates.slice((page - 1) * limit, page * limit), page, limit, total: candidates.length,
  });
};

export const decideRoommate = async (request: Request, response: Response): Promise<Response> => {
  const userId = me(request);
  const targetId = request.params.userId as string;
  if (userId === targetId) throw new AppError(400, "Choose another person", "INVALID_ROOMMATE_TARGET");
  const pairKey = pairKeyFor(userId, targetId);
  const connectionId = await withUserLocks([userId, targetId], () =>
    withRedisLock(`direct-chat:${pairKey}`, () => mongoose.connection.transaction(async (session) => {
      await requireUnblocked(userId, targetId, session);
      const existing = await RoommateDecisionModel.findOne({ userId, targetId }).session(session);
      if (existing) {
        if (existing.action !== request.body.action) throw new AppError(409, "A decision already exists", "ROOMMATE_DECISION_EXISTS");
        const connection = await RoommateConnectionModel.findOne({ pairKey, status: "active" }).session(session);
        return connection?._id.toString() || null;
      }
      const profiles = await RoommateProfileModel.find({ userId: { $in: [userId, targetId] }, visibility: "discoverable" }).session(session);
      const left = profiles.find((profile) => profile.userId.toString() === userId);
      const right = profiles.find((profile) => profile.userId.toString() === targetId);
      const activeCount = await UserModel.countDocuments({ _id: { $in: [userId, targetId] }, status: "active" }).session(session);
      if (!left || !right || activeCount !== 2 || !roommatesCompatible(requireComplete(left.toObject()), requireComplete(right.toObject()))) {
        throw new AppError(409, "This profile is no longer available for matching", "ROOMMATE_CANDIDATE_UNAVAILABLE");
      }
      await RoommateDecisionModel.create([{ userId, targetId, action: request.body.action }], { session });
      if (request.body.action !== "like" || !(await RoommateDecisionModel.exists({ userId: targetId, targetId: userId, action: "like" }).session(session))) return null;
      // Touch both profiles so acceptance, privacy changes, and deletion conflict
      // with a simultaneous match transaction even if a Redis lease expires.
      await RoommateProfileModel.updateMany({ userId: { $in: [userId, targetId] } }, { $inc: { revision: 1 } }, { session });
      const conversation = await ensureDirectConversation(userId, targetId, session);
      const connection = await RoommateConnectionModel.findOneAndUpdate({ pairKey }, {
        $setOnInsert: { pairKey, participantIds: [userId, targetId], status: "active", conversationId: conversation._id },
      }, { upsert: true, new: true, session });
      return connection!._id.toString();
    })));
  if (connectionId) {
    changed(request, [userId, targetId]);
    for (const id of [userId, targetId]) void createNotification({
      userId: id, type: "roommate_match", title: "New roommate connect",
      body: "You both liked each other. Start a conversation.",
      data: { route: "RoommateConnection", connectionId }, dedupeKey: `roommate-match:${connectionId}:${id}`,
    });
  }
  return sendSuccess(response, 200, "Roommate decision saved", { matched: Boolean(connectionId), connectionId });
};

export const listRoommateConnections = async (request: Request, response: Response): Promise<Response> => {
  const userId = me(request);
  const excluded = await blockedUserIds(userId);
  const filter = { participantIds: { $all: [userId], $nin: excluded }, status: { $in: ["active", "paired"] as Array<"active" | "paired"> } };
  const page = Number(request.query.page);
  const limit = Number(request.query.limit);
  const records = await RoommateConnectionModel.find(filter).sort({ updatedAt: -1, _id: -1 })
    .skip((page - 1) * limit).limit(limit).lean();
  const connections = [];
  for (const record of records) {
    try { connections.push(await connectionDto(record._id.toString(), userId)); }
    catch (error) { if (!(error instanceof AppError && [403, 404].includes(error.statusCode))) throw error; }
  }
  return sendSuccess(response, 200, "Roommate connects retrieved", {
    connections, page, limit, total: await RoommateConnectionModel.countDocuments(filter),
  });
};

export const getRoommateConnection = async (request: Request, response: Response): Promise<Response> =>
  sendSuccess(response, 200, "Roommate connect retrieved", {
    connection: await connectionDto(request.params.id as string, me(request)),
  });

export const endRoommateConnection = async (request: Request, response: Response): Promise<Response> => {
  const { connection, otherId } = await requireConnection(request.params.id as string, me(request));
  await withUserLocks([me(request), otherId], () => mongoose.connection.transaction(async (session) => {
    await closeRoommateConnection(connection._id.toString(), session);
  }));
  changed(request, [me(request), otherId]);
  return sendSuccess(response, 200, "Roommate connect ended", { ended: true });
};

export const saveRoommateConsent = async (request: Request, response: Response): Promise<Response> => {
  const userId = me(request);
  const { otherId } = await requireUsable(request.params.id as string, userId);
  await withUserLocks([userId, otherId], async () => {
    const { connection } = await requireUsable(request.params.id as string, userId);
    const user = await UserModel.findById(userId).select("phone email").lean();
    const fields = request.body.fields as string[];
    if (!user || (fields.includes("phone") && !user.phone)) {
      throw new AppError(422, "Add a phone number to your profile before sharing it", "CONTACT_UNAVAILABLE");
    }
    connection.set("consents", connection.consents.filter((consent) => consent.userId.toString() !== userId));
    connection.consents.push({ userId: new mongoose.Types.ObjectId(userId), fields, contactFingerprint: contactFingerprint(user, fields) });
    await connection.save();
  });
  changed(request, [userId, otherId]);
  return sendSuccess(response, 200, "Contact consent saved", { consented: true });
};

export const revokeRoommateConsent = async (request: Request, response: Response): Promise<Response> => {
  const userId = me(request);
  const { otherId } = await requireConnection(request.params.id as string, userId);
  await withUserLocks([userId, otherId], async () => {
    await RoommateConnectionModel.updateOne({ _id: request.params.id, participantIds: userId }, {
      $pull: { consents: { userId } },
    });
  });
  changed(request, [userId, otherId]);
  return sendSuccess(response, 200, "Contact sharing revoked", { consented: false });
};

export const getRoommateContacts = async (request: Request, response: Response): Promise<Response> => {
  response.setHeader("Cache-Control", "no-store");
  const userId = me(request);
  const { connection, otherId } = await requireUsable(request.params.id as string, userId);
  const users = await UserModel.find({ _id: { $in: connection.participantIds }, status: "active" }).select("phone email").lean();
  const valid = contactExchangeAllowed(users, connection.consents);
  if (!valid) throw new AppError(403, "Both people must consent before contacts are shared", "CONTACT_CONSENT_REQUIRED");
  const other = users.find((user) => user._id.toString() === otherId)!;
  const fields = connection.consents.find((item) => item.userId.toString() === otherId)!.fields;
  return sendSuccess(response, 200, "Shared contacts retrieved", { contacts: {
    ...(fields.includes("phone") ? { phone: other.phone } : {}),
    ...(fields.includes("email") ? { email: other.email } : {}),
  } });
};

export const requestRoommatePairing = async (request: Request, response: Response): Promise<Response> => {
  const userId = me(request);
  const { otherId } = await requireUsable(request.params.id as string, userId);
  const pairingRequest = await withUserLocks([userId, otherId], () => mongoose.connection.transaction(async (session) => {
    await requireUnblocked(userId, otherId, session);
    const connection = await RoommateConnectionModel.findOne({ _id: request.params.id, participantIds: userId, status: "active" }).session(session);
    if (!connection) throw new AppError(409, "This connect is no longer available", "ROOMMATE_CONNECTION_CLOSED");
    const available = await RoommateProfileModel.countDocuments({ userId: { $in: [userId, otherId] }, visibility: { $in: ["paused", "discoverable"] } }).session(session);
    if (available !== 2) throw new AppError(409, "A roommate profile is unavailable", "ROOMMATE_ALREADY_PAIRED");
    const pending = await RoommateRequestModel.findOne({ connectionId: connection._id, status: "pending" }).session(session);
    if (pending) return pending;
    await RoommateProfileModel.updateMany({ userId: { $in: [userId, otherId] } }, { $inc: { revision: 1 } }, { session });
    connection.markModified("status");
    await connection.save({ session });
    const [created] = await RoommateRequestModel.create([{ connectionId: connection._id, requesterId: userId, recipientId: otherId }], { session });
    return created!;
  }));
  void createNotification({ userId: pairingRequest.recipientId.toString(), type: "roommate_request",
    title: "Roommate request", body: "A connect would like to become your roommate.",
    data: { route: "RoommateConnection", connectionId: request.params.id }, dedupeKey: `roommate-request:${pairingRequest._id}` });
  changed(request, [userId, otherId]);
  return sendSuccess(response, 200, "Roommate request saved", { requestId: pairingRequest._id.toString() });
};

export const respondRoommatePairing = async (request: Request, response: Response): Promise<Response> => {
  const userId = me(request);
  const { otherId } = await requireConnection(request.params.id as string, userId);
  const action = request.body.action as "accept" | "decline" | "cancel";
  const status = action === "accept" ? "accepted" : action === "decline" ? "declined" : "cancelled";
  await withUserLocks([userId, otherId], () => mongoose.connection.transaction(async (session) => {
    await requireUnblocked(userId, otherId, session);
    const pairingRequest = await RoommateRequestModel.findOne({ _id: request.params.requestId, connectionId: request.params.id }).session(session);
    if (!pairingRequest) throw new AppError(404, "Roommate request was not found", "ROOMMATE_REQUEST_NOT_FOUND");
    const expectedUser = action === "cancel" ? pairingRequest.requesterId : pairingRequest.recipientId;
    if (expectedUser.toString() !== userId) throw new AppError(403, "This action is unavailable", "FORBIDDEN");
    if (pairingRequest.status === status) return;
    if (pairingRequest.status !== "pending") throw new AppError(409, "This request is no longer pending", "ROOMMATE_REQUEST_CLOSED");
    if (action === "accept") {
      const connection = await RoommateConnectionModel.findOne({ _id: request.params.id, status: "active" }).session(session);
      if (!connection) throw new AppError(409, "This connect has ended", "ROOMMATE_CONNECTION_CLOSED");
      if (await UserModel.countDocuments({ _id: { $in: [userId, otherId] }, status: "active" }).session(session) !== 2) {
        throw new AppError(409, "A participant is unavailable", "ROOMMATE_CONNECTION_CLOSED");
      }
      const result = await RoommateProfileModel.updateMany({ userId: { $in: [userId, otherId] }, visibility: { $in: ["discoverable", "paused"] }, activeConnectionId: { $exists: false } }, {
        $set: { visibility: "paired", activeConnectionId: connection._id }, $inc: { revision: 1 },
      }, { session });
      if (result.modifiedCount !== 2) throw new AppError(409, "Someone has already accepted another roommate", "ROOMMATE_ALREADY_PAIRED");
      connection.status = "paired";
      connection.pairedAt = new Date();
      await connection.save({ session });
      const others = await RoommateConnectionModel.find({ _id: { $ne: connection._id }, participantIds: { $in: [userId, otherId] }, status: "active" }).session(session);
      for (const other of others) await closeRoommateConnection(other._id.toString(), session);
    }
    pairingRequest.status = status;
    pairingRequest.respondedAt = new Date();
    await pairingRequest.save({ session });
  }));
  if (action === "accept") {
    for (const id of [userId, otherId]) void createNotification({ userId: id, type: "roommate_paired",
      title: "Roommate pairing confirmed", body: "Your roommate profile is now private.",
      data: { route: "RoommateConnection", connectionId: request.params.id }, dedupeKey: `roommate-paired:${request.params.requestId}:${id}` });
  }
  if (action === "accept") {
    const affected = await RoommateConnectionModel.find({ participantIds: { $in: [userId, otherId] } }).select("participantIds").lean();
    changed(request, affected.flatMap((item) => item.participantIds.map(String)));
  }
  changed(request, [userId, otherId]);
  return sendSuccess(response, 200, "Roommate request updated", { status });
};
