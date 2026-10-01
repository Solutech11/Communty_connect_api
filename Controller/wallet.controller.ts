import type { Request, Response } from "express";
import mongoose from "mongoose";
import { BankAccountModel } from "../models/Wallet/BankAccount.model";
import { TransactionModel } from "../models/Wallet/Transaction.model";
import { WalletModel } from "../models/Wallet/Wallet.model";
import { nextPayoutMidnight, PAYOUT_TIMEZONE, MIN_AUTOMATIC_PAYOUT_KOBO } from "../utils/payoutSchedule.utils";
import { walletCreditUpdate } from "../utils/walletCredit.utils";
import { getActiveWalletBanks, resolveWalletBankAccount } from "../utils/bankAccount.utils";
import { AppError } from "../utils/AppError";
import { encryptField, maskAccountNumber, sha256 } from "../utils/crypto.utils";
import {
  createPaystackTransferRecipient,
  finalizePaystackTransfer,
  verifyPaystackTransaction,
} from "../utils/paystack.utils";
import { recordPlatformEarning } from "../utils/platformCharge.utils";
import { logger } from "../utils/logger.utils";
import { matchesPaystackSettlement } from "../utils/paystackSettlement.utils";
import { formatNaira, sendPaymentReceiptEmail } from "../utils/paymentEmail.utils";
import { sendSuccess } from "../utils/response.utils";

export const getWallet = async (request: Request, response: Response): Promise<Response> => {
  const wallet = await WalletModel.findOne({ userId: request.auth?.id });

  if (!wallet) {
    throw new AppError(404, "Wallet was not found", "WALLET_NOT_FOUND");
  }

  const bankAccount = await BankAccountModel.findOne({ userId: request.auth?.id, active: true })
    .sort({ isDefault: -1, createdAt: 1, _id: 1 })
    .select("_id bankName accountName maskedAccountNumber").lean();
  const now = new Date();
  return sendSuccess(response, 200, "Wallet retrieved", {
    wallet: {
      _id: wallet._id, walletNumber: wallet.walletNumber, currency: wallet.currency,
      availableBalanceKobo: wallet.availableBalanceKobo, pendingBalanceKobo: wallet.pendingBalanceKobo,
      status: wallet.status,
    },
    payout: {
      automatic: true,
      minimumAmountKobo: MIN_AUTOMATIC_PAYOUT_KOBO,
      timezone: PAYOUT_TIMEZONE,
      serverTime: now.toISOString(),
      nextPayoutAt: nextPayoutMidnight(now).toISOString(),
      status: wallet.status !== "active" ? "paused"
        : wallet.pendingBalanceKobo > 0 ? "processing"
        : !bankAccount ? "bank_required"
        : wallet.availableBalanceKobo > 0 && wallet.availableBalanceKobo < MIN_AUTOMATIC_PAYOUT_KOBO ? "below_minimum"
        : wallet.availableBalanceKobo > 0 ? "scheduled" : "empty",
      bankAccount: bankAccount || null,
    },
  });
};

export const listTransactions = async (request: Request, response: Response): Promise<Response> => {
  const page = Number(request.query.page || 1);
  const limit = Number(request.query.limit || 20);
  const query: Record<string, unknown> = { userId: request.auth?.id };

  if (request.query.type) {
    query.type = request.query.type;
  }
  if (request.query.status) {
    query.status = request.query.status;
  }
  if (request.query.direction) {
    query.direction = request.query.direction;
  }

  const [transactions, total] = await Promise.all([
    TransactionModel.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    TransactionModel.countDocuments(query),
  ]);
  return sendSuccess(response, 200, "Transactions retrieved", {
    transactions,
    pagination: { page, limit, total },
  });
};

export const getTransaction = async (request: Request, response: Response): Promise<Response> => {
  const transaction = await TransactionModel.findOne({
    _id: (request.params.id as string),
    userId: request.auth?.id,
  });

  if (!transaction) {
    throw new AppError(404, "Transaction was not found", "TRANSACTION_NOT_FOUND");
  }

  return sendSuccess(response, 200, "Transaction retrieved", { transaction });
};

export const verifyTopup = async (request: Request, response: Response): Promise<Response> => {
  const transaction = await TransactionModel.findOne({
    providerReference: (request.params.reference as string),
    userId: request.auth?.id,
    type: "topup",
  });

  if (!transaction) {
    throw new AppError(404, "Top-up transaction was not found", "TRANSACTION_NOT_FOUND");
  }

  const provider = await verifyPaystackTransaction((request.params.reference as string));
  const totalPayableKobo = transaction.amountKobo + (transaction.feeKobo || 0);
  const providerAmountKobo = provider.amount;
  const amountMatches = matchesPaystackSettlement(providerAmountKobo, provider.fees, totalPayableKobo);

  if (provider.status !== "success" || typeof providerAmountKobo !== "number" || !amountMatches) {
    if (!amountMatches) {
      logger.warn({
        operation: "verify_wallet_topup",
        transactionId: transaction._id.toString(),
        expectedAmountKobo: totalPayableKobo,
        providerAmountKobo,
        paystackFeeKobo: provider.fees,
        walletCreditKobo: transaction.amountKobo,
        depositFeeKobo: transaction.feeKobo || 0,
      }, "Paystack top-up amount mismatch");
    }
    throw new AppError(409, "Payment is not confirmed", "PAYMENT_NOT_CONFIRMED");
  }

  await creditVerifiedTopup(transaction.reference, providerAmountKobo, provider.fees);
  const refreshed = await TransactionModel.findById(transaction._id);
  return sendSuccess(response, 200, "Top-up verified", { transaction: refreshed });
};

export const creditVerifiedTopup = async (
  reference: string,
  providerAmount: number,
  paystackFeeKobo?: number | null,
): Promise<void> => {
  const session = await mongoose.startSession();
  let receipt: {
    userId: string;
    walletCreditKobo: number;
    depositFeeKobo: number;
    amountPaidKobo: number;
    paystackFeeKobo: number;
  } | undefined;

  try {
    await session.withTransaction(async () => {
      receipt = undefined;
      const transaction = await TransactionModel.findOne({
        providerReference: reference,
        type: "topup",
      }).session(session);

      if (!transaction || transaction.status === "successful") {
        return;
      }

      const feeKobo = transaction.feeKobo || 0;
      const totalPayableKobo = transaction.amountKobo + feeKobo;

      if (!matchesPaystackSettlement(providerAmount, paystackFeeKobo, totalPayableKobo)) {
        logger.warn({
          operation: "credit_verified_topup",
          transactionId: transaction._id.toString(),
          expectedAmountKobo: totalPayableKobo,
          providerAmountKobo: providerAmount,
          paystackFeeKobo,
          walletCreditKobo: transaction.amountKobo,
          depositFeeKobo: feeKobo,
        }, "Paystack top-up amount mismatch");
        throw new AppError(409, "Payment amount does not match", "PAYMENT_AMOUNT_MISMATCH");
      }

      const wallet = await WalletModel.findOneAndUpdate(
        { _id: transaction.walletId, status: "active" },
        walletCreditUpdate(transaction.amountKobo),
        { new: true, session, updatePipeline: true },
      );

      if (!wallet) {
        throw new AppError(409, "Wallet cannot receive funds", "WALLET_UNAVAILABLE");
      }

      transaction.status = "successful";
      transaction.completedAt = new Date();
      await transaction.save({ session });
      await recordPlatformEarning({
        sourceType: "deposit",
        sourceReference: transaction.reference,
        payerUserId: transaction.userId,
        transactionId: transaction._id,
        grossAmountKobo: totalPayableKobo,
        feeAmountKobo: feeKobo,
        netAmountKobo: transaction.amountKobo,
        session,
      });
      receipt = {
        userId: transaction.userId.toString(),
        walletCreditKobo: transaction.amountKobo,
        depositFeeKobo: feeKobo,
        amountPaidKobo: providerAmount,
        paystackFeeKobo: paystackFeeKobo ?? 0,
      };
    });
  } finally {
    await session.endSession();
  }

  if (receipt) {
    const details = [
      { label: "Wallet credit", value: formatNaira(receipt.walletCreditKobo) },
      { label: "Deposit fee", value: formatNaira(receipt.depositFeeKobo) },
    ];
    if (receipt.paystackFeeKobo > 0) {
      details.push({ label: "Paystack processing fee", value: formatNaira(receipt.paystackFeeKobo) });
    }
    await sendPaymentReceiptEmail({
      userId: receipt.userId,
      subject: "Your wallet top-up is confirmed",
      heading: "Wallet top-up confirmed",
      amountPaidKobo: receipt.amountPaidKobo,
      details,
    });
  }
};

export const listBanks = async (_request: Request, response: Response): Promise<Response> => {
  const banks = await getActiveWalletBanks();
  return sendSuccess(response, 200, "Banks retrieved", { banks });
};

export const resolveBankAccount = async (request: Request, response: Response): Promise<Response> => {
  const resolution = await resolveWalletBankAccount(request.body.accountNumber, request.body.bankCode);
  return sendSuccess(response, 200, "Bank account resolved", { resolution });
};

export const addBankAccount = async (request: Request, response: Response): Promise<Response> => {
  const { accountNumber, bankCode } = request.body;
  const fingerprint = sha256(`${request.auth?.id}:${bankCode}:${accountNumber}`);
  const existing = await BankAccountModel.findOne({
    userId: request.auth?.id,
    accountFingerprint: fingerprint,
    active: true,
  });

  if (existing) {
    return sendSuccess(response, 200, "Bank account already saved", { bankAccount: existing });
  }

  const resolved = await resolveWalletBankAccount(accountNumber, bankCode);

  const recipient = await createPaystackTransferRecipient({
    name: resolved.accountName,
    accountNumber,
    bankCode,
  });
  // Reactivate a previously removed account without colliding with its unique
  // fingerprint. Relinking must work when a daily reminder prompts the user.
  const bankAccount = await BankAccountModel.findOneAndUpdate({
    userId: request.auth?.id, accountFingerprint: fingerprint,
  }, { $set: {
    userId: request.auth?.id,
    bankCode,
    bankName: resolved.bankName,
    accountName: resolved.accountName,
    encryptedAccountNumber: encryptField(accountNumber),
    maskedAccountNumber: maskAccountNumber(accountNumber),
    accountFingerprint: fingerprint,
    paystackRecipientCode: recipient.recipient_code,
    active: true,
  } }, { upsert: true, new: true, runValidators: true });
  return sendSuccess(response, 201, "Bank account saved", { bankAccount });
};

export const listBankAccounts = async (request: Request, response: Response): Promise<Response> => {
  const bankAccounts = await BankAccountModel.find({ userId: request.auth?.id, active: true })
    .sort({ isDefault: -1, createdAt: 1, _id: 1 });
  return sendSuccess(response, 200, "Bank accounts retrieved", { bankAccounts });
};

export const removeBankAccount = async (request: Request, response: Response): Promise<Response> => {
  const result = await BankAccountModel.updateOne(
    { _id: (request.params.id as string), userId: request.auth?.id },
    { active: false, isDefault: false },
  );

  if (result.modifiedCount === 0) {
    throw new AppError(404, "Bank account was not found", "BANK_ACCOUNT_NOT_FOUND");
  }

  return sendSuccess(response, 200, "Bank account removed");
};

export const finalizeWithdrawal = async (request: Request, response: Response): Promise<Response> => {
  const transaction = await TransactionModel.findOne({
    reference: (request.params.reference as string),
    userId: request.auth?.id,
    type: "withdrawal",
    status: "processing",
  });

  if (!transaction) {
    throw new AppError(404, "Pending withdrawal was not found", "WITHDRAWAL_NOT_FOUND");
  }

  const metadata = transaction.metadata as { transferCode?: string };
  if (!metadata.transferCode) {
    throw new AppError(409, "Withdrawal is not awaiting OTP", "WITHDRAWAL_NOT_AWAITING_OTP");
  }

  await finalizePaystackTransfer(metadata.transferCode, request.body.otp);
  return sendSuccess(response, 202, "Withdrawal OTP accepted", { transaction });
};

export { completeWithdrawal, refundWithdrawal } from "../utils/walletSettlement.utils";
