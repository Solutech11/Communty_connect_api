import { NotificationModel } from "../models/Notification/Notification.model";
import { UserModel } from "../models/Auth/User.model";
import { sendExpoPushNotifications } from "./expoNotification.utils";
import { logger } from "./logger.utils";
import { sendEmail } from "./mailer.utils";
import { env } from "../Config/env";

const escapeHtml = (value: string): string => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#039;");

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

/** Creates an in-app/push notification and sends one deduplicated email copy. */
export const createAppAndEmailNotification = async (input: Parameters<typeof createNotification>[0] & {
  dedupeKey: string;
}): Promise<void> => {
  try {
    await createNotification(input);

    const staleClaim = new Date(Date.now() - 5 * 60 * 1000);
    const notification = await NotificationModel.findOneAndUpdate(
      {
        userId: input.userId,
        dedupeKey: input.dedupeKey,
        $or: [
          { "emailDelivery.status": { $exists: false } },
          { "emailDelivery.status": "failed" },
          {
            "emailDelivery.status": "sending",
            "emailDelivery.claimedAt": { $lt: staleClaim },
          },
        ],
      },
      { $set: { "emailDelivery.status": "sending", "emailDelivery.claimedAt": new Date() } },
      { new: true },
    );

    if (!notification) return;

    try {
      const user = await UserModel.findById(input.userId).select("firstName email emailVerifiedAt").lean();
      if (!user?.emailVerifiedAt) {
        await NotificationModel.updateOne({ _id: notification._id }, {
          $set: { "emailDelivery.status": "skipped" },
        });
        return;
      }

      const title = escapeHtml(input.title);
      const body = escapeHtml(input.body);
      const name = escapeHtml(user.firstName);
      await sendEmail({
        toEmail: user.email,
        toName: user.firstName,
        subject: input.title,
        html: `<div style="font-family:Arial,sans-serif;color:#102018;line-height:1.6"><h2>${escapeHtml(env.APP_NAME)}</h2><p>Hello ${name},</p><h3>${title}</h3><p>${body}</p><p>Open the Community Connect app to view this update.</p></div>`,
      });
      await NotificationModel.updateOne({ _id: notification._id }, {
        $set: { "emailDelivery.status": "sent", "emailDelivery.sentAt": new Date() },
      });
    } catch {
      await NotificationModel.updateOne({ _id: notification._id }, {
        $set: { "emailDelivery.status": "failed" },
      });
      logger.warn({ operation: "notification_email", userId: input.userId, type: input.type }, "Notification email delivery failed");
    }
  } catch {
    logger.warn({ operation: "app_email_notification", userId: input.userId, type: input.type }, "Combined notification delivery failed");
  }
};
