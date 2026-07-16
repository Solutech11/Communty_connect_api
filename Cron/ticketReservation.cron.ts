import { CACHE_KEYS } from "../Constant";
import { TicketOrderModel } from "../models/Event/TicketOrder.model";
import { TicketTypeModel } from "../models/Event/TicketType.model";
import { TransactionModel } from "../models/Wallet/Transaction.model";
import { completeTicketOrder } from "../Controller/ticket.controller";
import { logger } from "../utils/logger.utils";
import { verifyPaystackTransaction } from "../utils/paystack.utils";
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
      const reference = order.paymentReference as string;
      const provider = await verifyPaystackTransaction(reference);

      if (provider.status === "success" && provider.amount === order.totalKobo) {
        await completeTicketOrder(reference, provider.amount);
        continue;
      }

      if (["failed", "abandoned", "reversed"].includes(provider.status || "")) {
        const cancelled = await TicketOrderModel.findOneAndUpdate(
          { _id: order._id, status: "pending" },
          { status: "cancelled" },
          { new: true },
        );

        if (cancelled) {
          await Promise.all([
            TicketTypeModel.updateOne(
              { _id: cancelled.ticketTypeId, reserved: { $gte: cancelled.quantity } },
              { $inc: { reserved: -cancelled.quantity } },
            ),
            TransactionModel.updateOne(
              { providerReference: reference, status: "pending" },
              { status: "failed", completedAt: new Date() },
            ),
          ]);
        }
        continue;
      }

      // Paystack may still be waiting for authorization. Extend instead of releasing paid inventory.
      order.reservationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await order.save();
    } catch (error) {
      // Fail closed: leave inventory reserved when provider state cannot be verified.
      logger.warn({ error, orderId: order._id.toString() }, "Ticket reservation reconciliation failed");
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
