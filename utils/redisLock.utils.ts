import { randomUUID } from "node:crypto";
import { redisClient } from "../DB/redis";
import { AppError } from "./AppError";
import { logger } from "./logger.utils";

const RELEASE_LOCK_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

export const withRedisLock = async <T>(
  key: string,
  operation: () => Promise<T>,
  ttlMilliseconds = 15_000,
  renew = false,
): Promise<T> => {
  if (!redisClient.isReady) {
    throw new AppError(
      503,
      "This operation is temporarily unavailable",
      "FINANCIAL_LOCK_UNAVAILABLE",
    );
  }

  const lockValue = randomUUID();
  const acquired = await redisClient.set(key, lockValue, {
    NX: true,
    PX: ttlMilliseconds,
  });

  if (!acquired) {
    throw new AppError(409, "A matching operation is already in progress", "OPERATION_IN_PROGRESS");
  }

  let renewal: Promise<void> | undefined;
  const timer = renew ? setInterval(() => {
    if (renewal) return;
    renewal = (async () => {
      try {
        const extended = await redisClient.eval(
          'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], ARGV[2]) end return 0',
          { keys: [key], arguments: [lockValue, String(ttlMilliseconds)] },
        );
        if (!extended) logger.error({ operation: "renew_redis_lock" }, "Worker lock ownership was lost");
      } catch {
        logger.error({ operation: "renew_redis_lock" }, "Worker lock could not be renewed");
      } finally {
        renewal = undefined;
      }
    })();
  }, Math.floor(ttlMilliseconds / 3)) : undefined;
  timer?.unref();

  try {
    return await operation();
  } finally {
    if (timer) clearInterval(timer);
    await renewal;
    await redisClient.eval(RELEASE_LOCK_SCRIPT, {
      keys: [key],
      arguments: [lockValue],
    });
  }
};
