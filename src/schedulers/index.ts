import type { BotClient } from "../client.js";
import { logger } from "../utils/logger.js";

export function startSchedulers(client: BotClient): void {
  void client;
  logger.info("[Scheduler] Started");
}
