import * as repo from "../db/repositories/scheduledNoticeRepository.js";
import * as channelService from "./discordChannelService.js";
import type { BotClient } from "../client.js";
import { logger } from "../utils/logger.js";
import { validate as cronValidate } from "node-cron";

export interface CreateNoticeInput {
  title: string;
  content: string;
  cron_expr: string;
  channel_id: string;
}

export function create(input: CreateNoticeInput): repo.ScheduledNoticeRow {
  if (!cronValidate(input.cron_expr)) {
    throw new Error(`Invalid cron expression: ${input.cron_expr}`);
  }
  return repo.createNotice(input);
}

export function list(): repo.ScheduledNoticeRow[] {
  return repo.listAll();
}

export function toggle(id: number): repo.ScheduledNoticeRow | null {
  const row = repo.findById(id);
  if (!row) return null;
  repo.setEnabled(id, row.enabled === 0);
  return repo.findById(id);
}

export async function dispatchOne(
  client: BotClient,
  notice: repo.ScheduledNoticeRow,
): Promise<void> {
  const body = `**${notice.title}**\n${notice.content}`;
  await channelService.sendMessage(client, notice.channel_id, body);
  repo.markRun(notice.id);
}

export async function dispatchAllEnabled(client: BotClient): Promise<number> {
  let sent = 0;
  for (const notice of repo.listEnabled()) {
    try {
      await dispatchOne(client, notice);
      sent += 1;
    } catch (err) {
      logger.error(`[notice ${notice.id}] dispatch failed`, err);
    }
  }
  return sent;
}
