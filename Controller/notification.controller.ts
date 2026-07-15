import type { Request, Response } from "express";
import { NotificationModel } from "../models/Notification/Notification.model";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/response.utils";

export const listNotifications = async (request: Request, response: Response): Promise<Response> => {
  const page = Number(request.query.page || 1);
  const limit = Number(request.query.limit || 20);
  const query: Record<string, unknown> = { userId: request.auth?.id };

  if (request.query.type) {
    query.type = request.query.type;
  }
  if (request.query.unread === "true") {
    query.readAt = { $exists: false };
  }

  const [notifications, total, unread] = await Promise.all([
    NotificationModel.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    NotificationModel.countDocuments(query),
    NotificationModel.countDocuments({ userId: request.auth?.id, readAt: { $exists: false } }),
  ]);
  return sendSuccess(response, 200, "Notifications retrieved", {
    notifications,
    unread,
    pagination: { page, limit, total },
  });
};

export const markNotificationRead = async (request: Request, response: Response): Promise<Response> => {
  const notification = await NotificationModel.findOneAndUpdate(
    { _id: (request.params.id as string), userId: request.auth?.id },
    { readAt: new Date() },
    { new: true },
  );

  if (!notification) {
    throw new AppError(404, "Notification was not found", "NOTIFICATION_NOT_FOUND");
  }

  return sendSuccess(response, 200, "Notification marked as read", { notification });
};

export const markAllNotificationsRead = async (
  request: Request,
  response: Response,
): Promise<Response> => {
  await NotificationModel.updateMany(
    { userId: request.auth?.id, readAt: { $exists: false } },
    { readAt: new Date() },
  );
  return sendSuccess(response, 200, "All notifications marked as read");
};

