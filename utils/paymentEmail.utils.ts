import { UserModel } from "../models/Auth/User.model";
import { logger } from "./logger.utils";
import { sendEmail } from "./mailer.utils";
import { renderBrandedEmail, renderEmailDetails, renderEmailHighlight } from "./emailTemplate.utils";

export interface PaymentReceiptEmailInput {
  userId: string;
  subject: string;
  heading: string;
  amountPaidKobo: number;
  amountLabel?: string;
  details: Array<{ label: string; value: string }>;
}

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
  return renderBrandedEmail({
    preheader: `Payment confirmed: ${formatNaira(input.amountPaidKobo)}.`,
    eyebrow: "PAYMENT RECEIPT",
    heading: input.heading,
    greetingName: input.name,
    intro: "Your transaction is confirmed. Here is a summary for your records.",
    contentHtml: `${renderEmailHighlight(input.amountLabel, formatNaira(input.amountPaidKobo))}${renderEmailDetails(input.details)}`,
    footerNote: "If this payment looks unfamiliar, contact the Community Connect support team through the app.",
  });
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
