import type { Request, Response } from "express";
import { z } from "zod";
import { WebhookEventModel } from "../models/Webhook/WebhookEvent.model";
import { AppError } from "../utils/AppError";
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

const paystackWebhookSchema = z.object({
  event: z.string().min(1).max(100),
  data: z.object({
    id: z.union([z.number(), z.string()]).optional(),
    reference: z.string().min(1).max(100).optional(),
    amount: z.number().int().nonnegative().optional(),
    status: z.string().max(60).optional(),
    transfer_code: z.string().max(100).optional(),
  }).passthrough(),
}).passthrough();

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
      if (reference.startsWith("ticket_")) {
        await completeTicketOrder(reference, payload.data.amount);
      } else {
        await creditVerifiedTopup(reference, payload.data.amount);
      }
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

