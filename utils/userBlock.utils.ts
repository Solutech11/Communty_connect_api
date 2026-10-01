import type { ClientSession } from "mongoose";
import { UserBlockModel } from "../models/Social/UserBlock.model";
import { AppError } from "./AppError";
import { withRedisLock } from "./redisLock.utils";

export const pairKeyFor = (left: string, right: string): string => [left, right].sort().join(":");

export const withUserLocks = async <T>(ids: string[], operation: () => Promise<T>): Promise<T> => {
  const ordered = [...new Set(ids)].sort();
  const acquire = async (index: number): Promise<T> => {
    const id = ordered[index];
    if (!id) return operation();
    return withRedisLock(`social:user:${id}`, () => acquire(index + 1), 30_000);
  };
  return acquire(0);
};

export const requireUnblocked = async (left: string, right: string, session?: ClientSession): Promise<void> => {
  const block = await UserBlockModel.exists({ $or: [
    { userId: left, targetId: right }, { userId: right, targetId: left },
  ] }).session(session || null);
  if (block) throw new AppError(403, "This connection is unavailable", "CONNECTION_UNAVAILABLE");
};

export const blockedUserIds = async (userId: string): Promise<string[]> => {
  const blocks = await UserBlockModel.find({ $or: [{ userId }, { targetId: userId }] }).lean();
  return blocks.map((block) => block.userId.toString() === userId
    ? block.targetId.toString() : block.userId.toString());
};
