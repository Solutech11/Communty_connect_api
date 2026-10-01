export const PAYOUT_TIMEZONE = "Africa/Lagos";
export const MIN_AUTOMATIC_PAYOUT_KOBO = 100_000;
export const PAYOUT_DAY_MS = 24 * 60 * 60 * 1000;
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

// Lagos uses UTC+1 throughout the year. Calculate independently of the host
// timezone and the mobile device's clock.
export const payoutMidnight = (now = new Date()): Date => {
  const local = new Date(now.getTime() + LAGOS_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - LAGOS_OFFSET_MS);
};

export const nextPayoutMidnight = (now = new Date()): Date =>
  new Date(payoutMidnight(now).getTime() + PAYOUT_DAY_MS);

export const payoutCycle = (midnight: Date): string =>
  new Date(midnight.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
