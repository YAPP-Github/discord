import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scheduled_notice (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS form_submission (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id TEXT,
      submitted_at TEXT,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS form_provisioning_result (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      handler TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (submission_id) REFERENCES form_submission(id)
    );

    CREATE TABLE IF NOT EXISTS calendar_event_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      calendar_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      reminded_at TEXT,
      UNIQUE(calendar_id, event_id)
    );

    CREATE TABLE IF NOT EXISTS agent_session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_discord_id TEXT,
      input_text TEXT NOT NULL,
      plan_json TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_tool_call (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      tool_name TEXT NOT NULL,
      args_json TEXT,
      result_json TEXT,
      status TEXT NOT NULL,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES agent_session(id)
    );
  `);
}
