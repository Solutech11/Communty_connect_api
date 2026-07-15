import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { CACHE_KEYS } from "../Constant";
import { env } from "../Config/env";
import { redisClient } from "../DB/redis";
import { UserModel } from "../models/Auth/User.model";
import { BankAccountModel } from "../models/Wallet/BankAccount.model";
import { TransactionModel } from "../models/Wallet/Transaction.model";
import { WalletModel } from "../models/Wallet/Wallet.model";
import { AppError } from "../utils/AppError";
import { encryptField, maskAccountNumber, sha256 } from "../utils/crypto.utils";
import { paystackClient } from "../utils/paystack.utils";
import { withRedisLock } from "../utils/redisLock.utils";
import { sendSuccess } from "../utils/response.utils";

const financialReference = (prefix: string): string => {
  return `${prefix}_${randomUUID()}`.toLowerCase();
};

export const getWallet = async (request: Request, response: Response): Promise<Response> => {
  const wallet = await WalletModel.findOne({ userId: request.auth?.id });

  if (!wallet) {
    throw new AppError(404, "Wallet was not found", "WALLET_NOT_FOUND");
  }

  return sendSuccess(response, 200, "Wallet retrieved", { wallet });
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

export const initializeTopup = async (request: Request, response: Response): Promise<Response> => {
  const amountKobo = request.body.amountKobo;

  if (amountKobo < env.MIN_TOPUP_KOBO) {
    throw new AppError(422, `Minimum top-up is ${env.MIN_TOPUP_KOBO} kobo`, "TOPUP_BELOW_MINIMUM");
  }

  const wallet = await WalletModel.findOne({ userId: request.auth?.id, status: "active" });

  if (!wallet) {
    throw new AppError(404, "Active wallet was not found", "WALLET_NOT_FOUND");
  }

  const idempotencyKey = request.idempotencyKey as string;
  const existing = await TransactionModel.findOne({ userId: request.auth?.id, idempotencyKey });

  if (existing) {
    return sendSuccess(response, 200, "Top-up already initialized", { transaction: existing });
  }

  const reference = financialReference("topup");
  const transaction = await TransactionModel.create({
    reference,
    providerReference: reference,
    walletId: wallet._id,
    userId: request.auth?.id,
    type: "topup",
    direction: "credit",
    amountKobo,
    status: "pending",
    title: "Wallet top-up",
    description: "Wallet funding through Paystack",
    provider: "paystack",
    idempotencyKey,
  });

  try {
    const provider = await paystackClient.initializeTransaction({
      email: request.auth?.email as string,
      amountKobo,
      reference,
      metadata: {
        transactionId: transaction._id.toString(),
        userId: request.auth?.id,
        walletId: wallet._id.toString(),
        purpose: "wallet_topup",
      },
    });
    return sendSuccess(response, 201, "Top-up initialized", {
      transaction,
      authorizationUrl: provider.authorization_url,
      accessCode: provider.access_code,
      reference: provider.reference,
      publicKey: env.PAYSTACK_PUBLIC_KEY,
    });
  } catch (error) {
    transaction.status = "failed";
    await transaction.save();
    throw error;
  }
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

  const provider = await paystackClient.verifyTransaction((request.params.reference as string));

  if (provider.status !== "success" || provider.amount !== transaction.amountKobo) {
    throw new AppError(409, "Payment is not confirmed", "PAYMENT_NOT_CONFIRMED");
  }

  await creditVerifiedTopup(transaction.reference, provider.amount);
  const refreshed = await TransactionModel.findById(transaction._id);
  return sendSuccess(response, 200, "Top-up verified", { transaction: refreshed });
};

export const creditVerifiedTopup = async (reference: string, providerAmount?: number): Promise<void> => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const transaction = await TransactionModel.findOne({
        providerReference: reference,
        type: "topup",
      }).session(session);

      if (!transaction || transaction.status === "successful") {
        return;
      }

      if (providerAmount !== undefined && providerAmount !== transaction.amountKobo) {
        throw new AppError(409, "Payment amount does not match", "PAYMENT_AMOUNT_MISMATCH");
      }

      const wallet = await WalletModel.findOneAndUpdate(
        { _id: transaction.walletId, status: "active" },
        { $inc: { availableBalanceKobo: transaction.amountKobo } },
        { new: true, session },
      );

      if (!wallet) {
        throw new AppError(409, "Wallet cannot receive funds", "WALLET_UNAVAILABLE");
      }

      transaction.status = "successful";
      transaction.completedAt = new Date();
      await transaction.save({ session });
    });
  } finally {
    await session.endSession();
  }
};

export const listBanks = async (_request: Request, response: Response): Promise<Response> => {
  if (redisClient.isReady) {
    const cached = await redisClient.get(CACHE_KEYS.banks);
    if (cached) {
      return sendSuccess(response, 200, "Banks retrieved", { banks: JSON.parse(cached) });
    }
  }

  const banks = (await paystackClient.listBanks()).filter((bank) => bank.active);

  if (redisClient.isReady) {
    await redisClient.set(CACHE_KEYS.banks, JSON.stringify(banks), { EX: 24 * 60 * 60 });
  }

  return sendSuccess(response, 200, "Banks retrieved", { banks });
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

  const [resolved, banks] = await Promise.all([
    paystackClient.resolveAccount(accountNumber, bankCode),
    paystackClient.listBanks(),
  ]);
  const bank = banks.find((item) => item.code === bankCode);

  if (!bank) {
    throw new AppError(422, "Bank code is invalid", "INVALID_BANK_CODE");
  }

  const recipient = await paystackClient.createTransferRecipient({
    name: resolved.account_name,
    accountNumber,
    bankCode,
  });
  const bankAccount = await BankAccountModel.create({
    userId: request.auth?.id,
    bankCode,
    bankName: bank.name,
    accountName: resolved.account_name,
    encryptedAccountNumber: encryptField(accountNumber),
    maskedAccountNumber: maskAccountNumber(accountNumber),
    accountFingerprint: fingerprint,
    paystackRecipientCode: recipient.recipient_code,
  });
  return sendSuccess(response, 201, "Bank account saved", { bankAccount });
};

export const listBankAccounts = async (request: Request, response: Response): Promise<Response> => {
  const bankAccounts = await BankAccountModel.find({ userId: request.auth?.id, active: true });
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

export const internalTransfer = async (request: Request, response: Response): Promise<Response> => {
  const userId = request.auth?.id as string;
  const amountKobo = request.body.amountKobo;
  const idempotencyKey = request.idempotencyKey as string;

  return withRedisLock(CACHE_KEYS.lock("wallet-transfer", userId), async () => {
    const existing = await TransactionModel.findOne({ userId, idempotencyKey });
    if (existing) {
      return sendSuccess(response, 200, "Transfer already processed", { transaction: existing });
    }

    const recipientUser = request.body.recipient.includes("@")
      ? await UserModel.findOne({ email: request.body.recipient.toLowerCase(), status: "active" })
      : await WalletModel.findOne({ walletNumber: request.body.recipient, status: "active" })
          .then((wallet) => wallet ? UserModel.findById(wallet.userId) : null);

    if (!recipientUser || recipientUser._id.toString() === userId) {
      throw new AppError(422, "Recipient is invalid", "INVALID_TRANSFER_RECIPIENT");
    }

    const session = await mongoose.startSession();
    let debitTransactionId: string | undefined;

    try {
      await session.withTransaction(async () => {
        const senderWallet = await WalletModel.findOneAndUpdate(
          { userId, status: "active", availableBalanceKobo: { $gte: amountKobo } },
          { $inc: { availableBalanceKobo: -amountKobo } },
          { new: true, session },
        );

        if (!senderWallet) {
          throw new AppError(422, "Wallet balance is insufficient", "INSUFFICIENT_BALANCE");
        }

        const recipientWallet = await WalletModel.findOneAndUpdate(
          { userId: recipientUser._id, status: "active" },
          { $inc: { availableBalanceKobo: amountKobo } },
          { new: true, session },
        );

        if (!recipientWallet) {
          throw new AppError(409, "Recipient wallet is unavailable", "RECIPIENT_WALLET_UNAVAILABLE");
        }

        const baseReference = financialReference("transfer");
        const [debit] = await TransactionModel.create(
          [
            {
              reference: `${baseReference}_debit`,
              walletId: senderWallet._id,
              userId,
              counterpartyUserId: recipientUser._id,
              type: "internal_transfer",
              direction: "debit",
              amountKobo,
              status: "successful",
              title: "Wallet transfer",
              description: request.body.note,
              provider: "internal",
              idempotencyKey,
              completedAt: new Date(),
            },
          ],
          { session },
        );
        await TransactionModel.create(
          [
            {
              reference: `${baseReference}_credit`,
              walletId: recipientWallet._id,
              userId: recipientUser._id,
              counterpartyUserId: userId,
              type: "internal_transfer",
              direction: "credit",
              amountKobo,
              status: "successful",
              title: "Wallet transfer received",
              description: request.body.note,
              provider: "internal",
              idempotencyKey: `${idempotencyKey}_recipient`,
              completedAt: new Date(),
            },
          ],
          { session },
        );
        debitTransactionId = debit?._id.toString();
      });
    } finally {
      await session.endSession();
    }

    const transaction = await TransactionModel.findById(debitTransactionId);
    return sendSuccess(response, 201, "Transfer completed", { transaction });
  });
};

export const withdraw = async (request: Request, response: Response): Promise<Response> => {
  const userId = request.auth?.id as string;
  const amountKobo = request.body.amountKobo;
  const idempotencyKey = request.idempotencyKey as string;

  if (amountKobo < env.MIN_WITHDRAWAL_KOBO) {
    throw new AppError(
      422,
      `Minimum withdrawal is ${env.MIN_WITHDRAWAL_KOBO} kobo`,
      "WITHDRAWAL_BELOW_MINIMUM",
    );
  }

  return withRedisLock(CACHE_KEYS.lock("wallet-withdrawal", userId), async () => {
    const existing = await TransactionModel.findOne({ userId, idempotencyKey });
    if (existing) {
      return sendSuccess(response, 200, "Withdrawal already submitted", { transaction: existing });
    }

    const bankAccount = await BankAccountModel.findOne({
      _id: request.body.bankAccountId,
      userId,
      active: true,
    });
    if (!bankAccount) {
      throw new AppError(404, "Bank account was not found", "BANK_ACCOUNT_NOT_FOUND");
    }

    const reference = financialReference("withdrawal");
    const session = await mongoose.startSession();
    let transactionId: string | undefined;

    try {
      await session.withTransaction(async () => {
        const wallet = await WalletModel.findOneAndUpdate(
          { userId, status: "active", availableBalanceKobo: { $gte: amountKobo } },
          { $inc: { availableBalanceKobo: -amountKobo, pendingBalanceKobo: amountKobo } },
          { new: true, session },
        );

        if (!wallet) {
          throw new AppError(422, "Wallet balance is insufficient", "INSUFFICIENT_BALANCE");
        }

        const [transaction] = await TransactionModel.create(
          [
            {
              reference,
              providerReference: reference,
              walletId: wallet._id,
              userId,
              type: "withdrawal",
              direction: "debit",
              amountKobo,
              status: "processing",
              title: "Wallet withdrawal",
              description: `Withdrawal to ${bankAccount.bankName} ${bankAccount.maskedAccountNumber}`,
              provider: "paystack",
              idempotencyKey,
              metadata: { bankAccountId: bankAccount._id.toString(), refundApplied: false },
            },
          ],
          { session },
        );
        transactionId = transaction?._id.toString();
      });
    } finally {
      await session.endSession();
    }

    const transaction = await TransactionModel.findById(transactionId);

    try {
      const provider = await paystackClient.initiateTransfer({
        amountKobo,
        recipientCode: bankAccount.paystackRecipientCode as string,
        reference,
        reason: "Community Connect wallet withdrawal",
      });
      await TransactionModel.updateOne(
        { _id: transaction?._id },
        { $set: { "metadata.transferCode": provider.transfer_code, "metadata.providerStatus": provider.status } },
      );
      const refreshed = await TransactionModel.findById(transaction?._id);
      return sendSuccess(response, 202, "Withdrawal submitted", { transaction: refreshed });
    } catch (error) {
      await refundWithdrawal(reference, "provider_initialization_failed");
      throw error;
    }
  });
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

  await paystackClient.finalizeTransfer(metadata.transferCode, request.body.otp);
  return sendSuccess(response, 202, "Withdrawal OTP accepted", { transaction });
};

export const completeWithdrawal = async (reference: string): Promise<void> => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const transaction = await TransactionModel.findOne({
        reference,
        type: "withdrawal",
        status: { $in: ["pending", "processing"] },
      }).session(session);

      if (!transaction) {
        return;
      }

      await WalletModel.updateOne(
        { _id: transaction.walletId, pendingBalanceKobo: { $gte: transaction.amountKobo } },
        { $inc: { pendingBalanceKobo: -transaction.amountKobo } },
        { session },
      );
      transaction.status = "successful";
      transaction.completedAt = new Date();
      await transaction.save({ session });
    });
  } finally {
    await session.endSession();
  }
};

export const refundWithdrawal = async (reference: string, reason: string): Promise<void> => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const transaction = await TransactionModel.findOne({
        reference,
        type: "withdrawal",
        status: { $in: ["pending", "processing"] },
        "metadata.refundApplied": { $ne: true },
      }).session(session);

      if (!transaction) {
        return;
      }

      await WalletModel.updateOne(
        { _id: transaction.walletId, pendingBalanceKobo: { $gte: transaction.amountKobo } },
        {
          $inc: {
            pendingBalanceKobo: -transaction.amountKobo,
            availableBalanceKobo: transaction.amountKobo,
          },
        },
        { session },
      );
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


