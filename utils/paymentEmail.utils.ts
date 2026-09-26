import { UserModel } from "../models/Auth/User.model";
import { env } from "../Config/env";
import { logger } from "./logger.utils";
import { sendEmail } from "./mailer.utils";

export interface PaymentReceiptEmailInput {
  userId: string;
  subject: string;
  heading: string;
  amountPaidKobo: number;
  amountLabel?: string;
  details: Array<{ label: string; value: string }>;
}

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

export const formatNaira = (amountKobo: number): string => {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountKobo / 100);
};

const paymentReceiptTemplate = (input: {
  name: string;
  heading: string;
  amountPaidKobo: number;
  amountLabel: string;
  details: PaymentReceiptEmailInput["details"];
}): string => {
  const detailRows = input.details
    .map(({ label, value }) => {
      return `<tr><td style="padding:8px 12px;color:#526158">${escapeHtml(label)}</td><td style="padding:8px 12px;text-align:right;font-weight:600">${escapeHtml(value)}</td></tr>`;
    })
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#102018;line-height:1.6;max-width:560px;margin:0 auto">
      <h2>${escapeHtml(env.APP_NAME)}</h2>
      <p>Hello ${escapeHtml(input.name)},</p>
      <h3>${escapeHtml(input.heading)}</h3>
      <p>We have confirmed this transaction. Here is your receipt:</p>
      <table style="width:100%;border-collapse:collapse">
        ${detailRows}
        <tr><td style="padding:12px;border-top:1px solid #dce5de;font-weight:700">${escapeHtml(input.amountLabel)}</td><td style="padding:12px;border-top:1px solid #dce5de;text-align:right;font-weight:700">${formatNaira(input.amountPaidKobo)}</td></tr>
      </table>
      <p>If you have questions about this payment, contact our support team.</p>
    </div>
  `;
};

export const sendPaymentReceiptEmail = async (input: PaymentReceiptEmailInput): Promise<void> => {
  try {
    const user = await UserModel.findById(input.userId).select("firstName email").lean();

    if (!user) {
      logger.warn(
        { operation: "payment_receipt_email", userId: input.userId },
        "Payment receipt recipient was not found",
      );
      return;
    }

    await sendEmail({
      toEmail: user.email,
      toName: user.firstName,
      subject: input.subject,
      html: paymentReceiptTemplate({
        name: user.firstName,
        heading: input.heading,
        amountPaidKobo: input.amountPaidKobo,
        amountLabel: input.amountLabel ?? "Amount paid",
        details: input.details,
      }),
    });
  } catch {
    // Email delivery is best-effort and must not roll back a confirmed payment.
    logger.warn(
      { operation: "payment_receipt_email", userId: input.userId },
      "Payment receipt email could not be sent",
    );
  }
};
