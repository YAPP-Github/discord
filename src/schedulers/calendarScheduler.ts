import cron from "node-cron";
import type { BotClient } from "../client.js";
import * as calendarService from "../services/calendarService.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const NOTICE_CHANNEL_ENV = "DISCORD_NOTICE_CHANNEL_ID";

export function startCalendarScheduler(client: BotClient): void {
  if (config.google.calendarIds.length === 0) {
    logger.info("[calendar] No GOOGLE_CALENDAR_IDS configured, skipping");
    return;
  }
  const channelId = process.env[NOTICE_CHANNEL_ENV];
  if (!channelId) {
    logger.warn(`[calendar] ${NOTICE_CHANNEL_ENV} not set, skipping scheduler`);
    return;
  }

  // Daily digest at 09:00 KST
  cron.schedule(
    "0 9 * * *",
    () => {
      calendarService.sendDailyDigest(client, channelId).catch((err) => {
        logger.error("[calendar] daily digest failed", err);
      });
    },
    { timezone: "Asia/Seoul" },
  );

  // Reminders every minute
  cron.schedule("* * * * *", () => {
    calendarService.sendUpcomingReminders(client, channelId).catch((err) => {
      logger.error("[calendar] reminders failed", err);
    });
  });
}
