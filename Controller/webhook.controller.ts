import type { Request, Response } from "express";
import { z } from "zod";
import { WebhookEventModel } from "../models/Webhook/WebhookEvent.model";
import { AppError } from "../utils/AppError";
import { verifyPaystackTransaction } from "../utils/paystack.utils";
import {
  createPaystackSignature,
  secureEqual,
  sha256,
} from "../utils/crypto.utils";
import {
  completeWithdrawal,
  creditVerifiedTopup,
  refundWithdrawal,
} from "./wallet.controller";
import { completeTicketOrder } from "./ticket.controller";
import { completeCommunityMembershipOrder } from "./communityPayment.controller";
import { recordTicketRefundWebhook } from "../utils/ticketPayment.utils";

const paystackWebhookSchema = z.object({
  event: z.string().min(1).max(100),
  data: z.object({
    id: z.union([z.number(), z.string()]).optional(),
    reference: z.string().min(1).max(100).optional(),
    transaction_reference: z.string().min(1).max(100).optional(),
    amount: z.number().int().nonnegative().optional(),
    fees: z.number().int().nonnegative().nullable().optional(),
    status: z.string().max(60).optional(),
    transfer_code: z.string().max(100).optional(),
  }).passthrough(),
}).passthrough();

const resolvePaystackSettlement = async (
  reference: string,
  webhookAmountKobo: number,
  webhookFeeKobo: number | null | undefined,
): Promise<{ amountKobo: number; feeKobo: number | null | undefined }> => {
  if (typeof webhookFeeKobo === "number") {
    return { amountKobo: webhookAmountKobo, feeKobo: webhookFeeKobo };
  }

  // Paystack webhook payloads may omit the fee. Fetch its authoritative
  // transaction details so customer-paid processing fees can be reconciled.
  const verified = await verifyPaystackTransaction(reference);
  if (
    verified.status !== "success"
    || typeof verified.amount !== "number"
    || !Number.isSafeInteger(verified.amount)
    || verified.amount !== webhookAmountKobo
  ) {
    throw new AppError(409, "Paystack payment could not be reconciled", "PAYMENT_NOT_CONFIRMED");
  }

  return { amountKobo: verified.amount, feeKobo: verified.fees };
};

export const paystackWebhook = async (request: Request, response: Response): Promise<Response> => {
  const signature = request.header("x-paystack-signature");
  const rawBody = request.rawBody;

  if (!signature || !rawBody) {
    throw new AppError(401, "Webhook signature is required", "WEBHOOK_SIGNATURE_REQUIRED");
  }

  const expectedSignature = createPaystackSignature(rawBody);

  if (!secureEqual(signature, expectedSignature)) {
    throw new AppError(401, "Webhook signature is invalid", "INVALID_WEBHOOK_SIGNATURE");
  }

  const parsedPayload = paystackWebhookSchema.safeParse(request.body);

  if (!parsedPayload.success) {
    throw new AppError(400, "Webhook payload is invalid", "INVALID_WEBHOOK_PAYLOAD");
  }

  const payload = parsedPayload.data;
  const reference = payload.data?.reference;
  const dedupeKey = sha256(`${payload.event}:${payload.data?.id || "none"}:${reference || "none"}:${signature}`);

  const existingEvent = await WebhookEventModel.findOne({ dedupeKey });

  if (existingEvent) {
    const updatedAt = new Date(existingEvent.get("updatedAt") as Date).getTime();
    const processingIsStale =
      existingEvent.status === "processing" && Date.now() - updatedAt > 5 * 60 * 1000;

    if (["processed", "ignored"].includes(existingEvent.status)) {
      return response.status(200).json({ received: true, duplicate: true });
    }

    if (existingEvent.status === "processing" && !processingIsStale) {
      return response.status(200).json({ received: true, processing: true });
    }

    existingEvent.status = "processing";
    existingEvent.attempts += 1;
    existingEvent.errorCode = undefined;
    await existingEvent.save();
  } else {
    try {
      await WebhookEventModel.create({
        provider: "paystack",
        dedupeKey,
        eventType: payload.event,
        reference,
        status: "processing",
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
        return response.status(200).json({ received: true, processing: true });
      }
      throw error;
    }
  }

  try {
    if (payload.event === "charge.success" && reference) {
      if (
        reference.startsWith("ticket_")
        || reference.startsWith("community_")
        || reference.startsWith("topup_")
      ) {
        if (payload.data.amount === undefined || !Number.isSafeInteger(payload.data.amount)) {
          throw new AppError(400, "Webhook payment amount is required", "WEBHOOK_AMOUNT_REQUIRED");
        }

        const settlement = await resolvePaystackSettlement(
          reference,
          payload.data.amount,
          payload.data.fees,
        );

        if (reference.startsWith("ticket_")) {
          await completeTicketOrder(reference, settlement.amountKobo, settlement.feeKobo);
        } else if (reference.startsWith("community_")) {
          await completeCommunityMembershipOrder(reference, settlement.amountKobo, settlement.feeKobo);
        } else {
          await creditVerifiedTopup(reference, settlement.amountKobo, settlement.feeKobo);
        }
      }
    } else if (payload.event.startsWith("refund.") && payload.data.transaction_reference?.startsWith("ticket_")) {
      await recordTicketRefundWebhook(
        payload.data.transaction_reference,
        payload.data.status || payload.event.slice("refund.".length),
      );
    } else if (payload.event === "transfer.success" && reference) {
      await completeWithdrawal(reference);
    } else if (
      ["transfer.failed", "transfer.reversed"].includes(payload.event) &&
      reference
    ) {
      await refundWithdrawal(reference, payload.event);
    }

    await WebhookEventModel.updateOne(
      { dedupeKey },
      { status: reference ? "processed" : "ignored", processedAt: new Date() },
    );
  } catch (error) {
    await WebhookEventModel.updateOne(
      { dedupeKey },
      { status: "failed", errorCode: "WEBHOOK_PROCESSING_FAILED" },
    );
    throw error;
  }

  return response.status(200).json({ received: true });
};

