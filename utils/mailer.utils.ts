import { env } from "../Config/env";
import { AppError } from "./AppError";
import {
  renderBrandedEmail,
  renderEmailBulletList,
  renderEmailCode,
  renderEmailHighlight,
} from "./emailTemplate.utils";
import { logger } from "./logger.utils";

const RESEND_EMAILS_API_URL = "https://api.resend.com/emails";

const formatMailbox = (name: string, address: string): string => {
  const safeName = Array.from(name, (character) => {
    const characterCode = character.charCodeAt(0);
    return characterCode < 32
      || characterCode === 34
      || characterCode === 44
      || characterCode === 59
      || characterCode === 60
      || characterCode === 62
      || characterCode === 92
      || characterCode === 127
      ? " "
      : character;
  }).join("").trim();

  return safeName ? safeName + " <" + address + ">" : address;
};

const logTerminalFallback = (input: { toEmail: string; subject: string; html: string }): void => {
  // Email bodies can contain OTPs, contact details, receipts, and private content.
  // Log only a redacted envelope so development still shows that mail was captured.
  logger.info({
    operation: "development_email_fallback",
    recipient: "[REDACTED]",
    subject: "[REDACTED]",
    bodyBytes: Buffer.byteLength(input.html, "utf8"),
  }, "Email captured by terminal fallback; content redacted");
};

const htmlToPlainText = (html: string): string => html
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<head[\s\S]*?<\/head>/gi, " ")
  .replace(/<\/(p|h[1-6]|tr|li|div|table)>/gi, "\n")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&zwnj;|&shy;/gi, "")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, "\"")
  .replace(/&#0*39;/gi, "'")
  .replace(/[ \t]+/g, " ")
  .replace(/ *\n */g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

export const sendEmail = async (input: {
  toEmail: string;
  toName: string;
  subject: string;
  html: string;
}): Promise<void> => {
  if (!env.RESEND_API_KEY) {
    if (!env.isProduction) {
      logTerminalFallback(input);
      return;
    }
    throw new AppError(503, "Email delivery is unavailable", "EMAIL_PROVIDER_UNAVAILABLE");
  }

  let providerStatus: number | undefined;

  try {
    const response = await fetch(RESEND_EMAILS_API_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: formatMailbox(env.MAIL_FROM_NAME, env.MAIL_FROM_ADDRESS),
        to: [formatMailbox(input.toName, input.toEmail)],
        subject: input.subject,
        html: input.html,
        text: htmlToPlainText(input.html),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      providerStatus = response.status;
      throw new Error("Resend rejected the email request");
    }
  } catch {
    if (!env.isProduction) {
      logTerminalFallback(input);
      return;
    }
    logger.warn(
      {
        operation: "resend_send_email",
        providerStatus,
      },
      "Email provider request failed",
    );
    throw new AppError(502, "Email could not be sent", "EMAIL_PROVIDER_UNAVAILABLE");
  }
};

export const otpEmailTemplate = (name: string, otp: string, purpose: string): string => {
  const isVerification = purpose === "email verification";

  return renderBrandedEmail({
    preheader: isVerification ? "Your email verification code is ready." : "Your account security code is ready.",
    eyebrow: "ACCOUNT SECURITY",
    heading: isVerification ? "Verify your email" : "Reset your password",
    greetingName: name,
    intro: `Enter this one-time code to complete your ${purpose}.`,
    contentHtml: renderEmailCode(otp),
    footerNote: "This code expires in 10 minutes. If you did not request it, you can ignore this email. Never share a security code with anyone.",
  });
};

export const eventModerationEmailTemplate = (input: {
  name: string;
  eventTitle: string;
  verdict: "approved" | "rejected";
  reasons: string[];
}): string => {
  if (input.verdict === "approved") {
    return renderBrandedEmail({
      preheader: "Your event has passed review and is now published.",
      eyebrow: "EVENT UPDATE",
      heading: "Your event is now live",
      greetingName: input.name,
      intro: "Good news — your event passed review and is published for the community.",
      contentHtml: renderEmailHighlight("Published event", input.eventTitle),
      footerNote: "You can view and manage your event from the Community Connect app.",
    });
  }

  const reasons = input.reasons.length > 0
    ? input.reasons
    : ["Review your event details and make sure they follow our community safety guidelines."];

  return renderBrandedEmail({
    preheader: "Please update your event before it can be published.",
    eyebrow: "EVENT UPDATE",
    heading: "Your event needs an update",
    greetingName: input.name,
    intro: "We could not publish this event yet. Please address the items below, then update and resubmit it.",
    contentHtml: `${renderEmailHighlight("Event", input.eventTitle)}<p style="margin:20px 0 8px;color:#182b21;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:1.5">Items to review</p>${renderEmailBulletList(reasons)}<p style="margin:16px 0 0;color:#66786e;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.65">Events must follow our community safety guidelines and avoid explicit or harmful content, illegal activity, scams, and misleading information.</p>`,
    footerNote: "Update the event in Community Connect and submit it for review again.",
  });
};
