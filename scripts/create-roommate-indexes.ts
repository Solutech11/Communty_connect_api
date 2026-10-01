import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../DB/mongo";
import { RoommateProfileModel } from "../models/Roommate/RoommateProfile.model";
import { RoommateDecisionModel } from "../models/Roommate/RoommateDecision.model";
import { RoommateConnectionModel } from "../models/Roommate/RoommateConnection.model";
import { RoommateRequestModel } from "../models/Roommate/RoommateRequest.model";
import { UserBlockModel } from "../models/Social/UserBlock.model";
import { ConversationModel } from "../models/Chat/Conversation.model";
import { logger } from "../utils/logger.utils";

const main = async (): Promise<void> => {
  await connectMongo();
  try {
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== "isdbgrid") throw new Error("Roommates require MongoDB transaction support");
    // createIndexes adds declared indexes without dropping existing indexes.
    await Promise.all([RoommateProfileModel, RoommateDecisionModel, RoommateConnectionModel,
      RoommateRequestModel, UserBlockModel, ConversationModel].map((model) => model.createIndexes()));
    process.stdout.write("Roommate and direct-conversation indexes are ready.\n");
  } finally { await disconnectMongo(); }
};
void main().catch((error: unknown) => {
  logger.error({ error, operation: "create_roommate_indexes" }, "Roommate index provisioning failed");
  process.exitCode = 1;
});
