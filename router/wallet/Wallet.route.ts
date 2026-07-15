import { Router } from "express";
import { z } from "zod";
import {
  addBankAccount,
  finalizeWithdrawal,
  getTransaction,
  getWallet,
  initializeTopup,
  internalTransfer,
  listBankAccounts,
  listBanks,
  listTransactions,
  removeBankAccount,
  verifyTopup,
  withdraw,
} from "../../Controller/wallet.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireIdempotencyKey } from "../../middleware/idempotency.middleware";
import { validate } from "../../middleware/validate.middleware";
import { idParamsSchema, moneyKoboSchema } from "../../schemas/common.schemas";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();
router.use(authenticate);
router.get("/", asyncHandler(getWallet));
router.get(
  "/transactions",
  validate({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      type: z.enum(["topup", "internal_transfer", "withdrawal", "ticket_purchase", "refund", "adjustment"]).optional(),
      status: z.enum(["pending", "processing", "successful", "failed", "reversed"]).optional(),
      direction: z.enum(["credit", "debit"]).optional(),
    }),
  }),
  asyncHandler(listTransactions),
);
router.get("/transactions/:id", validate({ params: idParamsSchema }), asyncHandler(getTransaction));
router.post(
  "/topups",
  requireIdempotencyKey,
  validate({ body: z.object({ amountKobo: moneyKoboSchema }).strict() }),
  asyncHandler(initializeTopup),
);
router.get(
  "/topups/:reference/verify",
  validate({ params: z.object({ reference: z.string().min(16).max(80) }) }),
  asyncHandler(verifyTopup),
);
router.get("/banks", asyncHandler(listBanks));
router.get("/bank-accounts", asyncHandler(listBankAccounts));
router.post(
  "/bank-accounts",
  validate({
    body: z.object({
      accountNumber: z.string().regex(/^\d{10}$/),
      bankCode: z.string().regex(/^\d{3,6}$/),
    }).strict(),
  }),
  asyncHandler(addBankAccount),
);
router.delete("/bank-accounts/:id", validate({ params: idParamsSchema }), asyncHandler(removeBankAccount));
router.post(
  "/transfers",
  requireIdempotencyKey,
  validate({
    body: z.object({
      recipient: z.string().trim().min(3).max(254),
      amountKobo: moneyKoboSchema,
      note: z.string().trim().max(200).optional(),
    }).strict(),
  }),
  asyncHandler(internalTransfer),
);
router.post(
  "/withdrawals",
  requireIdempotencyKey,
  validate({
    body: z.object({
      bankAccountId: z.string().regex(/^[a-fA-F0-9]{24}$/),
      amountKobo: moneyKoboSchema,
    }).strict(),
  }),
  asyncHandler(withdraw),
);
router.post(
  "/withdrawals/:reference/finalize",
  validate({
    params: z.object({ reference: z.string().min(16).max(80) }),
    body: z.object({ otp: z.string().regex(/^\d{6}$/) }).strict(),
  }),
  asyncHandler(finalizeWithdrawal),
);

export default router;
