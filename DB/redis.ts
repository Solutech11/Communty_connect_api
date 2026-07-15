import { createClient } from "redis";
import { env } from "../Config/env";
import { logger } from "../utils/logger.utils";

export const redisClient = createClient({
  url: env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 100, 3_000),
  },
});

redisClient.on("error", (error) => {
  logger.error({ error }, "Redis client error");
});

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
