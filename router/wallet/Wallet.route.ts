import { Router } from "express";
import { z } from "zod";
import {
  addBankAccount,
  finalizeWithdrawal,
  getTransaction,
  getWallet,
  listBankAccounts,
  listBanks,
  listTransactions,
  removeBankAccount,
  resolveBankAccount,
  verifyTopup,
} from "../../Controller/wallet.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validate.middleware";
import { idParamsSchema } from "../../schemas/common.schemas";
import { bankAccountDetailsSchema } from "../../schemas/bankAccount.schemas";
import { bankAccountResolutionRateLimiter } from "../../middleware/security.middleware";
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
      type: z.enum([
        "topup",
        "internal_transfer",
        "withdrawal",
        "ticket_purchase",
        "community_purchase",
        "refund",
        "adjustment",
      ]).optional(),
      status: z.enum(["pending", "processing", "successful", "failed", "reversed"]).optional(),
      direction: z.enum(["credit", "debit"]).optional(),
    }),
  }),
  asyncHandler(listTransactions),
);
router.get("/transactions/:id", validate({ params: idParamsSchema }), asyncHandler(getTransaction));
router.get(
  "/topups/:reference/verify",
  validate({ params: z.object({ reference: z.string().min(16).max(80) }) }),
  asyncHandler(verifyTopup),
);
router.get("/banks", asyncHandler(listBanks));
router.get("/bank-accounts", asyncHandler(listBankAccounts));
router.post(
  "/bank-accounts/resolve",
  bankAccountResolutionRateLimiter,
  validate({ body: bankAccountDetailsSchema }),
  asyncHandler(resolveBankAccount),
);
router.post(
  "/bank-accounts",
  validate({ body: bankAccountDetailsSchema }),
  asyncHandler(addBankAccount),
);
router.delete("/bank-accounts/:id", validate({ params: idParamsSchema }), asyncHandler(removeBankAccount));
router.post(
  "/withdrawals/:reference/finalize",
  validate({
    params: z.object({ reference: z.string().min(16).max(80) }),
    body: z.object({ otp: z.string().regex(/^\d{6}$/) }).strict(),
  }),
  asyncHandler(finalizeWithdrawal),
);

export default router;
