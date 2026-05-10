import { getDatabase } from "../index.js";

export interface ScheduledNoticeRow {
  id: number;
  title: string;
  content: string;
  cron_expr: string;
  channel_id: string;
  enabled: number;
  last_run_at: string | null;
  created_at: string;
}

export interface CreateNoticeInput {
  title: string;
  content: string;
  cron_expr: string;
  channel_id: string;
}

export function createNotice(input: CreateNoticeInput): ScheduledNoticeRow {
  const db = getDatabase();
  const stmt = db.prepare(
    `INSERT INTO scheduled_notice (title, content, cron_expr, channel_id)
     VALUES (?, ?, ?, ?)`,
  );
  const info = stmt.run(
    input.title,
    input.content,
    input.cron_expr,
    input.channel_id,
  );
  return findById(Number(info.lastInsertRowid))!;
}

export function findById(id: number): ScheduledNoticeRow | null {
  const db = getDatabase();
  return (
    (db.prepare(`SELECT * FROM scheduled_notice WHERE id = ?`).get(id) as
      | ScheduledNoticeRow
      | undefined) ?? null
  );
}

export function listEnabled(): ScheduledNoticeRow[] {
  const db = getDatabase();
  return db
    .prepare(`SELECT * FROM scheduled_notice WHERE enabled = 1`)
    .all() as ScheduledNoticeRow[];
}

export function listAll(): ScheduledNoticeRow[] {
  const db = getDatabase();
  return db
    .prepare(`SELECT * FROM scheduled_notice ORDER BY id ASC`)
    .all() as ScheduledNoticeRow[];
}

export function setEnabled(id: number, enabled: boolean): void {
  const db = getDatabase();
  db.prepare(`UPDATE scheduled_notice SET enabled = ? WHERE id = ?`).run(
    enabled ? 1 : 0,
    id,
  );
}

export function disableAll(): number {
  const db = getDatabase();
  const info = db
    .prepare(`UPDATE scheduled_notice SET enabled = 0 WHERE enabled = 1`)
    .run();
  return info.changes;
}

export function markRun(id: number): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE scheduled_notice SET last_run_at = datetime('now') WHERE id = ?`,
  ).run(id);
}
