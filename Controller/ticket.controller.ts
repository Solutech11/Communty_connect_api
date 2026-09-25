import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { env } from "../Config/env";
import { CACHE_KEYS } from "../Constant";
import { EventModel } from "../models/Event/Event.model";
import { TicketOrderModel } from "../models/Event/TicketOrder.model";
import { TicketTypeModel } from "../models/Event/TicketType.model";
import { TransactionModel } from "../models/Wallet/Transaction.model";
import { WalletModel } from "../models/Wallet/Wallet.model";
import { AppError } from "../utils/AppError";
import {
  createOpaqueToken,
  decryptField,
  encryptField,
  sha256,
} from "../utils/crypto.utils";
import { createNotification } from "../utils/notificationService.utils";
import {
  initializePaystackTransaction,
  verifyPaystackTransaction,
} from "../utils/paystack.utils";
import { matchesPaystackSettlement } from "../utils/paystackSettlement.utils";
import { sendSuccess } from "../utils/response.utils";
import { withRedisLock } from "../utils/redisLock.utils";
import { calculatePlatformCharge, recordPlatformEarning } from "../utils/platformCharge.utils";

const orderNumber = (): string => `CC-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
const paymentReference = (): string => `ticket_${randomUUID()}`.toLowerCase();

const releaseReservation = async (ticketTypeId: unknown, quantity: number): Promise<void> => {
  await TicketTypeModel.updateOne(
    { _id: ticketTypeId, reserved: { $gte: quantity } },
    { $inc: { reserved: -quantity } },
  );
};

export const createTicketOrder = async (
  request: Request,
  response: Response,
): Promise<Response> => {
  const userId = request.auth?.id as string;
  const idempotencyKey = request.idempotencyKey as string;

  return withRedisLock(CACHE_KEYS.lock("ticket-order", userId), async () => {
  const existing = await TicketOrderModel.findOne({ buyerId: userId, idempotencyKey })
    .select("+checkoutUrl");

  if (existing) {
    return sendSuccess(response, 200, "Ticket order already initialized", {
      order: existing,
      checkoutUrl: existing.checkoutUrl,
    });
  }

  const event = await EventModel.findOne({
    _id: request.params.id as string,
    status: "published",
    startsAt: { $gt: new Date() },
  });

  if (!event) {
    throw new AppError(404, "Available event was not found", "EVENT_NOT_AVAILABLE");
  }

  const requestedType = await TicketTypeModel.findOne({
    _id: request.body.ticketTypeId,
    eventId: event._id,
    active: true,
  });

  if (!requestedType) {
    throw new AppError(404, "Ticket type was not found", "TICKET_TYPE_NOT_FOUND");
  }

  const quantity = request.body.quantity;
  const capacityFilter: Record<string, unknown> = {
    _id: requestedType._id,
    active: true,
  };

  if (requestedType.capacity !== undefined && requestedType.capacity !== null) {
    capacityFilter.$expr = {
      $lte: [
        { $add: ["$sold", { $ifNull: ["$reserved", 0] }, quantity] },
        "$capacity",
      ],
    };
  }

  const ticketType = await TicketTypeModel.findOneAndUpdate(
    capacityFilter,
    { $inc: { reserved: quantity } },
    { new: true },
  );

  if (!ticketType) {
    throw new AppError(409, "Not enough tickets remain", "TICKET_CAPACITY_EXCEEDED");
  }

  const wallet = await WalletModel.findOne({ userId, status: "active" });

  if (!wallet) {
    await releaseReservation(ticketType._id, quantity);
    throw new AppError(404, "Wallet was not found", "WALLET_NOT_FOUND");
  }

  const reference = paymentReference();
  const ticketSubtotalKobo = ticketType.priceKobo * quantity;
  const platformFeeKobo = calculatePlatformCharge(ticketSubtotalKobo, "ticket_purchase");
  const organizerProceedsKobo = ticketSubtotalKobo;
  const totalKobo = ticketSubtotalKobo + platformFeeKobo;
  const qrToken = createOpaqueToken(48);
  let order;

  try {
    order = await TicketOrderModel.create({
      orderNumber: orderNumber(),
      eventId: event._id,
      ticketTypeId: ticketType._id,
      buyerId: userId,
      quantity,
      ticketSubtotalKobo,
      totalKobo,
      platformFeeKobo,
      organizerProceedsKobo,
      paymentReference: reference,
      idempotencyKey,
      qrTokenHash: sha256(qrToken),
      encryptedQrToken: encryptField(qrToken),
      reservationExpiresAt: new Date(Date.now() + 20 * 60 * 1000),
    });

    await TransactionModel.create({
      reference,
      providerReference: reference,
      walletId: wallet._id,
      userId,
      type: "ticket_purchase",
      direction: "debit",
      amountKobo: totalKobo,
      feeKobo: platformFeeKobo,
      status: totalKobo === 0 ? "processing" : "pending",
      title: `Ticket for ${event.title}`,
      description: `${quantity} x ${ticketType.title}`,
      provider: totalKobo === 0 ? "internal" : "paystack",
      idempotencyKey,
      metadata: {
        orderId: order._id.toString(),
        eventId: event._id.toString(),
        organizerUserId: event.creatorId.toString(),
        organizerProceedsKobo,
      },
    });

    if (totalKobo === 0) {
      await completeTicketOrder(reference, 0);
      const paidOrder = await TicketOrderModel.findById(order._id);
      return sendSuccess(response, 201, "Free ticket issued", { order: paidOrder, qrToken });
    }

    const checkout = await initializePaystackTransaction({
      email: request.auth?.email as string,
      amountKobo: totalKobo,
      reference,
      metadata: {
        purpose: "ticket_purchase",
        orderId: order._id.toString(),
        eventId: event._id.toString(),
        userId,
      },
    });
    order.checkoutUrl = checkout.authorization_url;
    await order.save();

    const safeOrder = await TicketOrderModel.findById(order._id);
    return sendSuccess(response, 201, "Ticket checkout initialized", {
      order: safeOrder,
      checkoutUrl: checkout.authorization_url,
      accessCode: checkout.access_code,
      publicKey: env.PAYSTACK_PUBLIC_KEY,
      charge: { ticketSubtotalKobo, platformFeeKobo, totalPayableKobo: totalKobo },
    });
  } catch (error) {
    await Promise.all([
      releaseReservation(ticketType._id, quantity),
      order
        ? TicketOrderModel.updateOne({ _id: order._id, status: "pending" }, { status: "cancelled" })
        : Promise.resolve(),
      TransactionModel.updateOne({ reference }, { status: "failed" }),
    ]);
    throw error;
  }
  });
};

export const completeTicketOrder = async (
  reference: string,
  providerAmount: number,
  paystackFeeKobo?: number | null,
): Promise<void> => {
  const session = await mongoose.startSession();
  let paidOrderId: string | undefined;
  let buyerId: string | undefined;

  try {
    await session.withTransaction(async () => {
      const order = await TicketOrderModel.findOne({
        paymentReference: reference,
        status: "pending",
      }).session(session);

      if (!order) {
        return;
      }

      if (!matchesPaystackSettlement(providerAmount, paystackFeeKobo, order.totalKobo)) {
        throw new AppError(409, "Ticket payment amount does not match", "PAYMENT_AMOUNT_MISMATCH");
      }

      const inventory = await TicketTypeModel.updateOne(
        { _id: order.ticketTypeId, reserved: { $gte: order.quantity } },
        { $inc: { reserved: -order.quantity, sold: order.quantity } },
        { session },
      );

      if (inventory.modifiedCount !== 1) {
        throw new AppError(409, "Ticket reservation is unavailable", "TICKET_RESERVATION_LOST");
      }

      const event = await EventModel.findById(order.eventId).session(session);
      if (!event) {
        throw new AppError(409, "Ticket event is unavailable", "EVENT_UNAVAILABLE");
      }

      const platformFeeKobo = order.platformFeeKobo || 0;
      const ticketSubtotalKobo = order.ticketSubtotalKobo
        || Math.max(0, order.totalKobo - platformFeeKobo);
      const organizerProceedsKobo = ticketSubtotalKobo;

      if (organizerProceedsKobo > 0) {
        const organizerWallet = await WalletModel.findOneAndUpdate(
          { userId: event.creatorId, status: "active" },
          { $inc: { availableBalanceKobo: organizerProceedsKobo } },
          { new: true, session },
        );

        if (!organizerWallet) {
          throw new AppError(409, "Organizer wallet is unavailable", "ORGANIZER_WALLET_UNAVAILABLE");
        }
      }

      const transaction = await TransactionModel.findOne({
        providerReference: reference,
        status: { $in: ["pending", "processing"] },
      }).session(session);

      if (!transaction) {
        throw new AppError(409, "Ticket transaction is unavailable", "TRANSACTION_UNAVAILABLE");
      }

      order.status = "paid";
      await order.save({ session });
      transaction.status = "successful";
      transaction.completedAt = new Date();
      await transaction.save({ session });
      await recordPlatformEarning({
        sourceType: "ticket_purchase",
        sourceReference: reference,
        payerUserId: order.buyerId,
        beneficiaryUserId: event.creatorId,
        transactionId: transaction._id,
        grossAmountKobo: order.totalKobo,
        feeAmountKobo: platformFeeKobo,
        netAmountKobo: organizerProceedsKobo,
        metadata: { orderId: order._id.toString(), eventId: event._id.toString() },
        session,
      });
      paidOrderId = order._id.toString();
      buyerId = order.buyerId.toString();
    });
  } finally {
    await session.endSession();
  }

  if (paidOrderId && buyerId) {
    void createNotification({
      userId: buyerId,
      type: "ticket_confirmed",
      title: "Your ticket is confirmed",
      body: "Your event ticket is ready in My Tickets.",
      data: { orderId: paidOrderId, route: "MyTickets" },
      dedupeKey: `ticket-paid:${paidOrderId}`,
    });
  }
};

export const verifyTicketOrder = async (
  request: Request,
  response: Response,
): Promise<Response> => {
  const order = await TicketOrderModel.findOne({
    orderNumber: request.params.orderNumber as string,
    buyerId: request.auth?.id,
  });

  if (!order) {
    throw new AppError(404, "Ticket order was not found", "TICKET_ORDER_NOT_FOUND");
  }

  if (order.status !== "paid") {
    const provider = await verifyPaystackTransaction(order.paymentReference as string);
    const providerAmountKobo = provider.amount;

    if (
      provider.status !== "success"
      || typeof providerAmountKobo !== "number"
      || !matchesPaystackSettlement(providerAmountKobo, provider.fees, order.totalKobo)
    ) {
      throw new AppError(409, "Ticket payment is not confirmed", "PAYMENT_NOT_CONFIRMED");
    }

    await completeTicketOrder(order.paymentReference as string, providerAmountKobo, provider.fees);
  }

  return getTicketOrder(request, response);
};

export const listMyTickets = async (request: Request, response: Response): Promise<Response> => {
  const orders = await TicketOrderModel.find({ buyerId: request.auth?.id })
    .populate("eventId", "title coverImageUrl startsAt endsAt venueName address state lga")
    .populate("ticketTypeId", "title priceKobo")
    .sort({ createdAt: -1 });
  return sendSuccess(response, 200, "Tickets retrieved", { tickets: orders });
};

export const getTicketOrder = async (request: Request, response: Response): Promise<Response> => {
  const order = await TicketOrderModel.findOne({
    orderNumber: request.params.orderNumber as string,
    buyerId: request.auth?.id,
  })
    .select("+encryptedQrToken")
    .populate("eventId", "title coverImageUrl startsAt endsAt venueName address state lga")
    .populate("ticketTypeId", "title priceKobo");

  if (!order) {
    throw new AppError(404, "Ticket order was not found", "TICKET_ORDER_NOT_FOUND");
  }

  const encryptedQrToken = order.encryptedQrToken as string | undefined;
  const qrToken = order.status === "paid" && encryptedQrToken
    ? decryptField(encryptedQrToken)
    : undefined;
  order.set("encryptedQrToken", undefined);
  order.set("qrTokenHash", undefined);
  return sendSuccess(response, 200, "Ticket retrieved", { order, qrToken });
};
