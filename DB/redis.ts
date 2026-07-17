import { createClient } from "redis";
import { env } from "../Config/env";
import { logger } from "../utils/logger.utils";

export const redisClient = createClient({
  url: env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 100, 3_000),
  },
});

let resolveRedisReady: (() => void) | undefined;
let redisReadyPromise: Promise<void>;

const resetRedisReadyPromise = (): void => {
  redisReadyPromise = new Promise<void>((resolve) => {
    resolveRedisReady = resolve;
  });
};

resetRedisReadyPromise();

redisClient.on("error", (error) => {
  logger.error({ error }, "Redis client error");
});

redisClient.on("ready", () => {
  resolveRedisReady?.();
});

redisClient.on("end", () => {
  resetRedisReadyPromise();
});

export const waitForRedisReady = async (): Promise<void> => {
  if (!redisClient.isReady) {
    await redisReadyPromise;
  }
};

export const connectRedis = async (): Promise<void> => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info("Redis connected");
  }
};

export const disconnectRedis = async (): Promise<void> => {
  if (redisClient.isOpen) {
    await redisClient.quit();
    logger.info("Redis disconnected");
  }
};
