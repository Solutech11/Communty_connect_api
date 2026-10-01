import axios from "axios";
import { env } from "../Config/env";
import { AppError } from "./AppError";
import { logger } from "./logger.utils";

const logTerminalFallback = (input: { toEmail: string; subject: string; html: string }): void => {
  // Email bodies can contain OTPs, contact details, receipts, and private content.
  // Log only a redacted envelope so development still shows that mail was captured.
  logger.info({
    operation: "development_email_fallback",
    recipient: "[REDACTED]",
    subject: "[REDACTED]",
    body: input.html,
    bodyBytes: Buffer.byteLength(input.html, "utf8"),
  }, "Email captured by terminal fallback; content redacted");
};

export const sendEmail = async (input: {
  toEmail: string;
  toName: string;
  subject: string;
  html: string;
}): Promise<void> => {
  if (!env.ZEPTOMAIL_SEND_MAIL_TOKEN) {
    if (!env.isProduction) {
      logTerminalFallback(input);
      return;
    }
    throw new AppError(503, "Email delivery is unavailable", "EMAIL_PROVIDER_UNAVAILABLE");
  }

  try {
    await axios.post(
      env.ZEPTOMAIL_API_URL,
      {
        from: {
          address: env.MAIL_FROM_ADDRESS,
          name: env.MAIL_FROM_NAME,
        },
        to: [
          {
            email_address: {
              address: input.toEmail,
              name: input.toName,
            },
          },
        ],
        subject: input.subject,
        htmlbody: input.html,
      },
      {
        timeout: 15_000,
        headers: {
          Authorization: `${env.ZEPTOMAIL_SEND_MAIL_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    if (!env.isProduction) {
      logTerminalFallback(input);
      return;
    }
    logger.warn(
      {
        operation: "zeptomail_send_email",
        providerStatus: axios.isAxiosError(error) ? error.response?.status : undefined,
      },
      "Email provider request failed",
    );
    throw new AppError(502, "Email could not be sent", "EMAIL_PROVIDER_UNAVAILABLE");
  }
};

export const otpEmailTemplate = (name: string, otp: string, purpose: string): string => {
  return `
    <div style="font-family:Arial,sans-serif;color:#102018;line-height:1.6">
      <h2>${env.APP_NAME}</h2>
      <p>Hello ${name},</p>
      <p>Your ${purpose} code is:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px">${otp}</p>
      <p>This code expires in 10 minutes. If you did not request it, ignore this email.</p>
    </div>
  `;
};

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

export const eventModerationEmailTemplate = (input: {
  name: string;
  eventTitle: string;
  verdict: "approved" | "rejected";
  reasons: string[];
}): string => {
  const safeName = escapeHtml(input.name);
  const safeTitle = escapeHtml(input.eventTitle);

  if (input.verdict === "approved") {
    return `
      <div style="font-family:Arial,sans-serif;color:#102018;line-height:1.6">
        <h2>${escapeHtml(env.APP_NAME)}</h2>
        <p>Hello ${safeName},</p>
        <p>Your event <strong>${safeTitle}</strong> passed our automatic review and is now published.</p>
        <p>We reviewed the event information, cover image where provided, ticket pricing, and Community Connect safety guidelines.</p>
      </div>
    `;
  }

  const reasonItems = input.reasons
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#102018;line-height:1.6">
      <h2>${escapeHtml(env.APP_NAME)}</h2>
      <p>Hello ${safeName},</p>
      <p>We could not publish <strong>${safeTitle}</strong> after its automatic review.</p>
      <p>Please review the following items, update your event, and submit it again:</p>
      <ul>${reasonItems}</ul>
      <p>We check event information, cover images, ticket pricing, and our community safety guidelines. Sexual or explicit content, harmful or illegal activity, scams, and misleading information are not allowed.</p>
    </div>
  `;
};
