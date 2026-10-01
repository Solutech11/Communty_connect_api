import { createAdapter } from "@socket.io/redis-adapter";
import type { Server as HttpServer } from "node:http";
import { Server, type Socket as ClientSocket } from "socket.io";
import { env } from "../Config/env";
import { redisClient } from "../DB/redis";
import { UserModel } from "../models/Auth/User.model";
import { verifyAccessToken } from "../utils/jwt.utils";
import { logger } from "../utils/logger.utils";
import ChatSocket from "./routes/Chat.Socket";

const authenticateSocket = async (
  socket: ClientSocket,
  next: (error?: Error) => void,
): Promise<void> => {
  try {
    const handshakeToken = socket.handshake.auth.token;
    const headerToken = socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, "");
    const token = typeof handshakeToken === "string" ? handshakeToken : headerToken;

    if (!token) {
      throw new Error("Authentication required");
    }

    const payload = verifyAccessToken(token);
    const user = await UserModel.findById(payload.sub).select("status tokenVersion").lean();

    if (!user || user.status !== "active" || user.tokenVersion !== payload.tokenVersion) {
      throw new Error("Session unavailable");
    }

    socket.data.userId = payload.sub;
    next();
  } catch (error) {
    logger.warn(
      {
        error,
        socketId: socket.id,
      },
      "Rejected unauthorized socket connection",
    );
    next(new Error("Unauthorized"));
  }
};

const isAllowedSocketOrigin = (origin: string | undefined): boolean => {
  if (!origin) {
    // Native mobile clients do not consistently send an Origin header.
    return true;
  }

  return env.allowedOrigins.includes(origin);
};

/**
 * Attaches Socket.IO to the already-listening Express HTTP server.
 *
 * This intentionally follows the existing project style:
 * `const server = app.listen(...); await Socket(server);`
 */
const Socket = async (server: HttpServer): Promise<Server> => {
  const io = new Server(server, {
    cors: {
      origin: env.allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
    allowRequest: (request, callback) => {
      callback(null, isAllowedSocketOrigin(request.headers.origin));
    },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 100_000,
    pingTimeout: 20_000,
    pingInterval: 25_000,
  });

  io.engine.on("connection_error", (error: { code: number }) => {
    // Engine errors may contain request headers and query data; log only the code.
    logger.warn(
      { operation: "socket_handshake", code: error.code, path: "/socket.io/" },
      "Socket.IO transport handshake rejected",
    );
  });

  if (redisClient.isReady) {
    const publisher = redisClient.duplicate();
    const subscriber = redisClient.duplicate();

    await Promise.all([publisher.connect(), subscriber.connect()]);
    io.adapter(createAdapter(publisher, subscriber));
  }

  const chatNamespace = io.of("/chat");
  chatNamespace.use((socket, next) => {
    void authenticateSocket(socket, next);
  });

  chatNamespace.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    ChatSocket(socket, chatNamespace);
    void (async () => {
      await socket.join(`user:${userId}`);
      socket.emit("socket:ready", { userId, namespace: "/chat" });
    })().catch(() => {
      logger.warn({ operation: "socket_user_room_join", userId, socketId: socket.id }, "Socket user room join failed");
      socket.disconnect(true);
    });
  });

  logger.info(
    {
      namespace: chatNamespace.name,
      path: "/socket.io/",
      transports: ["polling", "websocket"],
      redisAdapter: redisClient.isReady,
    },
    "Socket.IO chat gateway initialized",
  );

  return io;
};

export default Socket;
