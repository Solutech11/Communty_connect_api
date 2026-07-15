import { NotificationModel } from "../models/Notification/Notification.model";
import { UserModel } from "../models/Auth/User.model";
import { sendExpoPushNotifications } from "./expoNotification.utils";
import { logger } from "./logger.utils";

export const createNotification = async (input: {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  dedupeKey?: string;
}): Promise<void> => {
  try {
    let notification;

    if (input.dedupeKey) {
      notification = await NotificationModel.findOneAndUpdate(
        { userId: input.userId, dedupeKey: input.dedupeKey },
        {
          $setOnInsert: {
            userId: input.userId,
            type: input.type,
            title: input.title,
            body: input.body,
            data: input.data || {},
            dedupeKey: input.dedupeKey,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );

      if (notification.pushTicketIds.length > 0) {
        return;
      }
    } else {
      notification = await NotificationModel.create({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data || {},
      });
    }

    const user = await UserModel.findById(input.userId).select("+expoPushTokens").lean();
    const ticketIds = await sendExpoPushNotifications({
      tokens: user?.expoPushTokens || [],
      title: input.title,
      body: input.body,
      data: input.data,
    });

    if (ticketIds.length > 0) {
      notification.pushTicketIds = ticketIds;
      await notification.save();
    }
  } catch (error) {
    // Notification delivery never rolls back the originating domain operation.
    logger.warn({ error, userId: input.userId, type: input.type }, "Notification creation failed");
  }
};
