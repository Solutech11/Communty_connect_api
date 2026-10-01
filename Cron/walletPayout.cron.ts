import { CACHE_KEYS } from "../Constant";
import { AppError } from "../utils/AppError";
import { logger } from "../utils/logger.utils";
import { withRedisLock } from "../utils/redisLock.utils";
import { reserveDailyPayouts, submitDailyPayouts, reconcileDailyPayouts, sendPayoutReminders } from "../utils/automaticPayout.utils";

// Bounded batches drain from midnight onward. Persistent due dates and queues
// resume after downtime; renewable leases coordinate all server replicas.
export const startWalletPayoutCron = (): (() => Promise<void>) => {
  let stopped = false;
  const active = new Set<Promise<void>>();
  const worker = (name: string, operation: () => Promise<void>): void => {
    if (stopped) return;
    const task = (async () => {
      try {
        await withRedisLock(CACHE_KEYS.lock("cron", name), operation, 120_000, true);
      } catch (error) {
        if (error instanceof AppError && error.code === "OPERATION_IN_PROGRESS") return;
        logger.error({ operation: name }, "Wallet payout worker failed");
      }
    })();
    active.add(task);
    void task.finally(() => active.delete(task));
  };
  const payoutTick = (): void => worker("wallet-payouts", async () => {
    await reserveDailyPayouts();
    await submitDailyPayouts();
  });
  const reminderTick = (): void => worker("wallet-payout-reminders", sendPayoutReminders);
  const reconcileTick = (): void => worker("wallet-payout-reconciliation", reconcileDailyPayouts);
  const timers = [setInterval(payoutTick, 5_000), setInterval(reminderTick, 15_000), setInterval(reconcileTick, 60_000)];
  for (const timer of timers) timer.unref();
  payoutTick();
  reminderTick();
  reconcileTick();
  return async () => {
    stopped = true;
    for (const timer of timers) clearInterval(timer);
    await Promise.allSettled(active);
  };
};
