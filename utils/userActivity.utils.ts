import { NotificationModel } from "../models/Notification/Notification.model";
import { logger } from "./logger.utils";

export type UserActivityCategory =
  | "account"
  | "communities"
  | "events"
  | "friends"
  | "roommates"
  | "chat"
  | "tickets"
  | "wallet"
  | "support";

/** Stores a private, in-app record without sending push or email. */
export const recordUserActivity = async (input: {
  userId: string;
  category: UserActivityCategory;
  title: string;
  body: string;
}): Promise<void> => {
  try {
    await NotificationModel.create({
      userId: input.userId,
      type: `activity_${input.category}`,
      title: input.title,
      body: input.body,
      data: { category: input.category },
    });
  } catch (error) {
    // Recording activity must never roll back a successful user action.
    logger.warn(
      { error, userId: input.userId, category: input.category },
      "User activity recording failed",
    );
  }
};
