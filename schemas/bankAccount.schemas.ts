import { z } from "zod";

export const bankAccountDetailsSchema = z.object({
  accountNumber: z.string().regex(/^\d{10}$/, "Enter a 10-digit account number"),
  bankCode: z.string().regex(/^\d{3,6}$/, "Select a valid bank"),
}).strict();
