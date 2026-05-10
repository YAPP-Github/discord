import { getDatabase } from "../index.js";

export interface CalendarEventCacheRow {
  id: number;
  calendar_id: string;
  event_id: string;
  start_time: string;
  reminded_at: string | null;
}

export function findReminded(
  calendarId: string,
  eventId: string,
): CalendarEventCacheRow | null {
  const db = getDatabase();
  return (
    (db
      .prepare(
        `SELECT * FROM calendar_event_cache WHERE calendar_id = ? AND event_id = ?`,
      )
      .get(calendarId, eventId) as CalendarEventCacheRow | undefined) ?? null
  );
}

export function markReminded(
  calendarId: string,
  eventId: string,
  startTime: string,
): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO calendar_event_cache (calendar_id, event_id, start_time, reminded_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(calendar_id, event_id) DO UPDATE SET reminded_at = datetime('now')`,
  ).run(calendarId, eventId, startTime);
}
