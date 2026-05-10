import type { BotClient } from "../client.js";
import { startNoticeScheduler } from "./noticeScheduler.js";
import { logger } from "../utils/logger.js";

export function startSchedulers(client: BotClient): void {
  startNoticeScheduler(client);
  logger.info("[Scheduler] Started");
}
