import { randomUUID } from "node:crypto";
import { redisClient } from "../DB/redis";
import { AppError } from "./AppError";

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

  try {
    return await operation();
  } finally {
    await redisClient.eval(RELEASE_LOCK_SCRIPT, {
      keys: [key],
      arguments: [lockValue],
    });
  }
};
