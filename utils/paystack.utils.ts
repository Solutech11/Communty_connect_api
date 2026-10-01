import axios from "axios";
import { env } from "../Config/env";
import { AppError } from "./AppError";
import { logger } from "./logger.utils";

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

export interface PaystackTransactionData {
  id?: number | string;
  authorization_url?: string;
  access_code?: string;
  reference: string;
  amount?: number;
  requested_amount?: number;
  fees?: number | null;
  currency?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  customer?: { email?: string };
}

interface PaystackInitializedTransaction extends PaystackTransactionData {
  authorization_url: string;
  access_code: string;
}

export interface PaystackRefundData {
  id: number | string;
  status: string;
  amount?: number;
  transaction?: number | string | { id?: number | string; reference?: string; amount?: number };
}

interface PaystackRecipientData {
  recipient_code: string;
  name: string;
  type: string;
  details?: {
    account_number?: string;
    bank_code?: string;
    bank_name?: string;
  };
}

export interface PaystackTransferData {
  transfer_code: string;
  reference: string;
  status: string;
  amount: number;
  currency: string;
}

export interface PaystackBank {
  name: string;
  code: string;
  currency: string;
  active: boolean;
  type: string;
}

// Provider transport only: wallet credits, amount checks, idempotency, locks,
// and MongoDB transactions remain in controllers where business state is known.
const paystack = axios.create({
  baseURL: env.PAYSTACK_BASE_URL,
  timeout: 15_000,
  headers: {
    Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
});

// Centralize provider error handling without logging request payloads. Payloads
// may contain account details, references, or other sensitive financial data.
const runPaystackRequest = async <T>(
  operation: string,
  request: () => Promise<{ data: PaystackEnvelope<T> }>,
): Promise<T> => {
  try {
    const response = await request();

    if (!response.data.status) {
      throw new AppError(502, "Payment provider rejected the request", "PAYSTACK_REJECTED");
    }

    return response.data.data;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.warn(
      {
        operation,
        provider: "paystack",
        providerStatus: axios.isAxiosError(error) ? error.response?.status : undefined,
      },
      "Paystack request failed",
    );
    throw new AppError(502, "Payment provider is unavailable", "PAYSTACK_UNAVAILABLE");
  }
};

export const initializePaystackTransaction = async (input: {
  email: string;
  amountKobo: number;
  reference: string;
  metadata: Record<string, unknown>;
  callbackUrl?: string;
}): Promise<PaystackInitializedTransaction> => {
  return runPaystackRequest("initialize_transaction", () =>
    paystack.post("/transaction/initialize", {
      email: input.email,
      // Paystack expects integer minor units; callers must never pass naira floats.
      amount: input.amountKobo,
      currency: env.PAYSTACK_CURRENCY,
      reference: input.reference,
      callback_url: input.callbackUrl || env.PAYSTACK_CALLBACK_URL,
      metadata: input.metadata,
    }),
  );
};

export const verifyPaystackTransaction = async (
  reference: string,
): Promise<PaystackTransactionData> => {
  return runPaystackRequest("verify_transaction", () =>
    // Encode references before placing client/provider-derived values in a URL.
    paystack.get(`/transaction/verify/${encodeURIComponent(reference)}`),
  );
};

export const createPaystackRefund = async (reference: string): Promise<PaystackRefundData> =>
  runPaystackRequest("create_refund", () =>
    paystack.post("/refund", {
      transaction: reference,
      currency: env.PAYSTACK_CURRENCY,
      merchant_note: "Duplicate or expired Community Connect ticket payment",
    }),
  );

export const listPaystackRefunds = async (transactionId: string): Promise<PaystackRefundData[]> =>
  runPaystackRequest("list_refunds", () =>
    paystack.get("/refund", { params: { transaction: transactionId, perPage: 20 } }),
  );

export const fetchPaystackRefund = async (refundId: string): Promise<PaystackRefundData> =>
  runPaystackRequest("fetch_refund", () =>
    paystack.get(`/refund/${encodeURIComponent(refundId)}`),
  );

export const listPaystackBanks = async (): Promise<PaystackBank[]> => {
  return runPaystackRequest("list_banks", () =>
    paystack.get("/bank", {
      params: {
        country: "nigeria",
        currency: env.PAYSTACK_CURRENCY,
        perPage: 100,
      },
    }),
  );
};

export const resolvePaystackAccount = async (
  accountNumber: string,
  bankCode: string,
): Promise<{ account_name: string; account_number: string }> => {
  return runPaystackRequest("resolve_account", () =>
    paystack.get("/bank/resolve", {
      params: {
        account_number: accountNumber,
        bank_code: bankCode,
      },
    }),
  );
};

export const createPaystackTransferRecipient = async (input: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): Promise<PaystackRecipientData> => {
  return runPaystackRequest("create_transfer_recipient", () =>
    paystack.post("/transferrecipient", {
      type: "nuban",
      name: input.name,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: env.PAYSTACK_CURRENCY,
    }),
  );
};

export const initiatePaystackTransfer = async (input: {
  amountKobo: number;
  recipientCode: string;
  reference: string;
  reason: string;
}): Promise<PaystackTransferData> => {
  return runPaystackRequest("initiate_transfer", () =>
    paystack.post("/transfer", {
      source: "balance",
      amount: input.amountKobo,
      recipient: input.recipientCode,
      reference: input.reference,
      reason: input.reason,
      currency: env.PAYSTACK_CURRENCY,
    }),
  );
};

export const initiatePaystackBulkTransfers = async (transfers: Array<{
  amountKobo: number;
  recipientCode: string;
  reference: string;
}>): Promise<PaystackTransferData[]> => {
  if (transfers.length < 1 || transfers.length > 100) {
    throw new TypeError("A payout batch must contain between 1 and 100 transfers");
  }
  return runPaystackRequest("initiate_bulk_transfers", () => paystack.post("/transfer/bulk", {
    source: "balance",
    currency: "NGN",
    transfers: transfers.map((transfer) => ({
      amount: transfer.amountKobo,
      recipient: transfer.recipientCode,
      reference: transfer.reference,
      reason: "Community Connect daily automatic payout",
    })),
  }));
};

export const verifyPaystackTransfer = async (reference: string): Promise<PaystackTransferData | null> => {
  return runPaystackRequest("verify_transfer", async () => {
    try {
      return await paystack.get(`/transfer/verify/${encodeURIComponent(reference)}`);
    } catch (error) {
      // Only a definitive not-found permits re-submission, with the SAME
      // reference. A timeout or provider outage must keep funds reserved.
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return { data: { status: true, message: "Transfer not found", data: null } };
      }
      throw error;
    }
  });
};

export const finalizePaystackTransfer = async (
  transferCode: string,
  otp: string,
): Promise<PaystackTransferData> => {
  return runPaystackRequest("finalize_transfer", () =>
    paystack.post("/transfer/finalize_transfer", {
      transfer_code: transferCode,
      otp,
    }),
  );
};
