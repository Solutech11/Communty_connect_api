export const matchesPaystackSettlement = (
  providerAmountKobo: number | undefined,
  paystackFeeKobo: number | null | undefined,
  expectedAmountKobo: number,
): boolean => {
  if (typeof providerAmountKobo !== "number" || !Number.isSafeInteger(providerAmountKobo)) {
    return false;
  }

  if (providerAmountKobo === expectedAmountKobo) {
    return true;
  }

  // With Paystack's "Pass fees to customers" setting, the charged amount
  // includes its fee. The settlement must still equal our initialized amount.
  return typeof paystackFeeKobo === "number"
    && Number.isSafeInteger(paystackFeeKobo)
    && paystackFeeKobo > 0
    && providerAmountKobo - paystackFeeKobo === expectedAmountKobo;
};
