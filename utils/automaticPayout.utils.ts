import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { AutomaticPayoutModel, type AutomaticPayout } from "../models/Wallet/AutomaticPayout.model";
import { BankAccountModel } from "../models/Wallet/BankAccount.model";
import { PayoutReminderModel } from "../models/Wallet/PayoutReminder.model";
import { TransactionModel } from "../models/Wallet/Transaction.model";
import { WalletModel } from "../models/Wallet/Wallet.model";
import { UserModel } from "../models/Auth/User.model";
import { completeWithdrawal, refundWithdrawal } from "./walletSettlement.utils";
import { AppError } from "./AppError";
import { logger } from "./logger.utils";
import { formatNaira } from "./paymentEmail.utils";
import { sendEmail } from "./mailer.utils";
import { initiatePaystackBulkTransfers, verifyPaystackTransfer, type PaystackTransferData } from "./paystack.utils";
import { nextPayoutMidnight, payoutCycle, payoutMidnight, PAYOUT_DAY_MS, MIN_AUTOMATIC_PAYOUT_KOBO } from "./payoutSchedule.utils";
import { redisClient } from "../DB/redis";
import { CACHE_KEYS } from "../Constant";

const BATCH_SIZE = 100;
const RETRY_MS = 15 * 60 * 1000;
const RECONCILE_MS = 60 * 60 * 1000;

export const initializeWalletPayouts = async (): Promise<void> => {
  // Production disables Mongoose autoIndex. Explicitly establish unique queue
  // constraints before any worker can reserve money, without dropping indexes.
  await Promise.all([
    AutomaticPayoutModel.createIndexes(), PayoutReminderModel.createIndexes(),
    WalletModel.createIndexes(), BankAccountModel.createIndexes(),
  ]);
  await WalletModel.updateMany({ nextPayoutAt: { $exists: false } }, {
    $set: { nextPayoutAt: nextPayoutMidnight() },
  });
};

const runBounded = async <T>(items: T[], operation: (item: T) => Promise<void>): Promise<void> => {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(5, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      if (item !== undefined) await operation(item);
    }
  }));
};

export const reserveDailyPayouts = async (now = new Date()): Promise<void> => {
  const cutoff = payoutMidnight(now);
  const cycle = payoutCycle(cutoff);
  const nextPayoutAt = nextPayoutMidnight(now);
  const due = { $or: [{ nextPayoutAt: { $lte: cutoff } }, { nextPayoutAt: { $exists: false } }] };
  const wallets = await WalletModel.find({
    status: "active", currency: "NGN", availableBalanceKobo: { $gt: 0 }, ...due,
  }).sort({ nextPayoutAt: 1, _id: 1 }).limit(BATCH_SIZE).select("_id userId").lean();
  // Fetch recipients once per batch instead of performing one provider/account
  // lookup for every wallet. Default wins; otherwise use the oldest active bank.
  const accounts = await BankAccountModel.find({
    userId: { $in: wallets.map((wallet) => wallet.userId) }, active: true,
  }).sort({ isDefault: -1, createdAt: 1, _id: 1 }).lean();
  const recipients = new Map<string, (typeof accounts)[number]>();
  for (const account of accounts) {
    if (!recipients.has(String(account.userId))) recipients.set(String(account.userId), account);
  }

  await runBounded(wallets, async (candidate) => {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const wallet = await WalletModel.findOne({
          _id: candidate._id, status: "active", availableBalanceKobo: { $gt: 0 }, ...due,
        }).session(session).lean();
        if (!wallet) return;
        const amountKobo = wallet.availableBalanceKobo;
        if (!Number.isSafeInteger(amountKobo)) {
          throw new AppError(409, "Wallet balance cannot be paid out", "INVALID_WALLET_BALANCE");
        }
        const account = recipients.get(String(wallet.userId));
        const recipientCode = account?.paystackRecipientCode;
        const activeAccount = account && await BankAccountModel.exists({
          _id: account._id, userId: wallet.userId, active: true,
        }).session(session);
        if (!activeAccount || typeof recipientCode !== "string" || !recipientCode) {
          // The reminder is a durable outbox entry, committed with the daily
          // marker. Mail failures cannot debit funds or lose the reminder.
          await WalletModel.updateOne({ _id: wallet._id }, { $set: { nextPayoutAt } }, { session });
          await PayoutReminderModel.updateOne({ userId: wallet.userId, cycle }, {
            $setOnInsert: {
              balanceKobo: amountKobo, nextAttemptAt: now,
              expiresAt: new Date(now.getTime() + 90 * PAYOUT_DAY_MS),
            },
          }, { upsert: true, session });
          return;
        }
        // Smaller earnings accumulate without reserving or debiting funds.
        // Advance the daily marker so these wallets do not clog every batch.
        if (amountKobo < MIN_AUTOMATIC_PAYOUT_KOBO) {
          await WalletModel.updateOne({ _id: wallet._id }, { $set: { nextPayoutAt } }, { session });
          return;
        }
        // An unresolved earlier transfer must never be paid a second time.
        if (wallet.pendingBalanceKobo > 0 || await AutomaticPayoutModel.exists({ userId: wallet.userId, cycle }).session(session)) {
          await WalletModel.updateOne({ _id: wallet._id }, { $set: { nextPayoutAt } }, { session });
          return;
        }
        const reference = `payout_${randomUUID()}`;
        const reserved = await WalletModel.updateOne({
          _id: wallet._id, availableBalanceKobo: amountKobo, pendingBalanceKobo: 0,
        }, {
          $inc: { availableBalanceKobo: -amountKobo, pendingBalanceKobo: amountKobo },
          $set: { nextPayoutAt },
        }, { session });
        if (reserved.modifiedCount !== 1) throw new AppError(409, "Wallet changed during payout", "PAYOUT_RESERVATION_CONFLICT");
        const [transaction] = await TransactionModel.create([{
          reference, providerReference: reference, walletId: wallet._id, userId: wallet.userId,
          type: "withdrawal", direction: "debit", amountKobo, feeKobo: 0,
          currency: "NGN", status: "processing", provider: "paystack",
          title: "Automatic daily payout", description: "Daily bank payout at midnight (Africa/Lagos)",
          idempotencyKey: `auto-payout:${cycle}`,
          metadata: { automaticPayout: true, payoutCycle: cycle, payoutAmountKobo: amountKobo, bankAccountId: String(account!._id) },
        }], { session });
        if (!transaction) throw new Error("Payout audit transaction was not created");
        await AutomaticPayoutModel.create([{
          userId: wallet.userId, walletId: wallet._id, transactionId: transaction._id,
          bankAccountId: account!._id, recipientCode,
          reference, cycle, amountKobo, currency: "NGN", nextAttemptAt: now,
        }], { session });
      });
    } catch (error) {
      logger.warn({ operation: "reserve_daily_payout", walletId: String(candidate._id), code: error instanceof AppError ? error.code : "PAYOUT_RESERVATION_FAILED" }, "Daily payout reservation failed");
    } finally {
      await session.endSession();
    }
  });
};

export const matchesPayoutTransfer = (payout: Pick<AutomaticPayout, "reference" | "amountKobo" | "currency">, provider: PaystackTransferData): boolean =>
  provider.reference === payout.reference && Number.isSafeInteger(provider.amount)
  && provider.amount === payout.amountKobo && provider.currency === payout.currency;

const applyTransferResult = async (payout: AutomaticPayout, provider: PaystackTransferData): Promise<void> => {
  if (!matchesPayoutTransfer(payout, provider)) {
    throw new AppError(409, "Payout verification did not match", "PAYOUT_PROVIDER_MISMATCH");
  }
  if (provider.status === "success") {
    await completeWithdrawal(payout.reference, provider.amount, provider.currency);
  } else if (["failed", "reversed", "abandoned", "rejected"].includes(provider.status)) {
    await refundWithdrawal(payout.reference, `transfer.${provider.status}`, provider.amount, provider.currency);
  } else {
    await AutomaticPayoutModel.updateOne({ reference: payout.reference, status: { $ne: "settled" } }, {
      $set: { status: "submitted", nextAttemptAt: new Date(Date.now() + RECONCILE_MS) },
    });
    if (["otp", "blocked"].includes(provider.status)) {
      logger.error({ operation: "automatic_payout", providerStatus: provider.status }, "Paystack transfer approval configuration needs attention");
    }
  }
};

export const submitDailyPayouts = async (now = new Date()): Promise<void> => {
  const ready = await AutomaticPayoutModel.find({ status: "ready", nextAttemptAt: { $lte: now } })
    .sort({ nextAttemptAt: 1, _id: 1 }).limit(BATCH_SIZE).select("+recipientCode").lean();
  const transfers: typeof ready = [];
  await runBounded(ready, async (payout) => {
    try {
      if (payout.submissionAttempts > 0) {
        const provider = await verifyPaystackTransfer(payout.reference);
        if (provider) {
          await applyTransferResult(payout, provider);
          return;
        }
      }
      // No provider transfer exists yet. Respect a bank removed before send.
      const [account, wallet] = await Promise.all([
        BankAccountModel.exists({ _id: payout.bankAccountId, userId: payout.userId, active: true }),
        WalletModel.exists({ _id: payout.walletId, status: "active" }),
      ]);
      if (!account || !wallet || payout.amountKobo < MIN_AUTOMATIC_PAYOUT_KOBO) {
        // Older queued payouts below the new minimum may be released only
        // before submission, or after verification proves no transfer exists.
        await refundWithdrawal(payout.reference, payout.amountKobo < MIN_AUTOMATIC_PAYOUT_KOBO
          ? "payout.below_minimum" : "payout.destination_unavailable");
        return;
      }
      transfers.push(payout);
    } catch {
      await AutomaticPayoutModel.updateOne({ _id: payout._id, status: "ready" }, { nextAttemptAt: new Date(now.getTime() + RETRY_MS) });
      logger.warn({ operation: "verify_before_payout_retry" }, "Payout remains reserved until provider verification succeeds");
    }
  });
  if (!transfers.length) return;
  // Keep the provider's minimum five-second spacing across server replicas,
  // whose interval timers may start at different times.
  const permit = await redisClient.set(CACHE_KEYS.lock("payout", "bulk-rate-limit"), "1", { NX: true, PX: 5_000 });
  if (!permit) return;
  // Persist uncertainty BEFORE calling the provider. A crash or timeout is
  // reconciled by reference, never by restoring funds and generating a new one.
  await AutomaticPayoutModel.updateMany({
    _id: { $in: transfers.map((payout) => payout._id) }, status: "ready",
  }, {
    $inc: { submissionAttempts: 1 }, $set: { nextAttemptAt: new Date(now.getTime() + RETRY_MS) },
  });
  try {
    const results = await initiatePaystackBulkTransfers(transfers.map((payout) => ({
      amountKobo: payout.amountKobo, recipientCode: payout.recipientCode, reference: payout.reference,
    })));
    if (!Array.isArray(results)) throw new Error("Invalid bulk payout response");
    const byReference = new Map(results.map((provider) => [provider.reference, provider]));
    await runBounded(transfers, async (payout) => {
      const provider = byReference.get(payout.reference);
      if (!provider) return;
      try {
        await applyTransferResult(payout, provider);
      } catch {
        logger.warn({ operation: "apply_bulk_payout_result" }, "Payout result requires reconciliation");
      }
    });
  } catch {
    logger.warn({ operation: "submit_bulk_payouts", count: transfers.length }, "Bulk payout submission is uncertain; funds remain reserved");
  } finally {
    // Start the cooldown again after the request: slow database reservation
    // writes must not consume the rate-limit interval before the actual send.
    await redisClient.set(CACHE_KEYS.lock("payout", "bulk-rate-limit"), "1", { PX: 5_000 });
  }
};

export const reconcileDailyPayouts = async (now = new Date()): Promise<void> => {
  const payouts = await AutomaticPayoutModel.find({ status: "submitted", nextAttemptAt: { $lte: now } })
    .sort({ nextAttemptAt: 1, _id: 1 }).limit(20).lean();
  await runBounded(payouts, async (payout) => {
    await AutomaticPayoutModel.updateOne({ _id: payout._id, status: "submitted" }, { nextAttemptAt: new Date(now.getTime() + RECONCILE_MS) });
    try {
      const provider = await verifyPaystackTransfer(payout.reference);
      if (provider) await applyTransferResult(payout, provider);
    } catch {
      logger.warn({ operation: "reconcile_daily_payout" }, "Payout reconciliation will retry");
    }
  });
};

export const sendPayoutReminders = async (now = new Date()): Promise<void> => {
  const reminders = await PayoutReminderModel.find({ status: "pending", nextAttemptAt: { $lte: now } })
    .sort({ nextAttemptAt: 1 }).limit(50).lean();
  const ids = reminders.map((reminder) => reminder.userId);
  const [users, banks, wallets] = await Promise.all([
    UserModel.find({ _id: { $in: ids } }).select("_id firstName email status").lean(),
    BankAccountModel.find({ userId: { $in: ids }, active: true }).select("userId").lean(),
    WalletModel.find({ userId: { $in: ids } }).select("userId availableBalanceKobo status").lean(),
  ]);
  const usersById = new Map(users.map((user) => [String(user._id), user]));
  const walletsByUser = new Map(wallets.map((wallet) => [String(wallet.userId), wallet]));
  const linked = new Set(banks.map((bank) => String(bank.userId)));
  await runBounded(reminders, async (reminder) => {
    const user = usersById.get(String(reminder.userId));
    const wallet = walletsByUser.get(String(reminder.userId));
    if (!user || user.status !== "active" || !wallet || wallet.status !== "active"
      || wallet.availableBalanceKobo <= 0 || linked.has(String(reminder.userId))
      || reminder.cycle !== payoutCycle(payoutMidnight(now))) {
      await PayoutReminderModel.updateOne({ _id: reminder._id }, { status: "skipped" });
      return;
    }
    // Back off before delivery so worker restarts do not send rapid duplicates.
    await PayoutReminderModel.updateOne({ _id: reminder._id, status: "pending" }, { nextAttemptAt: new Date(now.getTime() + RETRY_MS) });
    try {
      await sendEmail({
        toEmail: user.email, toName: user.firstName,
        subject: "Link your bank account to receive your wallet payout",
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Your daily payout is pending</h2><p>It is time for your midnight payout, but you have no linked bank account.</p><p>Your ${formatNaira(wallet.availableBalanceKobo)} remains safely in your wallet.</p><p>Open Community Connect, go to My Wallet, and select Link bank account. We will pay your funds to that account at the next midnight payout (Africa/Lagos).</p></div>`,
      });
      await PayoutReminderModel.updateOne({ _id: reminder._id }, { status: "sent" });
    } catch {
      logger.warn({ operation: "send_payout_bank_reminder" }, "Bank linking reminder email will retry");
    }
  });
};
