import bcrypt from "bcrypt";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { env } from "../Config/env";
import { RefreshTokenModel } from "../models/Auth/RefreshToken.model";
import { UserModel } from "../models/Auth/User.model";
import { EventModel } from "../models/Event/Event.model";
import { FriendshipModel } from "../models/Social/Friendship.model";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/response.utils";
import { uploadImage } from "../utils/cloudinary.utils";
import { withUserLocks } from "../utils/userBlock.utils";
import { RoommateConnectionModel } from "../models/Roommate/RoommateConnection.model";
import { deleteRoommateData } from "../utils/roommateLifecycle.utils";

export const getProfile = async (request: Request, response: Response): Promise<Response> => {
  const userId = request.auth?.id;
  const [user, totalConnections, totalEvents] = await Promise.all([
    UserModel.findById(userId),
    FriendshipModel.countDocuments({
      status: "accepted",
      $or: [{ requesterId: userId }, { addresseeId: userId }],
    }),
    EventModel.countDocuments({ creatorId: userId }),
  ]);

  if (!user) {
    throw new AppError(404, "Profile was not found", "PROFILE_NOT_FOUND");
  }

  return sendSuccess(response, 200, "Profile retrieved", {
    user,
    totals: {
      connections: totalConnections,
      // Includes every event created by the user, regardless of lifecycle status.
      events: totalEvents,
    },
  });
};

export const updateProfile = async (request: Request, response: Response): Promise<Response> => {
  const userId = request.auth!.id;
  const user = await withUserLocks([userId], async () => {
    const previous = await UserModel.findById(userId).select("phone email").lean();
    const changed = ["phone", "email"].filter((field) => request.body[field] !== undefined
      && request.body[field] !== previous?.[field as "phone" | "email"]);
    if (changed.length) {
      // Revoke before changing contacts; read-time fingerprints also prevent
      // an old grant from authorizing a new contact after partial failures.
      await RoommateConnectionModel.updateMany({
        participantIds: userId, consents: { $elemMatch: { userId, fields: { $in: changed } } },
      }, { $pull: { consents: { userId } } });
      const connections = await RoommateConnectionModel.find({ participantIds: userId }).select("participantIds").lean();
      request.app.get("io")?.to([...new Set(connections.flatMap((item) => item.participantIds.map(String)))].map((id) => `user:${id}`))
        .emit("roommates:changed", {});
    }
    return UserModel.findByIdAndUpdate(userId, { $set: request.body }, { new: true, runValidators: true });
  });

  if (!user) {
    throw new AppError(404, "Profile was not found", "PROFILE_NOT_FOUND");
  }

  return sendSuccess(response, 200, "Profile updated", { user });
};

export const updateProfileAvatar = async (
  request: Request,
  response: Response,
): Promise<Response> => {
  if (!request.file) {
    throw new AppError(400, "A profile image file is required", "IMAGE_REQUIRED");
  }

  const user = await UserModel.findById(request.auth?.id);
  if (!user) {
    throw new AppError(404, "Profile was not found", "PROFILE_NOT_FOUND");
  }

  const uploadedImage = await uploadImage(request.file.buffer, "avatars");
  user.avatarUrl = uploadedImage.url;
  await user.save();

  return sendSuccess(response, 200, "Profile photo updated", { user });
};

export const changePassword = async (request: Request, response: Response): Promise<Response> => {
  const user = await UserModel.findById(request.auth?.id).select("+passwordHash");

  if (!user || !(await bcrypt.compare(request.body.currentPassword, user.passwordHash))) {
    throw new AppError(400, "Current password is incorrect", "CURRENT_PASSWORD_INCORRECT");
  }

  if (await bcrypt.compare(request.body.newPassword, user.passwordHash)) {
    throw new AppError(400, "New password must be different", "PASSWORD_UNCHANGED");
  }

  user.passwordHash = await bcrypt.hash(request.body.newPassword, env.BCRYPT_ROUNDS);
  user.tokenVersion += 1;
  await Promise.all([
    user.save(),
    RefreshTokenModel.updateMany(
      { userId: user._id, revokedAt: { $exists: false } },
      { revokedAt: new Date() },
    ),
  ]);

  return sendSuccess(response, 200, "Password changed. Sign in again on your devices.");
};

export const registerPushToken = async (request: Request, response: Response): Promise<Response> => {
  await UserModel.updateOne(
    { _id: request.auth?.id },
    { $addToSet: { expoPushTokens: request.body.token } },
  );

  return sendSuccess(response, 200, "Push token registered");
};

export const removePushToken = async (request: Request, response: Response): Promise<Response> => {
  await UserModel.updateOne(
    { _id: request.auth?.id },
    { $pull: { expoPushTokens: request.body.token } },
  );

  return sendSuccess(response, 200, "Push token removed");
};

export const deleteAccount = async (request: Request, response: Response): Promise<Response> => {
  const user = await UserModel.findById(request.auth?.id).select("+passwordHash");

  if (!user || !(await bcrypt.compare(request.body.password, user.passwordHash))) {
    throw new AppError(400, "Password confirmation is incorrect", "PASSWORD_CONFIRMATION_FAILED");
  }

  const anonymizedEmail = `deleted-${user._id.toString()}@deleted.invalid`;
  user.email = anonymizedEmail;
  user.firstName = "Deleted";
  user.lastName = "User";
  user.phone = undefined;
  user.bio = undefined;
  user.avatarUrl = undefined;
  user.interests = [];
  user.preferredSetting = "indoor";
  user.preferredGroupSize = "medium";
  user.participationRole = "participant";
  user.hobbies = [];
  user.expoPushTokens = [];
  user.status = "deleted";
  user.deletedAt = new Date();
  user.tokenVersion += 1;

  await withUserLocks([user._id.toString()], () => mongoose.connection.transaction(async (session) => {
    await deleteRoommateData(user._id.toString(), session);
    await user.save({ session });
    await RefreshTokenModel.updateMany(
      { userId: user._id, revokedAt: { $exists: false } },
      { revokedAt: new Date() }, { session },
    );
  }));

  request.app.get("io")?.in(`user:${user._id}`).disconnectSockets(true);
  return sendSuccess(response, 200, "Account deleted");
};

