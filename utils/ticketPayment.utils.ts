import { env } from "../Config/env";
import { CACHE_KEYS } from "../Constant";
import { TicketPaymentAttemptModel } from "../models/Event/TicketPaymentAttempt.model";
import { TransactionModel } from "../models/Wallet/Transaction.model";
import { AppError } from "./AppError";
import { logger } from "./logger.utils";
import {
  createPaystackRefund,
  fetchPaystackRefund,
  listPaystackRefunds,
  verifyPaystackTransaction,
  type PaystackRefundData,
  type PaystackTransactionData,
} from "./paystack.utils";
import { matchesPaystackSettlement } from "./paystackSettlement.utils";
import { withRedisLock } from "./redisLock.utils";

export const isPaystackCheckoutUrl = (value: string | null | undefined): value is string => {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.origin === "https://checkout.paystack.com"
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
};

// Verification is authoritative for every saved or newly initialized checkout.
// Unknown provider state or mismatched identity/amount must never open another charge.
export const verifyTicketPayment = async (
  reference: string,
  expectedAmountKobo: number,
): Promise<PaystackTransactionData> => {
  let provider: PaystackTransactionData;

  try {
    provider = await verifyPaystackTransaction(reference);
  } catch {
    throw new AppError(409, "Ticket payment is still being confirmed", "PAYMENT_STILL_PROCESSING");
  }

  const referenceMatches = provider.reference === reference;
  const currencyMatches = provider.currency === env.PAYSTACK_CURRENCY;
  const settlementAmountMatches = matchesPaystackSettlement(
    provider.amount, provider.fees, expectedAmountKobo,
  );
  const requestedAmountMatches = Number.isSafeInteger(provider.requested_amount)
    && provider.requested_amount === expectedAmountKobo;
  // For unfinished transactions, Paystack's requested_amount identifies the
  // initialized amount even when amount includes a customer-paid fee. A
  // successful payment still must reconcile against the actual amount/fee.
  const amountMatches = provider.status === "success"
    ? settlementAmountMatches
    : requestedAmountMatches || settlementAmountMatches;

  if (!referenceMatches || !currencyMatches || !amountMatches) {
    logger.warn({
      operation: "verify_ticket_payment",
      providerStatus: provider.status,
      expectedAmountKobo,
      providerAmountKobo: Number.isSafeInteger(provider.amount) ? provider.amount : undefined,
      providerRequestedAmountKobo: Number.isSafeInteger(provider.requested_amount)
        ? provider.requested_amount
        : undefined,
      providerFeeKobo: Number.isSafeInteger(provider.fees) ? provider.fees : undefined,
      providerCurrency: provider.currency,
      referenceMatches,
      currencyMatches,
      settlementAmountMatches,
      requestedAmountMatches,
    }, "Paystack ticket verification does not match its order");
    throw new AppError(409, "Ticket payment could not be reconciled", "PAYMENT_STILL_PROCESSING");
  }

  return provider;
};

const refundMatchesTransaction = (refund: PaystackRefundData, transactionId: string, reference: string): boolean => {
  if (refund.transaction === undefined) return false;
  if (typeof refund.transaction === "number" || typeof refund.transaction === "string") {
    return String(refund.transaction) === transactionId;
  }
  return String(refund.transaction.id || "") === transactionId
    || refund.transaction.reference === reference;
};

// A second successful charge cannot issue another ticket. Track the refund before
// calling Paystack; retries first search the provider so an uncertain response
// cannot initiate two refunds for the same transaction.
export const reconcileDuplicateTicketPayment = async (reference: string): Promise<void> => {
  await withRedisLock(CACHE_KEYS.lock("ticket-refund", reference), async () => {
    const attempt = await TicketPaymentAttemptModel.findOne({ reference });
    if (!attempt || attempt.status === "refunded") return;

    const provider = await verifyTicketPayment(reference, attempt.amountKobo);
    const transactionId = String(provider.id || attempt.paystackTransactionId || "");
    if (!transactionId) {
      throw new AppError(409, "Ticket refund needs payment verification", "PAYMENT_STILL_PROCESSING");
    }

    const listedRefunds = attempt.refundId ? [] : await listPaystackRefunds(transactionId);
    const matchingRefunds = listedRefunds
      .filter((item) => refundMatchesTransaction(item, transactionId, reference))
      .sort((left, right) => Number(right.id) - Number(left.id));
    if (listedRefunds.length > 0 && matchingRefunds.length === 0) {
      throw new AppError(409, "Ticket refund needs provider reconciliation", "PAYMENT_STILL_PROCESSING");
    }
    const refund = attempt.refundId
      ? await fetchPaystackRefund(attempt.refundId)
      : matchingRefunds[0];

    let currentRefund = refund;
    if (!currentRefund) {
      if (provider.status !== "success") {
        throw new AppError(409, "Ticket refund is still being confirmed", "PAYMENT_STILL_PROCESSING");
      }
      // A prior refund request may have reached Paystack even if its response
      // was lost. Do not issue another refund on an empty provider listing.
      if (attempt.refundAttempts > 0) {
        attempt.status = "refund_needs_attention";
        attempt.refundCheckedAt = new Date();
        await attempt.save();
        logger.error({ reference }, "Ticket duplicate charge refund needs manual reconciliation");
        return;
      }

      attempt.status = "refund_pending";
      attempt.refundAttempts += 1;
      attempt.refundCheckedAt = new Date();
      await attempt.save();
      currentRefund = await createPaystackRefund(reference);
    }

    if (
      !refundMatchesTransaction(currentRefund, transactionId, reference)
      || (typeof currentRefund.amount === "number" && currentRefund.amount !== provider.amount)
    ) {
      attempt.status = "refund_needs_attention";
      attempt.refundCheckedAt = new Date();
      await attempt.save();
      logger.error({ orderId: attempt.orderId.toString() }, "Ticket refund identity or amount needs manual reconciliation");
      return;
    }

    attempt.refundId = String(currentRefund.id);
    attempt.refundCheckedAt = new Date();
    if (currentRefund.status === "processed") {
      attempt.status = "refunded";
      await TransactionModel.updateOne(
        { providerReference: reference, type: "ticket_purchase" },
        { status: "reversed", completedAt: new Date() },
      );
    } else if (currentRefund.status === "failed") {
      attempt.status = "refund_failed";
      logger.error({ reference, refundId: attempt.refundId }, "Ticket duplicate charge refund failed");
    } else if (currentRefund.status === "needs-attention") {
      attempt.status = "refund_needs_attention";
      logger.error({ reference, refundId: attempt.refundId }, "Ticket duplicate charge refund needs attention");
    } else {
      attempt.status = "refund_requested";
    }
    await attempt.save();
  }, 90_000);
};

export const recordTicketRefundWebhook = async (
  reference: string,
  status: string,
): Promise<void> => {
  const attempt = await TicketPaymentAttemptModel.findOne({ reference });
  if (!attempt || !["refund_pending", "refund_requested", "refund_failed", "refund_needs_attention", "refunded"].includes(attempt.status)) {
    return;
  }

  if (status === "processed") {
    attempt.status = "refunded";
    await TransactionModel.updateOne(
      { providerReference: reference, type: "ticket_purchase" },
      { status: "reversed", completedAt: new Date() },
    );
  } else if (status === "failed") {
    attempt.status = "refund_failed";
  } else if (status === "needs-attention") {
    attempt.status = "refund_needs_attention";
  } else if (["pending", "processing"].includes(status)) {
    attempt.status = "refund_requested";
  } else {
    return;
  }

  attempt.refundCheckedAt = new Date();
  await attempt.save();
};
