import type { BotClient } from "../client.js";
import { startNoticeScheduler } from "./noticeScheduler.js";
import { startCalendarScheduler } from "./calendarScheduler.js";
import { logger } from "../utils/logger.js";

export function startSchedulers(client: BotClient): void {
  startNoticeScheduler(client);
  startCalendarScheduler(client);
  logger.info("[Scheduler] Started");
}
