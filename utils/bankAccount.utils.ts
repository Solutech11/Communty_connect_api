import { z } from "zod";
import { CACHE_KEYS } from "../Constant";
import { redisClient } from "../DB/redis";
import { AppError } from "./AppError";
import { maskAccountNumber } from "./crypto.utils";
import { listPaystackBanks, resolvePaystackAccount } from "./paystack.utils";

const bankSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().min(1),
  active: z.boolean(),
  currency: z.string(),
}).passthrough();

export type WalletBank = z.infer<typeof bankSchema>;

export const getActiveWalletBanks = async (): Promise<WalletBank[]> => {
  if (redisClient.isReady) {
    const cached = await redisClient.get(CACHE_KEYS.banks);
    if (cached) {
      try {
        const parsed = z.array(bankSchema).safeParse(JSON.parse(cached));
        if (parsed.success) {
          return parsed.data.filter((bank) => bank.active && bank.currency === "NGN" && /^\d{3,6}$/.test(bank.code));
        }
      } catch {
        // Refresh malformed cache data without logging provider payloads.
      }
    }
  }
  const parsed = z.array(bankSchema).safeParse(await listPaystackBanks());
  if (!parsed.success) {
    throw new AppError(502, "Bank list is temporarily unavailable", "INVALID_BANK_PROVIDER_RESPONSE");
  }
  const banks = parsed.data.filter((bank) => bank.active && bank.currency === "NGN" && /^\d{3,6}$/.test(bank.code));
  if (redisClient.isReady) {
    await redisClient.set(CACHE_KEYS.banks, JSON.stringify(banks), { EX: 24 * 60 * 60 });
  }
  return banks;
};

export const resolveWalletBankAccount = async (accountNumber: string, bankCode: string) => {
  const bank = (await getActiveWalletBanks()).find((item) => item.code === bankCode);
  if (!bank) {
    throw new AppError(422, "Bank code is invalid or inactive", "INVALID_BANK_CODE");
  }
  const resolved = z.object({
    account_name: z.string().trim().min(1).max(200),
    account_number: z.string().regex(/^\d{10}$/),
  }).safeParse(await resolvePaystackAccount(accountNumber, bankCode));
  if (!resolved.success || resolved.data.account_number !== accountNumber) {
    throw new AppError(502, "Bank account could not be verified", "INVALID_BANK_PROVIDER_RESPONSE");
  }
  // A name preview creates no recipient or bank record. Saving re-resolves
  // with Paystack so a client cannot supply or substitute the account name.
  return {
    bankCode: bank.code,
    bankName: bank.name,
    accountName: resolved.data.account_name,
    maskedAccountNumber: maskAccountNumber(accountNumber),
  };
};
