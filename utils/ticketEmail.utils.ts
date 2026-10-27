import { UserModel } from "../models/Auth/User.model";
import { sendEmail } from "./mailer.utils";
import { logger } from "./logger.utils";
import { renderBrandedEmail, renderEmailDetails, renderEmailHighlight } from "./emailTemplate.utils";

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

    const checkedInAt = input.checkedInAt.toLocaleString("en-NG", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Lagos",
    });

    await sendEmail({
      toEmail: user.email,
      toName: user.firstName,
      subject: "Your event check-in is confirmed",
      html: renderBrandedEmail({
        preheader: `Check-in confirmed for ${input.eventTitle}.`,
        eyebrow: "EVENT CHECK-IN",
        heading: "You're checked in",
        greetingName: user.firstName,
        intro: "Your arrival has been recorded. Enjoy the event!",
        contentHtml: `${renderEmailHighlight("Event", input.eventTitle)}${renderEmailDetails([
          { label: "Ticket order", value: input.orderNumber },
          { label: "Check-in time", value: checkedInAt },
        ])}`,
        footerNote: "Keep this confirmation for your records.",
      }),
    });
  } catch {
    // Email delivery must not undo an already recorded check-in.
    logger.warn(
      { operation: "ticket_checkin_email", userId: input.userId },
      "Ticket check-in email could not be sent",
    );
  }
};
