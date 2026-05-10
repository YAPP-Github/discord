import * as calendarClient from "../integrations/google/calendarClient.js";
import * as cache from "../db/repositories/calendarEventCacheRepository.js";
import * as channelService from "./discordChannelService.js";
import type { BotClient } from "../client.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const REMINDER_LEAD_MS = 10 * 60 * 1000;

export async function listToday(
  calendarId: string,
  now: Date = new Date(),
): Promise<calendarClient.CalendarEvent[]> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return calendarClient.listEvents(calendarId, start, end);
}

export function formatDailyDigest(
  events: calendarClient.CalendarEvent[],
): string {
  if (events.length === 0) {
    return "📅 오늘 일정이 없습니다.";
  }
  const lines = events.map((e) => {
    const time = formatTime(e.start);
    return `- ${time} ${e.summary}${e.meet_url ? ` (${e.meet_url})` : ""}`;
  });
  return ["📅 오늘 일정", ...lines].join("\n");
}

export async function sendDailyDigest(
  client: BotClient,
  channelId: string,
  now: Date = new Date(),
): Promise<number> {
  let total = 0;
  for (const calendarId of config.google.calendarIds) {
    try {
      const events = await listToday(calendarId, now);
      total += events.length;
      await channelService.sendMessage(
        client,
        channelId,
        formatDailyDigest(events),
      );
    } catch (err) {
      logger.error(`[calendar ${calendarId}] daily digest failed`, err);
    }
  }
  return total;
}

export async function sendUpcomingReminders(
  client: BotClient,
  channelId: string,
  now: Date = new Date(),
): Promise<number> {
  let sent = 0;
  const horizon = new Date(now.getTime() + REMINDER_LEAD_MS);
  for (const calendarId of config.google.calendarIds) {
    let events: calendarClient.CalendarEvent[];
    try {
      events = await calendarClient.listEvents(calendarId, now, horizon);
    } catch (err) {
      logger.error(`[calendar ${calendarId}] reminder list failed`, err);
      continue;
    }
    for (const ev of events) {
      const cached = cache.findReminded(calendarId, ev.id);
      if (cached?.reminded_at) continue;
      const msg = `⏰ ${ev.summary} 시작 ${minutesUntil(ev.start, now)}분 전${
        ev.meet_url ? `\n${ev.meet_url}` : ""
      }`;
      try {
        await channelService.sendMessage(client, channelId, msg);
        cache.markReminded(calendarId, ev.id, ev.start);
        sent += 1;
      } catch (err) {
        logger.error(`[calendar ${calendarId}] reminder send failed`, err);
      }
    }
  }
  return sent;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function minutesUntil(iso: string, now: Date): number {
  const d = new Date(iso);
  return Math.max(0, Math.round((d.getTime() - now.getTime()) / 60000));
}
