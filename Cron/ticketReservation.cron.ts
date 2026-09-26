import mongoose from "mongoose";
import { CACHE_KEYS } from "../Constant";
import { TicketPaymentAttemptModel } from "../models/Event/TicketPaymentAttempt.model";
import { TicketOrderModel } from "../models/Event/TicketOrder.model";
import { TicketTypeModel } from "../models/Event/TicketType.model";
import { TransactionModel } from "../models/Wallet/Transaction.model";
import { completeTicketOrder } from "../Controller/ticket.controller";
import { logger } from "../utils/logger.utils";
import { reconcileDuplicateTicketPayment, verifyTicketPayment } from "../utils/ticketPayment.utils";
import { withRedisLock } from "../utils/redisLock.utils";

const reconcileExpiredReservations = async (): Promise<void> => {
  const orders = await TicketOrderModel.find({
    status: "pending",
    reservationExpiresAt: { $lte: new Date() },
  })
    .sort({ reservationExpiresAt: 1 })
    .limit(50);

  for (const order of orders) {
    try {
      await withRedisLock(CACHE_KEYS.lock("ticket-checkout", order._id.toString()), async () => {
        const current = await TicketOrderModel.findById(order._id);
        if (!current || current.status !== "pending") return;
        const attempts = await TicketPaymentAttemptModel.find({ orderId: current._id });
        const references = attempts.length
          ? attempts.map((attempt) => attempt.reference)
          : [current.paymentReference as string];
        let uncertain = false;
        for (const reference of references) {
          const provider = await verifyTicketPayment(reference, current.totalKobo);
          if (provider.status === "success") {
            await completeTicketOrder(reference, provider.amount as number, provider.fees);
          } else if (!["failed", "abandoned", "reversed"].includes(provider.status || "")) {
            uncertain = true;
          }
        }
        const refreshed = await TicketOrderModel.findById(current._id);
        if (!refreshed || refreshed.status !== "pending") return;
        if (uncertain) {
          refreshed.reservationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
          await refreshed.save();
          return;
        }
        // All known references are terminal. Release once in a transaction.
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            const cancelled = await TicketOrderModel.findOneAndUpdate(
              { _id: refreshed._id, status: "pending" }, { status: "cancelled" },
              { new: true, session },
            );
            if (!cancelled) return;
            const inventory = await TicketTypeModel.updateOne(
              { _id: cancelled.ticketTypeId, reserved: { $gte: cancelled.quantity } },
              { $inc: { reserved: -cancelled.quantity } }, { session },
            );
            if (inventory.modifiedCount !== 1) throw new Error("Ticket reservation release failed");
            await TransactionModel.updateMany(
              { "metadata.orderId": cancelled._id.toString(), status: { $in: ["pending", "processing"] } },
              { status: "failed", completedAt: new Date() }, { session },
            );
          });
        } finally {
          await session.endSession();
        }
      }, 180_000);
    } catch (error) {
      // Fail closed and back off; provider mismatches must not release a possibly
      // paid reservation or produce an error log on every cron pass.
      await TicketOrderModel.updateOne(
        { _id: order._id, status: "pending" },
        { reservationExpiresAt: new Date(Date.now() + 15 * 60 * 1000) },
      );
      logger.warn({ error, orderId: order._id.toString() }, "Ticket reservation reconciliation failed");
    }
  }
  const refunds = await TicketPaymentAttemptModel.find({
    status: { $in: ["refund_pending", "refund_requested", "refund_failed", "refund_needs_attention"] },
  }).limit(50);
  for (const attempt of refunds) {
    try {
      await reconcileDuplicateTicketPayment(attempt.reference);
    } catch (error) {
      logger.warn({ error, reference: attempt.reference }, "Ticket refund reconciliation failed");
    }
  }

  // Webhooks can be delayed or lost. Keep checking recent older references
  // after an order has closed, so a late charge is either the winning payment
  // or becomes a tracked refund.
  const recentAttempts = await TicketPaymentAttemptModel.find({
    status: { $in: ["initializing", "ready", "failed"] },
    createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
  }).sort({ lastReconciledAt: 1, createdAt: 1 }).limit(50);
  for (const attempt of recentAttempts) {
    try {
      const order = await TicketOrderModel.findById(attempt.orderId);
      if (order && order.status !== "pending") {
        const provider = await verifyTicketPayment(attempt.reference, order.totalKobo);
        if (provider.status === "success") {
          await completeTicketOrder(attempt.reference, provider.amount as number, provider.fees);
          if (order.status === "paid" && (order.paidReference || order.paymentReference) === attempt.reference) {
            await TicketPaymentAttemptModel.updateOne({ _id: attempt._id }, { status: "succeeded" });
          }
        }
      }
    } catch (error) {
      logger.warn({ error, reference: attempt.reference }, "Late ticket payment reconciliation failed");
    } finally {
      await TicketPaymentAttemptModel.updateOne(
        { _id: attempt._id }, { lastReconciledAt: new Date() },
      );
    }
  }
};

export const startTicketReservationCron = (): (() => void) => {
  const run = async (): Promise<void> => {
    try {
      await withRedisLock(
        CACHE_KEYS.lock("cron", "ticket-reservations"),
        reconcileExpiredReservations,
        4 * 60 * 1000,
      );
    } catch {
      // Another instance owns the cron lock, or Redis is unavailable. The next interval retries.
    }
  };

  void run();
  const timer = setInterval(() => void run(), 5 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
};
