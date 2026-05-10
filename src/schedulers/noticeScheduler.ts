import cron, { type ScheduledTask } from "node-cron";
import type { BotClient } from "../client.js";
import * as repo from "../db/repositories/scheduledNoticeRepository.js";
import * as noticeService from "../services/noticeService.js";
import { logger } from "../utils/logger.js";

const tasks = new Map<number, ScheduledTask>();

export function startNoticeScheduler(client: BotClient): void {
  reload(client);
  // Periodic refresh — picks up notices added via /notice add.
  cron.schedule("* * * * *", () => reload(client));
}

export function reload(client: BotClient): void {
  const enabled = repo.listEnabled();
  const enabledIds = new Set(enabled.map((n) => n.id));

  for (const [id, task] of tasks) {
    if (!enabledIds.has(id)) {
      task.stop();
      tasks.delete(id);
    }
  }

  for (const notice of enabled) {
    if (tasks.has(notice.id)) continue;
    if (!cron.validate(notice.cron_expr)) {
      logger.warn(
        `[notice ${notice.id}] invalid cron expr: ${notice.cron_expr}`,
      );
      continue;
    }
    const task = cron.schedule(notice.cron_expr, () => {
      noticeService.dispatchOne(client, notice).catch((err) => {
        logger.error(`[notice ${notice.id}] dispatch failed`, err);
      });
    });
    tasks.set(notice.id, task);
  }
}

export function _stopAll(): void {
  for (const task of tasks.values()) task.stop();
  tasks.clear();
}
