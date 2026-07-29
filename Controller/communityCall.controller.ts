import { sign } from "jsonwebtoken";
import type { Request, Response } from "express";
import { env } from "../Config/env";
import { CommunityCallModel } from "../models/Community/CommunityCall.model";
import { CommunityCallParticipantModel } from "../models/Community/CommunityCallParticipant.model";
import { requireActiveCommunityMember, requireCommunityModerator } from "../utils/communityAccess.utils";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/response.utils";

const toCall = (call: {
  _id: { toString(): string };
  communityId: { toString(): string };
  type: "voice" | "video";
  status: "active" | "ended";
  startedBy: { toString(): string };
  participantCount: number;
  createdAt: Date;
  endedAt?: Date | null;
}) => ({
  _id: call._id.toString(),
  communityId: call.communityId.toString(),
  type: call.type,
  status: call.status,
  startedBy: call.startedBy.toString(),
  participantCount: call.participantCount,
  startedAt: call.createdAt,
  endedAt: call.endedAt || null,
});

const emit = (request: Request, event: string, payload: unknown): void => {
  request.app.get("io")?.to("community:" + (request.params.id as string)).emit(event, payload);
};

const requireActiveCall = async (communityId: string, callId: string) => {
  const call = await CommunityCallModel.findOne({ _id: callId, communityId });
  if (!call) throw new AppError(404, "Community call was not found", "COMMUNITY_CALL_NOT_FOUND");
  if (call.status !== "active") throw new AppError(409, "Community call has ended", "COMMUNITY_CALL_ENDED");
  return call;
};

export const createCommunityCall = async (request: Request, response: Response): Promise<Response> => {
  const { community } = await requireCommunityModerator(request.params.id as string, request.auth?.id as string);
  const existing = await CommunityCallModel.findOne({ communityId: community._id, status: "active" });
  if (existing) throw new AppError(409, "A community call is already active", "COMMUNITY_CALL_ACTIVE");
  let call;
  try {
    call = await CommunityCallModel.create({
      communityId: community._id,
      type: request.body.type,
      title: request.body.title,
      startedBy: request.auth?.id,
      participantCount: 0,
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      throw new AppError(409, "A community call is already active", "COMMUNITY_CALL_ACTIVE");
    }
    throw error;
  }
  const payload = toCall(call);
  emit(request, "community:call:started", payload);
  return sendSuccess(response, 201, "Community call started", { call: payload });
};

export const getActiveCommunityCall = async (request: Request, response: Response): Promise<Response> => {
  await requireActiveCommunityMember(request.params.id as string, request.auth?.id as string);
  const call = await CommunityCallModel.findOne({ communityId: request.params.id as string, status: "active" });
  return sendSuccess(response, 200, "Active community call retrieved", { call: call ? toCall(call) : null });
};

export const joinCommunityCall = async (request: Request, response: Response): Promise<Response> => {
  await requireActiveCommunityMember(request.params.id as string, request.auth?.id as string);
  const call = await requireActiveCall(request.params.id as string, request.params.callId as string);
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    throw new AppError(503, "Community calling is not configured", "COMMUNITY_CALL_PROVIDER_UNAVAILABLE");
  }
  try {
    await CommunityCallParticipantModel.create({ callId: call._id, userId: request.auth?.id });
    await CommunityCallModel.updateOne({ _id: call._id, status: "active" }, { $inc: { participantCount: 1 } });
    call.participantCount += 1;
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === 11000)) throw error;
  }
  const expiresAt = new Date(Date.now() + env.CALL_TOKEN_TTL_SECONDS * 1000);
  const roomName = "community-" + call.communityId.toString() + "-" + call._id.toString();
  const participantToken = sign(
    { video: { roomJoin: true, room: roomName, canPublish: true, canSubscribe: true } },
    env.LIVEKIT_API_SECRET,
    {
      algorithm: "HS256",
      issuer: env.LIVEKIT_API_KEY,
      subject: request.auth?.id,
      expiresIn: env.CALL_TOKEN_TTL_SECONDS,
    },
  );
  const payload = toCall(call);
  emit(request, "community:call:updated", payload);
  return sendSuccess(response, 200, "Community call credentials created", {
    call: payload,
    provider: "livekit",
    roomName,
    participantToken,
    expiresAt: expiresAt.toISOString(),
  });
};

export const endCommunityCall = async (request: Request, response: Response): Promise<Response> => {
  const { membership } = await requireActiveCommunityMember(request.params.id as string, request.auth?.id as string);
  const call = await requireActiveCall(request.params.id as string, request.params.callId as string);
  const isModerator = membership.role === "owner" || membership.role === "moderator";
  if (!isModerator && call.startedBy.toString() !== request.auth?.id) {
    throw new AppError(403, "Only the call starter or a community moderator can end this call", "COMMUNITY_MODERATOR_REQUIRED");
  }
  call.status = "ended";
  call.endedAt = new Date();
  await call.save();
  const payload = toCall(call);
  emit(request, "community:call:ended", payload);
  return sendSuccess(response, 200, "Community call ended", { call: payload });
};
