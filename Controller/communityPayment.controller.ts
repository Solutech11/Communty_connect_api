import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { CACHE_KEYS } from "../Constant";
import { env } from "../Config/env";
import { CommunityModel } from "../models/Community/Community.model";
import { CommunityMembershipOrderModel } from "../models/Community/CommunityMembershipOrder.model";
import { TransactionModel } from "../models/Wallet/Transaction.model";
import { WalletModel } from "../models/Wallet/Wallet.model";
import { AppError } from "../utils/AppError";
import { calculatePlatformCharge, recordPlatformEarning } from "../utils/platformCharge.utils";
import {
  initializePaystackTransaction,
  verifyPaystackTransaction,
} from "../utils/paystack.utils";
import { withRedisLock } from "../utils/redisLock.utils";
import { sendSuccess } from "../utils/response.utils";

const membershipReference = (): string => `community_${randomUUID()}`.toLowerCase();
const membershipOrderNumber = (): string => {
  return `CCM-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
};

export const createCommunityMembershipOrder = async (
  request: Request,
  response: Response,
): Promise<Response> => {
  const userId = request.auth?.id as string;
  const idempotencyKey = request.idempotencyKey as string;

  return withRedisLock(CACHE_KEYS.lock("community-membership", userId), async () => {
    const existing = await CommunityMembershipOrderModel.findOne({
      buyerId: userId,
      idempotencyKey,
    }).select("+checkoutUrl");

    if (existing) {
      return sendSuccess(response, 200, "Community membership checkout already initialized", {
        order: existing,
        checkoutUrl: existing.checkoutUrl,
      });
    }

    const community = await CommunityModel.findOne({
      _id: request.params.id as string,
      membershipType: "premium",
      visibility: "public",
    });

    if (!community) {
      throw new AppError(404, "Premium community was not found", "PREMIUM_COMMUNITY_NOT_FOUND");
    }

    if (
      community.ownerId.toString() === userId
      || community.members.some((memberId) => memberId.toString() === userId)
    ) {
      throw new AppError(409, "You already belong to this community", "COMMUNITY_ALREADY_JOINED");
    }

    const [buyerWallet, ownerWallet] = await Promise.all([
      WalletModel.findOne({ userId, status: "active" }),
      WalletModel.findOne({ userId: community.ownerId, status: "active" }),
    ]);

    if (!buyerWallet || !ownerWallet) {
      throw new AppError(409, "A required wallet is unavailable", "WALLET_UNAVAILABLE");
    }

    const grossAmountKobo = community.membershipPriceKobo;
    const platformFeeKobo = calculatePlatformCharge(
      grossAmountKobo,
      "community_membership",
    );
    const ownerProceedsKobo = grossAmountKobo - platformFeeKobo;
    const reference = membershipReference();
    let order;

    try {
      order = await CommunityMembershipOrderModel.create({
        orderNumber: membershipOrderNumber(),
        communityId: community._id,
        buyerId: userId,
        ownerId: community.ownerId,
        grossAmountKobo,
        platformFeeKobo,
        ownerProceedsKobo,
        paymentReference: reference,
        idempotencyKey,
      });

      await TransactionModel.create({
        reference,
        providerReference: reference,
        walletId: buyerWallet._id,
        userId,
        counterpartyUserId: community.ownerId,
        type: "community_purchase",
        direction: "debit",
        amountKobo: grossAmountKobo,
        feeKobo: platformFeeKobo,
        status: "pending",
        title: `Premium membership: ${community.name}`,
        description: "Premium community membership purchase",
        provider: "paystack",
        idempotencyKey,
        metadata: {
          orderId: order._id.toString(),
          communityId: community._id.toString(),
          ownerUserId: community.ownerId.toString(),
          ownerProceedsKobo,
        },
      });

      const checkout = await initializePaystackTransaction({
        email: request.auth?.email as string,
        amountKobo: grossAmountKobo,
        reference,
        metadata: {
          purpose: "community_membership",
          orderId: order._id.toString(),
          communityId: community._id.toString(),
          userId,
        },
      });
      order.checkoutUrl = checkout.authorization_url;
      await order.save();

      const safeOrder = await CommunityMembershipOrderModel.findById(order._id);
      return sendSuccess(response, 201, "Community membership checkout initialized", {
        order: safeOrder,
        checkoutUrl: checkout.authorization_url,
        accessCode: checkout.access_code,
        publicKey: env.PAYSTACK_PUBLIC_KEY,
        charge: { grossAmountKobo, platformFeeKobo, ownerProceedsKobo },
      });
    } catch (error) {
      await Promise.all([
        order
          ? CommunityMembershipOrderModel.updateOne(
              { _id: order._id, status: "pending" },
              { status: "cancelled" },
            )
          : Promise.resolve(),
        TransactionModel.updateOne({ reference }, { status: "failed" }),
      ]);
      throw error;
    }
  });
};

export const completeCommunityMembershipOrder = async (
  reference: string,
  providerAmount?: number,
): Promise<void> => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const order = await CommunityMembershipOrderModel.findOne({
        paymentReference: reference,
        status: "pending",
      }).session(session);

      if (!order) {
        return;
      }

      if (providerAmount !== undefined && providerAmount !== order.grossAmountKobo) {
        throw new AppError(
          409,
          "Community membership payment amount does not match",
          "PAYMENT_AMOUNT_MISMATCH",
        );
      }

      const transaction = await TransactionModel.findOne({
        providerReference: reference,
        type: "community_purchase",
        status: "pending",
      }).session(session);

      if (!transaction) {
        throw new AppError(409, "Membership transaction is unavailable", "TRANSACTION_UNAVAILABLE");
      }

      const ownerWallet = await WalletModel.findOneAndUpdate(
        { userId: order.ownerId, status: "active" },
        { $inc: { availableBalanceKobo: order.ownerProceedsKobo } },
        { new: true, session },
      );

      if (!ownerWallet) {
        throw new AppError(409, "Community owner wallet is unavailable", "OWNER_WALLET_UNAVAILABLE");
      }

      const membershipResult = await CommunityModel.updateOne(
        { _id: order.communityId, membershipType: "premium" },
        { $addToSet: { members: order.buyerId } },
        { session },
      );

      if (membershipResult.matchedCount !== 1) {
        throw new AppError(409, "Premium community is unavailable", "COMMUNITY_UNAVAILABLE");
      }

      order.status = "paid";
      order.paidAt = new Date();
      await order.save({ session });
      transaction.status = "successful";
      transaction.completedAt = new Date();
      await transaction.save({ session });
      await recordPlatformEarning({
        sourceType: "community_membership",
        sourceReference: reference,
        payerUserId: order.buyerId,
        beneficiaryUserId: order.ownerId,
        transactionId: transaction._id,
        grossAmountKobo: order.grossAmountKobo,
        feeAmountKobo: order.platformFeeKobo,
        netAmountKobo: order.ownerProceedsKobo,
        metadata: {
          orderId: order._id.toString(),
          communityId: order.communityId.toString(),
        },
        session,
      });
    });
  } finally {
    await session.endSession();
  }
};

export const verifyCommunityMembershipOrder = async (
  request: Request,
  response: Response,
): Promise<Response> => {
  const order = await CommunityMembershipOrderModel.findOne({
    orderNumber: request.params.orderNumber as string,
    buyerId: request.auth?.id,
  });

  if (!order) {
    throw new AppError(404, "Membership order was not found", "MEMBERSHIP_ORDER_NOT_FOUND");
  }

  if (order.status !== "paid") {
    const provider = await verifyPaystackTransaction(order.paymentReference);

    if (provider.status !== "success" || provider.amount !== order.grossAmountKobo) {
      throw new AppError(409, "Membership payment is not confirmed", "PAYMENT_NOT_CONFIRMED");
    }

    await completeCommunityMembershipOrder(order.paymentReference, provider.amount);
  }

  const refreshed = await CommunityMembershipOrderModel.findById(order._id)
    .populate("communityId", "name slug imageUrl");
  return sendSuccess(response, 200, "Community membership verified", { order: refreshed });
};
