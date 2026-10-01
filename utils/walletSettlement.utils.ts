import mongoose from "mongoose";
import { WalletModel } from "../models/Wallet/Wallet.model";
import { TransactionModel } from "../models/Wallet/Transaction.model";
import { AutomaticPayoutModel } from "../models/Wallet/AutomaticPayout.model";
import { PlatformEarningModel } from "../models/Admin/PlatformEarning.model";
import { AppError } from "./AppError";
import { walletCreditUpdate } from "./walletCredit.utils";
import { recordPlatformEarning } from "./platformCharge.utils";
import { formatNaira, sendPaymentReceiptEmail } from "./paymentEmail.utils";

export const completeWithdrawal = async (reference: string, providerAmountKobo?: number, providerCurrency?: string): Promise<void> => {
  const session = await mongoose.startSession();
  let receipt: {
    userId: string;
    withdrawalAmountKobo: number;
    payoutAmountKobo: number;
    platformFeeKobo: number;
  } | undefined;

  try {
    await session.withTransaction(async () => {
      receipt = undefined;
      const transaction = await TransactionModel.findOne({
        reference,
        type: "withdrawal",
        status: { $in: ["pending", "processing"] },
      }).session(session);

      if (!transaction) {
        return;
      }

      const metadata = transaction.metadata as { payoutAmountKobo?: number };
      const payoutAmountKobo = metadata.payoutAmountKobo
        ?? transaction.amountKobo - (transaction.feeKobo || 0);
      if (providerAmountKobo !== undefined && (providerAmountKobo !== payoutAmountKobo || providerCurrency !== transaction.currency)) {
        throw new AppError(409, "Payout verification did not match", "PAYOUT_PROVIDER_MISMATCH");
      }
      const walletResult = await WalletModel.updateOne(
        { _id: transaction.walletId, pendingBalanceKobo: { $gte: transaction.amountKobo } },
        { $inc: { pendingBalanceKobo: -transaction.amountKobo } },
        { session },
      );

      if (walletResult.modifiedCount !== 1) {
        throw new AppError(409, "Reserved withdrawal funds are unavailable", "WITHDRAWAL_RESERVE_MISSING");
      }

      transaction.status = "successful";
      transaction.completedAt = new Date();
      await transaction.save({ session });
      await AutomaticPayoutModel.updateOne({ reference }, { status: "settled" }, { session });
      await recordPlatformEarning({
        sourceType: "withdrawal",
        sourceReference: transaction.reference,
        payerUserId: transaction.userId,
        transactionId: transaction._id,
        grossAmountKobo: transaction.amountKobo,
        feeAmountKobo: transaction.feeKobo || 0,
        netAmountKobo: payoutAmountKobo,
        session,
      });
      receipt = {
        userId: transaction.userId.toString(),
        withdrawalAmountKobo: transaction.amountKobo,
        payoutAmountKobo,
        platformFeeKobo: transaction.feeKobo || 0,
      };
    });
  } finally {
    await session.endSession();
  }

  if (receipt) {
    const details = [
      { label: "Requested withdrawal", value: formatNaira(receipt.withdrawalAmountKobo) },
      { label: "Platform fee", value: formatNaira(receipt.platformFeeKobo) },
    ];
    await sendPaymentReceiptEmail({
      userId: receipt.userId,
      subject: "Your wallet bank payout is complete",
      heading: "Wallet bank payout complete",
      amountPaidKobo: receipt.payoutAmountKobo,
      amountLabel: "Amount received",
      details,
    });
  }
};

export const refundWithdrawal = async (reference: string, reason: string, providerAmountKobo?: number, providerCurrency?: string): Promise<void> => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const transaction = await TransactionModel.findOne({
        reference,
        type: "withdrawal",
        // Banks can reverse a transfer after an earlier success notification.
        status: { $in: reason === "transfer.reversed" ? ["pending", "processing", "successful"] : ["pending", "processing"] },
        "metadata.refundApplied": { $ne: true },
      }).session(session);

      if (!transaction) {
        return;
      }

      const payoutAmountKobo = transaction.amountKobo - (transaction.feeKobo || 0);
      if (providerAmountKobo !== undefined && (providerAmountKobo !== payoutAmountKobo || providerCurrency !== transaction.currency)) {
        throw new AppError(409, "Payout verification did not match", "PAYOUT_PROVIDER_MISMATCH");
      }
      const wasSuccessful = transaction.status === "successful";
      const restored = await WalletModel.updateOne(
        { _id: transaction.walletId, ...(wasSuccessful ? {} : { pendingBalanceKobo: { $gte: transaction.amountKobo } }) },
        [{ $set: {
          ...walletCreditUpdate(transaction.amountKobo)[0]!.$set,
          ...(wasSuccessful ? {} : { pendingBalanceKobo: { $subtract: ["$pendingBalanceKobo", transaction.amountKobo] } }),
        } }],
        { session, updatePipeline: true },
      );
      if (restored.modifiedCount !== 1) {
        throw new AppError(409, "Reserved payout funds are unavailable", "WITHDRAWAL_RESERVE_MISSING");
      }
      await AutomaticPayoutModel.updateOne({ reference }, { status: "settled" }, { session });
      if (wasSuccessful) {
        await PlatformEarningModel.updateOne({ sourceType: "withdrawal", sourceReference: reference, status: "earned" },
          { status: "reversed", reversedAt: new Date() }, { session });
      }
      transaction.status = "reversed";
      transaction.set("metadata.refundApplied", true);
      transaction.set("metadata.refundReason", reason);
      transaction.completedAt = new Date();
      await transaction.save({ session });
    });
  } finally {
    await session.endSession();
  }
};
