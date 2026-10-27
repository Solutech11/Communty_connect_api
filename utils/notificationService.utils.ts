import { NotificationModel } from "../models/Notification/Notification.model";
import { UserModel } from "../models/Auth/User.model";
import { sendExpoPushNotifications } from "./expoNotification.utils";
import { logger } from "./logger.utils";
import { sendEmail } from "./mailer.utils";
import { renderBrandedEmail } from "./emailTemplate.utils";

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

      await sendEmail({
        toEmail: user.email,
        toName: user.firstName,
        subject: input.title,
        html: renderBrandedEmail({
          preheader: input.body.slice(0, 120),
          eyebrow: "COMMUNITY CONNECT UPDATE",
          heading: input.title,
          greetingName: user.firstName,
          intro: input.body,
          closing: "Open the Community Connect app to view this update.",
          footerNote: "This message keeps you up to date about activity in your account.",
        }),
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
