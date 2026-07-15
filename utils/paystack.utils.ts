import axios, { type AxiosInstance } from "axios";
import { env } from "../Config/env";
import { AppError } from "./AppError";

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

interface PaystackTransactionData {
  authorization_url: string;
  access_code: string;
  reference: string;
  amount?: number;
  currency?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  customer?: { email?: string };
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

interface PaystackTransferData {
  transfer_code: string;
  reference: string;
  status: string;
  amount: number;
  currency: string;
}

interface PaystackBank {
  name: string;
  code: string;
  currency: string;
  active: boolean;
  type: string;
}

class PaystackClient {
  private readonly client: AxiosInstance;

  public constructor() {
    this.client = axios.create({
      baseURL: env.PAYSTACK_BASE_URL,
      timeout: 15_000,
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });
  }

  private async request<T>(operation: () => Promise<{ data: PaystackEnvelope<T> }>): Promise<T> {
    try {
      const response = await operation();

      if (!response.data.status) {
        throw new AppError(502, "Payment provider rejected the request", "PAYSTACK_REJECTED");
      }

      return response.data.data;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(502, "Payment provider is unavailable", "PAYSTACK_UNAVAILABLE");
    }
  }

  public async initializeTransaction(input: {
    email: string;
    amountKobo: number;
    reference: string;
    metadata: Record<string, unknown>;
  }): Promise<PaystackTransactionData> {
    return this.request(() =>
      this.client.post("/transaction/initialize", {
        email: input.email,
        amount: input.amountKobo,
        currency: env.PAYSTACK_CURRENCY,
        reference: input.reference,
        callback_url: env.PAYSTACK_CALLBACK_URL,
        metadata: input.metadata,
      }),
    );
  }

  public async verifyTransaction(reference: string): Promise<PaystackTransactionData> {
    return this.request(() =>
      this.client.get(`/transaction/verify/${encodeURIComponent(reference)}`),
    );
  }

  public async listBanks(): Promise<PaystackBank[]> {
    return this.request(() =>
      this.client.get("/bank", {
        params: {
          country: "nigeria",
          currency: env.PAYSTACK_CURRENCY,
          perPage: 100,
        },
      }),
    );
  }

  public async resolveAccount(accountNumber: string, bankCode: string): Promise<{
    account_name: string;
    account_number: string;
  }> {
    return this.request(() =>
      this.client.get("/bank/resolve", {
        params: {
          account_number: accountNumber,
          bank_code: bankCode,
        },
      }),
    );
  }

  public async createTransferRecipient(input: {
    name: string;
    accountNumber: string;
    bankCode: string;
  }): Promise<PaystackRecipientData> {
    return this.request(() =>
      this.client.post("/transferrecipient", {
        type: "nuban",
        name: input.name,
        account_number: input.accountNumber,
        bank_code: input.bankCode,
        currency: env.PAYSTACK_CURRENCY,
      }),
    );
  }

  public async initiateTransfer(input: {
    amountKobo: number;
    recipientCode: string;
    reference: string;
    reason: string;
  }): Promise<PaystackTransferData> {
    return this.request(() =>
      this.client.post("/transfer", {
        source: "balance",
        amount: input.amountKobo,
        recipient: input.recipientCode,
        reference: input.reference,
        reason: input.reason,
        currency: env.PAYSTACK_CURRENCY,
      }),
    );
  }

  public async finalizeTransfer(transferCode: string, otp: string): Promise<PaystackTransferData> {
    return this.request(() =>
      this.client.post("/transfer/finalize_transfer", {
        transfer_code: transferCode,
        otp,
      }),
    );
  }
}

export const paystackClient = new PaystackClient();
