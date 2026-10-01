import assert from "node:assert/strict";
import test from "node:test";
import mongoose, { type ClientSession } from "mongoose";
import axios from "axios";
import "./test-env";
import { payoutMidnight, nextPayoutMidnight, payoutCycle } from "../utils/payoutSchedule.utils";
import { matchesPayoutTransfer, reserveDailyPayouts, submitDailyPayouts } from "../utils/automaticPayout.utils";
import { redisClient } from "../DB/redis";
import { completeWithdrawal, refundWithdrawal } from "../Controller/wallet.controller";
import { WalletModel } from "../models/Wallet/Wallet.model";
import { BankAccountModel } from "../models/Wallet/BankAccount.model";
import { AutomaticPayoutModel } from "../models/Wallet/AutomaticPayout.model";
import { PayoutReminderModel } from "../models/Wallet/PayoutReminder.model";
import { TransactionModel } from "../models/Wallet/Transaction.model";
import { UserModel } from "../models/Auth/User.model";
import { PlatformEarningModel } from "../models/Admin/PlatformEarning.model";

const fakeSession = (): ClientSession => ({
  withTransaction: async (operation: () => Promise<void>) => operation(),
  endSession: async () => {},
}) as unknown as ClientSession;

test("daily payout uses Lagos midnight across UTC days, month/year boundaries and leap days", () => {
  const cases = [
    ["2026-09-30T22:59:59.000Z", "2026-09-30T23:00:00.000Z", "2026-09-30"],
    ["2026-09-30T23:00:00.000Z", "2026-10-01T23:00:00.000Z", "2026-10-01"],
    ["2026-12-31T23:30:00.000Z", "2027-01-01T23:00:00.000Z", "2027-01-01"],
    ["2028-02-28T23:00:00.000Z", "2028-02-29T23:00:00.000Z", "2028-02-29"],
  ];
  for (const [timestamp, next, cycle] of cases) {
    const now = new Date(timestamp!);
    assert.equal(nextPayoutMidnight(now).toISOString(), next);
    assert.equal(payoutCycle(payoutMidnight(now)), cycle);
    assert.equal(nextPayoutMidnight(now).getTime() - payoutMidnight(now).getTime(), 86_400_000);
  }
});

test("provider settlement must match the payout reference, integer amount and currency", () => {
  const payout = { reference: "payout_test", amountKobo: 150_000, currency: "NGN" as const };
  const provider = { ...payout, amount: payout.amountKobo, status: "success", transfer_code: "TRF_test" };
  assert.equal(matchesPayoutTransfer(payout, provider), true);
  assert.equal(matchesPayoutTransfer(payout, { ...provider, reference: "another_reference" }), false);
  assert.equal(matchesPayoutTransfer(payout, { ...provider, amount: 149_999 }), false);
  assert.equal(matchesPayoutTransfer(payout, { ...provider, amount: 150_000.5 }), false);
  assert.equal(matchesPayoutTransfer(payout, { ...provider, currency: "USD" }), false);
});

test("daily payouts retain NGN 999.99 and pay balances at or above NGN 1,000", async (context) => {
  for (const amountKobo of [99_999, 100_000, 100_001]) {
    await context.test(`balance ${amountKobo} kobo`, async (boundary) => {
      const now = new Date("2026-10-01T23:00:00Z");
      const wallet = {
        _id: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(),
        availableBalanceKobo: amountKobo, pendingBalanceKobo: 0,
        nextPayoutAt: payoutMidnight(now), status: "active", currency: "NGN",
      };
      const bank = { _id: new mongoose.Types.ObjectId(), userId: wallet.userId, paystackRecipientCode: "RCP_fixture" };
      boundary.mock.method(mongoose, "startSession", async () => fakeSession());
      boundary.mock.method(WalletModel, "find", () => ({
        sort: () => ({ limit: () => ({ select: () => ({ lean: async () => [wallet] }) }) }),
      }));
      boundary.mock.method(BankAccountModel, "find", () => ({ sort: () => ({ lean: async () => [bank] }) }));
      boundary.mock.method(BankAccountModel, "exists", () => ({ session: async () => bank }));
      boundary.mock.method(AutomaticPayoutModel, "exists", () => ({ session: async () => null }));
      boundary.mock.method(WalletModel, "findOne", () => ({ session: () => ({
        lean: async () => wallet.nextPayoutAt <= payoutMidnight(now) && wallet.availableBalanceKobo > 0 ? wallet : null,
      }) }));
      boundary.mock.method(WalletModel, "updateOne", async (_query: unknown, update: {
        $set: { nextPayoutAt: Date }; $inc?: { availableBalanceKobo: number; pendingBalanceKobo: number };
      }) => {
        wallet.nextPayoutAt = update.$set.nextPayoutAt;
        wallet.availableBalanceKobo += update.$inc?.availableBalanceKobo || 0;
        wallet.pendingBalanceKobo += update.$inc?.pendingBalanceKobo || 0;
        return { modifiedCount: 1 };
      });
      const transactions = boundary.mock.method(TransactionModel, "create", async () => [{ _id: new mongoose.Types.ObjectId() }]);
      const payouts = boundary.mock.method(AutomaticPayoutModel, "create", async () => []);
      const reminders = boundary.mock.method(PayoutReminderModel, "updateOne", async () => ({ modifiedCount: 1 }));
      await reserveDailyPayouts(now);
      await reserveDailyPayouts(now);
      const eligible = amountKobo >= 100_000;
      assert.equal(wallet.availableBalanceKobo, eligible ? 0 : amountKobo);
      assert.equal(wallet.pendingBalanceKobo, eligible ? amountKobo : 0);
      assert.equal(wallet.nextPayoutAt.toISOString(), "2026-10-02T23:00:00.000Z");
      assert.equal(transactions.mock.callCount(), eligible ? 1 : 0);
      assert.equal(payouts.mock.callCount(), eligible ? 1 : 0);
      assert.equal(reminders.mock.callCount(), 0);
    });
  }
});

test("a wallet without a bank keeps its balance and queues exactly one reminder per daily run", async (context) => {
  const now = new Date("2026-10-01T23:00:00Z");
  const wallet = {
    _id: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(),
    availableBalanceKobo: 150_000, pendingBalanceKobo: 0,
    nextPayoutAt: payoutMidnight(now), status: "active", currency: "NGN",
  };
  context.mock.method(mongoose, "startSession", async () => fakeSession());
  context.mock.method(WalletModel, "find", () => ({
    sort: () => ({ limit: () => ({ select: () => ({ lean: async () => [wallet] }) }) }),
  }));
  context.mock.method(BankAccountModel, "find", () => ({ sort: () => ({ lean: async () => [] }) }));
  context.mock.method(WalletModel, "findOne", () => ({ session: () => ({
    lean: async () => wallet.nextPayoutAt <= payoutMidnight(now) ? wallet : null,
  }) }));
  const updates: unknown[] = [];
  context.mock.method(WalletModel, "updateOne", async (_query: unknown, update: { $set: { nextPayoutAt: Date } }) => {
    updates.push(update);
    wallet.nextPayoutAt = update.$set.nextPayoutAt;
    return { modifiedCount: 1 };
  });
  const reminders = context.mock.method(PayoutReminderModel, "updateOne", async () => ({ modifiedCount: 1 }));
  const transactions = context.mock.method(TransactionModel, "create", async () => { throw new Error("No payout should be created"); });
  await reserveDailyPayouts(now);
  await reserveDailyPayouts(now);
  assert.equal(wallet.availableBalanceKobo, 150_000);
  assert.equal(wallet.pendingBalanceKobo, 0);
  assert.equal(wallet.nextPayoutAt.toISOString(), "2026-10-02T23:00:00.000Z");
  assert.equal(reminders.mock.callCount(), 1);
  assert.equal(transactions.mock.callCount(), 0);
  assert.equal(updates.length, 1);
  assert.deepEqual(reminders.mock.calls[0]!.arguments[0], { userId: wallet.userId, cycle: "2026-10-02" });
});

test("confirmed payout and later reversal change wallet funds once even with repeated delivery", async (context) => {
  const transaction = new TransactionModel({
    reference: "payout_test", walletId: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(),
    type: "withdrawal", direction: "debit", amountKobo: 100_000, feeKobo: 0, currency: "NGN",
    status: "processing", provider: "paystack", title: "Automatic daily payout",
    idempotencyKey: "auto-payout:2026-10-01", metadata: { payoutAmountKobo: 100_000, automaticPayout: true },
  });
  context.mock.method(mongoose, "startSession", async () => fakeSession());
  context.mock.method(transaction, "save", async () => transaction);
  context.mock.method(TransactionModel, "findOne", (query: { status: { $in: string[] }; "metadata.refundApplied"?: unknown }) => ({
    session: async () => query.status.$in.includes(transaction.status)
      && !(query["metadata.refundApplied"] && transaction.get("metadata.refundApplied")) ? transaction : null,
  }));
  const walletUpdates: Array<Record<string, unknown>> = [];
  context.mock.method(WalletModel, "updateOne", async (_query: unknown, update: Record<string, unknown>) => {
    walletUpdates.push(update);
    return { modifiedCount: 1 };
  });
  context.mock.method(AutomaticPayoutModel, "updateOne", async () => ({ modifiedCount: 1 }));
  context.mock.method(PlatformEarningModel, "updateOne", async () => ({ modifiedCount: 1 }));
  context.mock.method(UserModel, "findById", () => ({ select: () => ({ lean: async () => null }) }));
  await assert.rejects(completeWithdrawal("payout_test", 100_001, "NGN"), { code: "PAYOUT_PROVIDER_MISMATCH" });
  assert.equal(walletUpdates.length, 0);
  await completeWithdrawal("payout_test", 100_000, "NGN");
  await completeWithdrawal("payout_test", 100_000, "NGN");
  assert.equal(transaction.status, "successful");
  assert.equal(walletUpdates.length, 1);
  assert.deepEqual(walletUpdates[0], { $inc: { pendingBalanceKobo: -100_000 } });
  await refundWithdrawal("payout_test", "transfer.reversed", 100_000, "NGN");
  await refundWithdrawal("payout_test", "transfer.reversed", 100_000, "NGN");
  assert.equal(transaction.status, "reversed");
  assert.equal(walletUpdates.length, 2);
  const restored = walletUpdates[1] as unknown as Array<{ $set: { pendingBalanceKobo?: unknown } }>;
  assert.equal(restored[0]!.$set.pendingBalanceKobo, undefined, "A reversal after success must not deduct pending funds again");
});

test("payout cannot complete when its wallet reserve is missing", async (context) => {
  context.mock.method(mongoose, "startSession", async () => fakeSession());
  const transaction = new TransactionModel({
    reference: "payout_missing", walletId: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(),
    type: "withdrawal", direction: "debit", amountKobo: 100_000, feeKobo: 0, currency: "NGN",
    status: "processing", provider: "paystack", title: "Automatic daily payout", idempotencyKey: "test",
  });
  context.mock.method(TransactionModel, "findOne", () => ({ session: async () => transaction }));
  context.mock.method(WalletModel, "updateOne", async () => ({ modifiedCount: 0 }));
  await assert.rejects(completeWithdrawal("payout_missing", 100_000, "NGN"), { code: "WITHDRAWAL_RESERVE_MISSING" });
  assert.equal(transaction.status, "processing");
});

test("a timed-out bulk payout stays reserved and is verified before any retry", async (context) => {
  const now = new Date("2026-10-01T23:00:00Z");
  const payout = {
    _id: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(), walletId: new mongoose.Types.ObjectId(),
    bankAccountId: new mongoose.Types.ObjectId(), transactionId: new mongoose.Types.ObjectId(),
    reference: "payout_stable_reference", recipientCode: "RCP_fixture", cycle: "2026-10-02",
    amountKobo: 100_000, currency: "NGN", submissionAttempts: 0, status: "ready", nextAttemptAt: now,
  };
  context.mock.method(AutomaticPayoutModel, "find", () => ({
    sort: () => ({ limit: () => ({ select: () => ({ lean: async () => [payout] }) }) }),
  }));
  context.mock.method(AutomaticPayoutModel, "updateMany", async () => {
    payout.submissionAttempts += 1;
    return { modifiedCount: 1 };
  });
  context.mock.method(AutomaticPayoutModel, "updateOne", async (_query: unknown, update: { $set?: { status: string } }) => {
    if (update.$set) payout.status = update.$set.status;
    return { modifiedCount: 1 };
  });
  context.mock.method(BankAccountModel, "exists", async () => ({ _id: payout.bankAccountId }));
  context.mock.method(WalletModel, "exists", async () => ({ _id: payout.walletId }));
  const walletWrites = context.mock.method(WalletModel, "updateOne", async () => { throw new Error("Uncertain payout must not release funds"); });
  context.mock.method(redisClient, "set", async () => "OK");
  const requests: string[] = [];
  context.mock.method(axios.Axios.prototype, "request", async (config: { url: string }) => {
    requests.push(config.url);
    if (config.url === "/transfer/bulk") throw new Error("Provider response timed out");
    return { data: { status: true, data: {
      reference: payout.reference, amount: payout.amountKobo, currency: "NGN", status: "pending", transfer_code: "TRF_fixture",
    } } };
  });
  await submitDailyPayouts(now);
  assert.equal(payout.submissionAttempts, 1);
  assert.equal(payout.status, "ready");
  assert.equal(walletWrites.mock.callCount(), 0);
  await submitDailyPayouts(new Date(now.getTime() + 15 * 60 * 1000));
  assert.deepEqual(requests, ["/transfer/bulk", "/transfer/verify/payout_stable_reference"]);
  assert.equal(payout.status, "submitted");
  assert.equal(payout.submissionAttempts, 1, "A known pending transfer must not be submitted again");
  assert.equal(walletWrites.mock.callCount(), 0);
});
