import bcrypt from "bcrypt";
import type { Request, Response } from "express";
import { env } from "../Config/env";
import { RefreshTokenModel } from "../models/Auth/RefreshToken.model";
import { UserModel } from "../models/Auth/User.model";
import { EventModel } from "../models/Event/Event.model";
import { FriendshipModel } from "../models/Social/Friendship.model";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/response.utils";
import { uploadImage } from "../utils/cloudinary.utils";

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
  const user = await UserModel.findByIdAndUpdate(
    request.auth?.id,
    { $set: request.body },
    { new: true, runValidators: true },
  );

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

  await Promise.all([
    user.save(),
    RefreshTokenModel.updateMany(
      { userId: user._id, revokedAt: { $exists: false } },
      { revokedAt: new Date() },
    ),
  ]);

  return sendSuccess(response, 200, "Account deleted");
};

