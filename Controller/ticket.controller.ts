import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { env } from "../Config/env";
import { CACHE_KEYS } from "../Constant";
import { EventModel } from "../models/Event/Event.model";
import { TicketPaymentAttemptModel } from "../models/Event/TicketPaymentAttempt.model";
import { TicketOrderModel } from "../models/Event/TicketOrder.model";
import { TicketTypeModel } from "../models/Event/TicketType.model";
import { UserModel } from "../models/Auth/User.model";
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
import {
  isPaystackCheckoutUrl,
  reconcileDuplicateTicketPayment,
  verifyTicketPayment,
} from "../utils/ticketPayment.utils";
import { sendSuccess } from "../utils/response.utils";
import { withRedisLock } from "../utils/redisLock.utils";
import { calculatePlatformCharge, recordPlatformEarning } from "../utils/platformCharge.utils";
import { formatNaira, sendPaymentReceiptEmail } from "../utils/paymentEmail.utils";

const orderNumber = (): string => `CC-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
const paymentReference = (): string => `ticket_${randomUUID()}`.toLowerCase();
import { walletCreditUpdate } from "../utils/walletCredit.utils";

export const webCallbackUrl = (number: string): string => {
  const base = env.WEB_BASE_URL || (!env.isProduction ? "http://localhost:5173" : "");
  if (!base) throw new AppError(503, "Web checkout is unavailable", "WEB_CHECKOUT_UNAVAILABLE");
  return `${base.replace(/\/+$/, "")}/checkout/return/${encodeURIComponent(number)}`;
};

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
  const checkoutClient = request.body.client === "web" ? "web" : "mobile";
  if (checkoutClient === "web") {
    // Fail before reserving capacity when no browser callback is configured.
    webCallbackUrl("availability-check");
  }

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
  let paymentInitializationStarted = false;

  try {
    order = await TicketOrderModel.create({
      orderNumber: orderNumber(),
      eventId: event._id,
      ticketTypeId: ticketType._id,
      buyerId: userId,
      quantity,
      checkoutClient,
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

    await TicketPaymentAttemptModel.create({
      orderId: order._id,
      reference,
      amountKobo: totalKobo,
      status: "initializing",
    });
    paymentInitializationStarted = true;
    const checkout = await initializePaystackTransaction({
      email: request.auth?.email as string,
      amountKobo: totalKobo,
      reference,
      ...(checkoutClient === "web" ? { callbackUrl: webCallbackUrl(order.orderNumber) } : {}),
      metadata: {
        purpose: "ticket_purchase",
        orderId: order._id.toString(),
        eventId: event._id.toString(),
        userId,
      },
    });
    if (checkout.reference !== reference || !isPaystackCheckoutUrl(checkout.authorization_url)) {
      throw new AppError(409, "Ticket checkout could not be reconciled", "PAYMENT_STILL_PROCESSING");
    }
    await TicketPaymentAttemptModel.updateOne(
      { orderId: order._id, reference, status: "initializing" },
      { status: "ready", checkoutUrl: checkout.authorization_url },
    );
    order.checkoutUrl = checkout.authorization_url;
    await order.save();

    const safeOrder = await TicketOrderModel.findById(order._id);
    if (safeOrder?.status === "paid") {
      return sendSuccess(response, 200, "Ticket payment is already confirmed", { order: safeOrder });
    }
    return sendSuccess(response, 201, "Ticket checkout initialized", {
      order: safeOrder,
      checkoutUrl: checkout.authorization_url,
      accessCode: checkout.access_code,
      publicKey: env.PAYSTACK_PUBLIC_KEY,
      charge: { ticketSubtotalKobo, platformFeeKobo, totalPayableKobo: totalKobo },
    });
  } catch (error) {
    // Once initialization reaches Paystack, its outcome may be uncertain.
    // Retain the order, reservation, and reference for webhook/cron reconciliation.
    if (!paymentInitializationStarted) {
      await Promise.all([
        releaseReservation(ticketType._id, quantity),
        order
          ? TicketOrderModel.updateOne({ _id: order._id, status: "pending" }, { status: "cancelled" })
          : Promise.resolve(),
        TransactionModel.updateOne({ reference }, { status: "failed" }),
      ]);
    }
    throw error;
  }
  });
};

export const completeTicketOrder = async (
  reference: string,
  providerAmount: number,
  paystackFeeKobo?: number | null,
): Promise<void> => {
  let attempt = await TicketPaymentAttemptModel.findOne({ reference });
  const targetOrder = attempt
    ? await TicketOrderModel.findById(attempt.orderId)
    : await TicketOrderModel.findOne({ paymentReference: reference });
  if (!targetOrder) return;

  if (providerAmount > 0) {
    const verified = await verifyTicketPayment(reference, targetOrder.totalKobo);
    if (verified.status !== "success") {
      throw new AppError(409, "Ticket payment is still being confirmed", "PAYMENT_STILL_PROCESSING");
    }
    providerAmount = verified.amount as number;
    paystackFeeKobo = verified.fees;
    if (!attempt) {
      attempt = await TicketPaymentAttemptModel.findOneAndUpdate(
        { reference },
        { $setOnInsert: {
          orderId: targetOrder._id, reference,
          amountKobo: targetOrder.totalKobo, status: "initializing",
        } },
        { upsert: true, new: true },
      );
    }
  }

  const session = await mongoose.startSession();
  let paidOrderId: string | undefined;
  let buyerId: string | undefined;
  let duplicatePayment = false;
  let receipt: {
    userId: string;
    orderNumber: string;
    eventTitle: string;
    ticketTypeTitle: string;
    quantity: number;
    subtotalKobo: number;
    platformFeeKobo: number;
    amountPaidKobo: number;
    paystackFeeKobo: number;
  } | undefined;

  try {
    await session.withTransaction(async () => {
      paidOrderId = undefined;
      buyerId = undefined;
      duplicatePayment = false;
      receipt = undefined;
      const order = await TicketOrderModel.findById(targetOrder._id).session(session);

      if (!order) {
        return;
      }

      if (order.status !== "pending") {
        duplicatePayment = providerAmount > 0 && (
          order.status !== "paid" || (order.paidReference || order.paymentReference) !== reference
        );
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
          walletCreditUpdate(organizerProceedsKobo),
          { new: true, session, updatePipeline: true },
        );

        if (!organizerWallet) {
          throw new AppError(409, "Organizer wallet is unavailable", "ORGANIZER_WALLET_UNAVAILABLE");
        }
      }

      const transaction = await TransactionModel.findOne({
        providerReference: reference,
        status: { $in: ["pending", "processing", "failed"] },
      }).session(session);

      if (!transaction) {
        throw new AppError(409, "Ticket transaction is unavailable", "TRANSACTION_UNAVAILABLE");
      }

      order.status = "paid";
      order.paidAt = new Date();
      order.paidReference = reference;
      order.paymentReference = reference;
      await order.save({ session });
      if (attempt) {
        await TicketPaymentAttemptModel.updateOne(
          { _id: attempt._id },
          { status: "succeeded", providerStatus: "success" },
          { session },
        );
      }
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
      if (providerAmount > 0 && order.totalKobo > 0) {
        const ticketType = await TicketTypeModel.findById(order.ticketTypeId).session(session);
        receipt = {
          userId: order.buyerId.toString(),
          orderNumber: order.orderNumber,
          eventTitle: event.title,
          ticketTypeTitle: ticketType?.title ?? "Event ticket",
          quantity: order.quantity,
          subtotalKobo: ticketSubtotalKobo,
          platformFeeKobo,
          amountPaidKobo: providerAmount,
          paystackFeeKobo: paystackFeeKobo ?? 0,
        };
      }
    });
  } finally {
    await session.endSession();
  }

  if (duplicatePayment) {
    await TransactionModel.updateOne(
      { providerReference: reference, status: { $in: ["pending", "failed"] } },
      { status: "processing" },
    );
    if (attempt) {
      await TicketPaymentAttemptModel.updateOne(
        { _id: attempt._id, status: { $nin: ["refunded", "refund_requested"] } },
        { status: "refund_pending", providerStatus: "success" },
      );
    }
    await reconcileDuplicateTicketPayment(reference);
    return;
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

  if (receipt) {
    const details = [
      { label: "Event", value: receipt.eventTitle },
      { label: "Ticket", value: `${receipt.quantity} × ${receipt.ticketTypeTitle}` },
      { label: "Ticket subtotal", value: formatNaira(receipt.subtotalKobo) },
      { label: "Platform fee", value: formatNaira(receipt.platformFeeKobo) },
    ];
    if (receipt.paystackFeeKobo > 0) {
      details.push({ label: "Paystack processing fee", value: formatNaira(receipt.paystackFeeKobo) });
    }
    await sendPaymentReceiptEmail({
      userId: receipt.userId,
      subject: "Your ticket payment is confirmed",
      heading: "Ticket payment confirmed",
      amountPaidKobo: receipt.amountPaidKobo,
      details: [
        { label: "Order", value: receipt.orderNumber },
        ...details,
      ],
    });
  }
};

const checkoutOrderSummary = (order: { orderNumber: string; status: string; totalKobo: number }) => ({
  orderNumber: order.orderNumber,
  status: order.status,
  totalKobo: order.totalKobo,
});

export const resumeTicketCheckout = async (
  request: Request,
  response: Response,
): Promise<Response> => {
  const buyerId = request.auth?.id as string;
  const order = await TicketOrderModel.findOne({
    orderNumber: request.params.orderNumber as string,
    buyerId,
  }).select("+checkoutUrl");
  if (!order) {
    throw new AppError(404, "Ticket order was not found", "TICKET_ORDER_NOT_FOUND");
  }

  return withRedisLock(CACHE_KEYS.lock("ticket-checkout", order._id.toString()), async () => {
    const current = await TicketOrderModel.findById(order._id).select("+checkoutUrl");
    if (!current) {
      throw new AppError(404, "Ticket order was not found", "TICKET_ORDER_NOT_FOUND");
    }
    if (current.status === "paid") {
      return sendSuccess(response, 200, "Ticket payment is already confirmed", {
        outcome: "already_paid", order: checkoutOrderSummary(current),
      });
    }
    if (current.status !== "pending" || current.totalKobo <= 0) {
      throw new AppError(409, "Ticket order cannot be retried", "TICKET_ORDER_NOT_RETRYABLE");
    }

    // Include the original reference on orders created before attempt history existed.
    await TicketPaymentAttemptModel.updateOne(
      { reference: current.paymentReference },
      { $setOnInsert: {
        orderId: current._id,
        reference: current.paymentReference,
        amountKobo: current.totalKobo,
        checkoutUrl: current.checkoutUrl,
        status: "initializing",
      } },
      { upsert: true },
    );
    const attempts = await TicketPaymentAttemptModel.find({ orderId: current._id })
      .select("+checkoutUrl").sort({ createdAt: -1 });
    let resumableUrl: string | undefined;

    // Reconcile every reference before issuing another charge. An older attempt
    // may have succeeded after a newer checkout was initialized.
    for (const attempt of attempts) {
      const provider = await verifyTicketPayment(attempt.reference, current.totalKobo);
      attempt.providerStatus = provider.status;
      attempt.paystackTransactionId = provider.id ? String(provider.id) : attempt.paystackTransactionId;
      if (provider.status === "success") {
        await attempt.save();
        await completeTicketOrder(attempt.reference, provider.amount as number, provider.fees);
        continue;
      }
      if (provider.status === "abandoned" && isPaystackCheckoutUrl(attempt.checkoutUrl)) {
        resumableUrl ||= attempt.checkoutUrl;
        attempt.status = "ready";
      } else if (["failed", "reversed"].includes(provider.status || "")) {
        attempt.status = "failed";
        await TransactionModel.updateOne(
          { providerReference: attempt.reference, status: "pending" },
          { status: "failed", completedAt: new Date() },
        );
      } else {
        await attempt.save();
        throw new AppError(409, "Ticket payment is still being confirmed", "PAYMENT_STILL_PROCESSING");
      }
      await attempt.save();
    }

    const settled = await TicketOrderModel.findById(current._id);
    if (settled?.status === "paid") {
      return sendSuccess(response, 200, "Ticket payment is already confirmed", {
        outcome: "already_paid", order: checkoutOrderSummary(settled),
      });
    }
    if (!settled || settled.status !== "pending") {
      throw new AppError(409, "Ticket order cannot be retried", "TICKET_ORDER_NOT_RETRYABLE");
    }
    const event = await EventModel.findById(settled.eventId);
    const ticketType = await TicketTypeModel.findById(settled.ticketTypeId);
    if (
      !settled.reservationExpiresAt || settled.reservationExpiresAt <= new Date()
      || event?.status !== "published" || event.startsAt <= new Date()
      || !ticketType || ticketType.reserved < settled.quantity
    ) {
      throw new AppError(409, "Ticket order cannot be retried", "TICKET_ORDER_NOT_RETRYABLE");
    }

    if (resumableUrl) {
      return sendSuccess(response, 200, "Checkout is ready", {
        outcome: "checkout_ready", order: checkoutOrderSummary(settled), checkoutUrl: resumableUrl,
      });
    }

    if (attempts.length >= 8) {
      throw new AppError(409, "Ticket order has reached its payment attempt limit", "TICKET_ORDER_NOT_RETRYABLE");
    }

    const idempotencyKey = request.idempotencyKey as string;
    if (attempts.some((attempt) => attempt.idempotencyKey === idempotencyKey)) {
      throw new AppError(409, "This checkout action needs a new idempotency key", "TICKET_ORDER_NOT_RETRYABLE");
    }
    if (await TransactionModel.exists({ userId: buyerId, idempotencyKey })) {
      throw new AppError(409, "This checkout action needs a new idempotency key", "TICKET_ORDER_NOT_RETRYABLE");
    }
    const buyer = await UserModel.findById(settled.buyerId).select("email");
    const originalTransaction = await TransactionModel.findOne({
      providerReference: settled.paymentReference,
      type: "ticket_purchase",
    });
    if (!buyer?.email || !originalTransaction) {
      throw new AppError(409, "Ticket payment is still being confirmed", "PAYMENT_STILL_PROCESSING");
    }
    const reference = paymentReference();
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await TicketPaymentAttemptModel.create([{
          orderId: settled._id, reference, idempotencyKey,
          amountKobo: settled.totalKobo, status: "initializing",
        }], { session });
        await TransactionModel.create([{
          reference, providerReference: reference, walletId: originalTransaction.walletId,
          userId: buyerId, type: "ticket_purchase", direction: "debit",
          amountKobo: settled.totalKobo, feeKobo: settled.platformFeeKobo,
          status: "pending", title: `Ticket for ${event.title}`,
          description: `${settled.quantity} x ${ticketType.title}`,
          provider: "paystack", idempotencyKey,
          metadata: {
            orderId: settled._id.toString(), eventId: event._id.toString(),
            organizerUserId: event.creatorId.toString(),
            organizerProceedsKobo: settled.organizerProceedsKobo,
          },
        }], { session });
        const updated = await TicketOrderModel.updateOne(
          { _id: settled._id, status: "pending", paymentReference: settled.paymentReference },
          { $set: { paymentReference: reference }, $unset: { checkoutUrl: "" } },
          { session },
        );
        if (updated.modifiedCount !== 1) {
          throw new AppError(409, "Ticket payment is still being confirmed", "PAYMENT_STILL_PROCESSING");
        }
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
        throw new AppError(409, "This checkout action needs a new idempotency key", "TICKET_ORDER_NOT_RETRYABLE");
      }
      throw error;
    } finally {
      await session.endSession();
    }

    // The attempt is durable before contacting Paystack. If initialization has
    // an uncertain result, retrying the same key reconciles this reference.
    let checkout;
    try {
      checkout = await initializePaystackTransaction({
        email: buyer.email, amountKobo: settled.totalKobo, reference,
        ...(settled.checkoutClient === "web" ? { callbackUrl: webCallbackUrl(settled.orderNumber) } : {}),
        metadata: {
          purpose: "ticket_purchase", orderId: settled._id.toString(),
          eventId: event._id.toString(), userId: buyerId,
        },
      });
    } catch {
      throw new AppError(409, "Ticket payment is still being confirmed", "PAYMENT_STILL_PROCESSING");
    }
    if (checkout.reference !== reference || !isPaystackCheckoutUrl(checkout.authorization_url)) {
      throw new AppError(409, "Ticket payment is still being confirmed", "PAYMENT_STILL_PROCESSING");
    }
    await TicketPaymentAttemptModel.updateOne(
      { reference, status: "initializing" }, { status: "ready", checkoutUrl: checkout.authorization_url },
    );
    const provider = await verifyTicketPayment(reference, settled.totalKobo);
    await TicketPaymentAttemptModel.updateOne(
      { reference },
      { providerStatus: provider.status, paystackTransactionId: provider.id ? String(provider.id) : undefined },
    );
    if (provider.status === "success") {
      await completeTicketOrder(reference, provider.amount as number, provider.fees);
      return sendSuccess(response, 200, "Ticket payment is already confirmed", {
        outcome: "already_paid",
        order: checkoutOrderSummary((await TicketOrderModel.findById(settled._id))!),
      });
    }
    if (provider.status !== "abandoned") {
      throw new AppError(409, "Ticket payment is still being confirmed", "PAYMENT_STILL_PROCESSING");
    }
    return sendSuccess(response, 200, "Checkout is ready", {
      outcome: "checkout_ready", order: checkoutOrderSummary(settled),
      checkoutUrl: checkout.authorization_url,
    });
  }, 180_000).catch((error: unknown) => {
    if (error instanceof AppError && error.code === "OPERATION_IN_PROGRESS") {
      throw new AppError(409, "Ticket payment is still being confirmed", "PAYMENT_STILL_PROCESSING");
    }
    throw error;
  });
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
    const attempts = await TicketPaymentAttemptModel.find({ orderId: order._id });
    const references = attempts.length
      ? attempts.map((attempt) => attempt.reference)
      : [order.paymentReference as string];
    let confirmed = false;
    for (const reference of references) {
      const provider = await verifyTicketPayment(reference, order.totalKobo);
      if (provider.status === "success") {
        await completeTicketOrder(reference, provider.amount as number, provider.fees);
        confirmed = true;
      }
    }
    if (!confirmed || (await TicketOrderModel.findById(order._id))?.status !== "paid") {
      throw new AppError(409, "Ticket payment is not confirmed", "PAYMENT_NOT_CONFIRMED");
    }
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
