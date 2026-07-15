import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { DisputeModel } from "../models/Dispute/Dispute.model";
import { TransactionModel } from "../models/Wallet/Transaction.model";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/response.utils";

const disputeNumber = (): string => `DSP-${Date.now()}-${randomBytes(3).toString("hex").toUpperCase()}`;

export const createDispute = async (request: Request, response: Response): Promise<Response> => {
  if (request.body.transactionId) {
    const transaction = await TransactionModel.exists({
      _id: request.body.transactionId,
      userId: request.auth?.id,
    });
    if (!transaction) {
      throw new AppError(404, "Transaction was not found", "TRANSACTION_NOT_FOUND");
    }
  }

  const dispute = await DisputeModel.create({
    ...request.body,
    userId: request.auth?.id,
    disputeNumber: disputeNumber(),
  });
  return sendSuccess(response, 201, "Dispute submitted", { dispute });
};

export const listDisputes = async (request: Request, response: Response): Promise<Response> => {
  const query: Record<string, unknown> = {};

  if (request.auth?.role === "admin" && request.query.status) {
    query.status = request.query.status as string;
  } else if (request.auth?.role !== "admin") {
    query.userId = request.auth?.id;
  }
  const disputes = await DisputeModel.find(query).sort({ createdAt: -1 }).limit(100);
  return sendSuccess(response, 200, "Disputes retrieved", { disputes });
};

export const getDispute = async (request: Request, response: Response): Promise<Response> => {
  const query: Record<string, unknown> = { _id: (request.params.id as string) };

  if (request.auth?.role !== "admin") {
    query.userId = request.auth?.id;
  }

  const dispute = await DisputeModel.findOne(query)
    .populate("messages.authorId", "firstName lastName avatarUrl role")
    .populate("transactionId");

  if (!dispute) {
    throw new AppError(404, "Dispute was not found", "DISPUTE_NOT_FOUND");
  }

  return sendSuccess(response, 200, "Dispute retrieved", { dispute });
};

export const replyToDispute = async (request: Request, response: Response): Promise<Response> => {
  const query: Record<string, unknown> = { _id: (request.params.id as string) };

  if (request.auth?.role !== "admin") {
    query.userId = request.auth?.id;
  }

  const dispute = await DisputeModel.findOne(query);

  if (!dispute || ["resolved", "closed"].includes(dispute.status)) {
    throw new AppError(409, "This dispute cannot receive replies", "DISPUTE_NOT_REPLYABLE");
  }

  dispute.messages.push({
    authorId: request.auth?.id as never,
    message: request.body.message,
    attachments: request.body.attachments || [],
    internal: request.auth?.role === "admin" && Boolean(request.body.internal),
  } as never);
  dispute.status = request.auth?.role === "admin" ? "awaiting_user" : "under_review";
  await dispute.save();
  return sendSuccess(response, 201, "Dispute reply added", { dispute });
};

export const updateDisputeStatus = async (
  request: Request,
  response: Response,
): Promise<Response> => {
  const update: Record<string, unknown> = {
    status: request.body.status,
    resolution: request.body.resolution,
  };

  if (["resolved", "closed"].includes(request.body.status)) {
    update.resolvedAt = new Date();
  }

  const dispute = await DisputeModel.findByIdAndUpdate((request.params.id as string), update, {
    new: true,
    runValidators: true,
  });

  if (!dispute) {
    throw new AppError(404, "Dispute was not found", "DISPUTE_NOT_FOUND");
  }

  return sendSuccess(response, 200, "Dispute status updated", { dispute });
};


