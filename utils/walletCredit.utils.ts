import { nextPayoutMidnight } from "./payoutSchedule.utils";

export const walletCreditUpdate = (amountKobo: number, now = new Date()) => {
  if (!Number.isSafeInteger(amountKobo) || amountKobo < 0) {
    throw new TypeError("Wallet credits must be non-negative integer kobo");
  }
  // The first earning in an empty wallet starts at the NEXT midnight. An
  // existing overdue balance keeps its due date until the daily worker runs.
  return [{ $set: {
    nextPayoutAt: { $cond: [
      { $gt: ["$availableBalanceKobo", 0] },
      { $ifNull: ["$nextPayoutAt", nextPayoutMidnight(now)] },
      nextPayoutMidnight(now),
    ] },
    availableBalanceKobo: { $add: ["$availableBalanceKobo", amountKobo] },
  } }];
};
