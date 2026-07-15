import app from "./app";
import { env } from "./Config/env";
import { startTicketReservationCron } from "./Cron/ticketReservation.cron";
import { connectMongo, disconnectMongo } from "./DB/mongo";
import { connectRedis, disconnectRedis } from "./DB/redis";
import Socket from "./Socket/Socket";
import { logger } from "./utils/logger.utils";

const startServer = async (): Promise<void> => {
  await Promise.all([connectMongo(), connectRedis()]);

  // This matches the owner's established backends: Express starts the HTTP
  // server, then the server instance is passed into the Socket initializer.
  const server = app.listen(env.PORT, () => {
    logger.info(
      {
        environment: env.NODE_ENV,
        port: env.PORT,
      },
      "Community Connect API started",
    );
  });

  server.on("error", (error) => {
    logger.fatal({ error }, "HTTP server error");
  });

  const io = await Socket(server);

  // Controllers emit persisted REST events into the authenticated chat namespace.
  app.set("io", io.of("/chat"));

  const stopTicketReservationCron = startTicketReservationCron();
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info({ signal }, "Graceful shutdown started");

    const forceExitTimer = setTimeout(() => {
      logger.fatal("Graceful shutdown timed out");
      process.exit(1);
    }, 15_000);
    forceExitTimer.unref();

    stopTicketReservationCron();

    await new Promise<void>((resolve) => {
      io.close(() => resolve());
    });

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
          reject(error);
          return;
        }

        resolve();
      });
    });

    await Promise.allSettled([disconnectMongo(), disconnectRedis()]);
    clearTimeout(forceExitTimer);
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
};

startServer().catch((error) => {
  logger.fatal({ error }, "Server bootstrap failed");
  process.exit(1);
});
