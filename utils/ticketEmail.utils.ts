import { UserModel } from "../models/Auth/User.model";
import { env } from "../Config/env";
import { sendEmail } from "./mailer.utils";
import { logger } from "./logger.utils";

const escapeHtml = (value: string): string => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

export const sendTicketCheckInEmail = async (input: {
  userId: string;
  eventTitle: string;
  orderNumber: string;
  checkedInAt: Date;
}): Promise<void> => {
  try {
    const user = await UserModel.findById(input.userId).select("firstName email").lean();
    if (!user) {
      logger.warn(
        { operation: "ticket_checkin_email", userId: input.userId },
        "Ticket check-in email recipient was not found",
      );
      return;
    }

    const eventTitle = escapeHtml(input.eventTitle);
    const orderNumber = escapeHtml(input.orderNumber);
    const checkedInAt = escapeHtml(input.checkedInAt.toLocaleString("en-NG", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Lagos",
    }));
    const firstName = escapeHtml(user.firstName);

    await sendEmail({
      toEmail: user.email,
      toName: user.firstName,
      subject: "Your event check-in is confirmed",
      html: `
        <div style="font-family:Arial,sans-serif;color:#102018;line-height:1.6;max-width:560px;margin:0 auto">
          <h2>${escapeHtml(env.APP_NAME)}</h2>
          <p>Hello ${firstName},</p>
          <h3>Your check-in is confirmed</h3>
          <p>You have been checked in for <strong>${eventTitle}</strong>.</p>
          <p>Ticket order: ${orderNumber}<br>Check-in time: ${checkedInAt}</p>
          <p>Enjoy the event!</p>
        </div>
      `,
    });
  } catch {
    // Email delivery must not undo an already recorded check-in.
    logger.warn(
      { operation: "ticket_checkin_email", userId: input.userId },
      "Ticket check-in email could not be sent",
    );
  }
};
