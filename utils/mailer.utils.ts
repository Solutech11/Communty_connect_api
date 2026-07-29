import axios from "axios";
import { env } from "../Config/env";
import { AppError } from "./AppError";

export const sendEmail = async (input: {
  toEmail: string;
  toName: string;
  subject: string;
  html: string;
}): Promise<void> => {
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
  } catch(error) {
    console.log(error);
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
