import type { ClientSession } from "mongoose";
import { ConversationModel } from "../models/Chat/Conversation.model";
import { pairKeyFor, requireUnblocked } from "./userBlock.utils";

// Callers serialize creation on direct-chat:<pairKey>. The unique key also
// prevents duplicates if a Redis lease expires before the transaction ends.
export const ensureDirectConversation = async (left: string, right: string, session?: ClientSession) => {
  await requireUnblocked(left, right, session);
  const pairKey = pairKeyFor(left, right);
  const existing = await ConversationModel.findOne({
    type: "direct", participantIds: { $all: [left, right], $size: 2 },
  }).sort({ createdAt: 1, _id: 1 }).session(session || null);
  if (existing) {
    if (!existing.directPairKey) {
      existing.directPairKey = pairKey;
      await existing.save({ session });
    }
    return existing;
  }
  const [created] = await ConversationModel.create([{
    type: "direct", participantIds: [left, right], createdBy: left, directPairKey: pairKey,
  }], { session });
  return created!;
};
