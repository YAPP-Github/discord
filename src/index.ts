import type { Server } from "node:http";
import { BotClient } from "./client.js";
import { config } from "./config.js";
import { loadCommands } from "./loaders/commands.js";
import { loadEvents } from "./loaders/events.js";
import { getDatabase, initDatabase } from "./db/index.js";
import { startHttpServer } from "./http/server.js";
import { startSchedulers } from "./schedulers/index.js";
import { logger } from "./utils/logger.js";

const client = new BotClient();
let httpServer: Server | undefined;

async function main() {
  initDatabase();
  await loadCommands(client);
  await loadEvents(client);
  httpServer = startHttpServer(client, config.http.port);
  startSchedulers(client);
  await client.login(config.discord.token);
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[Shutdown] Received ${signal}, draining...`);

  // SIGKILL safety net — force exit if cleanup hangs.
  const forceExit = setTimeout(() => {
    logger.error("[Shutdown] Timeout exceeded, forcing exit");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await new Promise<void>((resolve) => {
      if (!httpServer) return resolve();
      httpServer.close(() => resolve());
    });
    await client.destroy();
    getDatabase().close();
    logger.info("[Shutdown] Clean exit");
    process.exit(0);
  } catch (err) {
    logger.error("[Shutdown] Error during cleanup", err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});
