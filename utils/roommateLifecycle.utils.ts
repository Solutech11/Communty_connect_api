import type { ClientSession } from "mongoose";
import { RoommateProfileModel } from "../models/Roommate/RoommateProfile.model";
import { RoommateConnectionModel } from "../models/Roommate/RoommateConnection.model";
import { RoommateRequestModel } from "../models/Roommate/RoommateRequest.model";
import { RoommateDecisionModel } from "../models/Roommate/RoommateDecision.model";

export const closeRoommateConnection = async (id: string, session: ClientSession): Promise<void> => {
  const connection = await RoommateConnectionModel.findById(id).session(session);
  if (!connection || connection.status === "closed") return;
  // Ending a pairing releases both profiles, but never republishes either
  // person's profile without an explicit resume from its owner.
  await RoommateProfileModel.updateMany({ activeConnectionId: connection._id }, {
    $set: { visibility: "paused" }, $unset: { activeConnectionId: 1 }, $inc: { revision: 1 },
  }, { session });
  connection.status = "closed";
  connection.consents.splice(0);
  connection.closedAt = new Date();
  await connection.save({ session });
  await RoommateRequestModel.updateMany({ connectionId: id, status: "pending" }, {
    $set: { status: "closed", respondedAt: new Date() },
  }, { session });
};

export const deleteRoommateData = async (userId: string, session: ClientSession): Promise<void> => {
  const connections = await RoommateConnectionModel.find({ participantIds: userId }).session(session);
  for (const connection of connections) {
    await closeRoommateConnection(connection._id.toString(), session);
  }
  await RoommateProfileModel.deleteOne({ userId }, { session });
  await RoommateDecisionModel.deleteMany({ $or: [{ userId }, { targetId: userId }] }, { session });
};
