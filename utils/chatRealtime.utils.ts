import type { Namespace } from "socket.io";

export const emitConversationMessage = (
  io: Namespace | undefined,
  conversationId: string,
  participantIds: string[],
  message: unknown,
): void => {
  // Authenticated user rooms also receive messages while the device is rejoining
  // its conversation room. Socket.IO's room union delivers each packet once.
  const rooms = [`conversation:${conversationId}`, ...participantIds.map((id) => `user:${id}`)];
  io?.to(rooms).emit("message:new", message);
};
