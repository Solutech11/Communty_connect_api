import mongoose from "mongoose";
import { env } from "../Config/env";
import { logger } from "../utils/logger.utils";

export const connectMongo = async (): Promise<void> => {
  mongoose.set("strictQuery", true);

  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: !env.isProduction,
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    minPoolSize: env.isProduction ? 2 : 0,
  });

  logger.info("MongoDB connected");
};

export const disconnectMongo = async (): Promise<void> => {
  await mongoose.disconnect();
  logger.info("MongoDB disconnected");
};
