import { getDatabase } from "../index.js";

export interface AgentSessionRow {
  id: number;
  actor_discord_id: string | null;
  input_text: string;
  plan_json: string | null;
  status: string;
  created_at: string;
}

export interface AgentToolCallRow {
  id: number;
  session_id: number;
  tool_name: string;
  args_json: string | null;
  result_json: string | null;
  status: string;
  duration_ms: number | null;
  created_at: string;
}

export function createSession(
  actor: string | null,
  input: string,
): AgentSessionRow {
  const db = getDatabase();
  const info = db
    .prepare(
      `INSERT INTO agent_session (actor_discord_id, input_text) VALUES (?, ?)`,
    )
    .run(actor, input);
  return findSession(Number(info.lastInsertRowid))!;
}

export function findSession(id: number): AgentSessionRow | null {
  const db = getDatabase();
  return (
    (db.prepare(`SELECT * FROM agent_session WHERE id = ?`).get(id) as
      | AgentSessionRow
      | undefined) ?? null
  );
}

export function setSessionPlan(id: number, plan: unknown): void {
  const db = getDatabase();
  db.prepare(`UPDATE agent_session SET plan_json = ? WHERE id = ?`).run(
    JSON.stringify(plan),
    id,
  );
}

export function setSessionStatus(id: number, status: string): void {
  const db = getDatabase();
  db.prepare(`UPDATE agent_session SET status = ? WHERE id = ?`).run(
    status,
    id,
  );
}

export function recordToolCall(
  sessionId: number,
  toolName: string,
  args: unknown,
  result: unknown,
  status: string,
  durationMs: number,
): AgentToolCallRow {
  const db = getDatabase();
  const info = db
    .prepare(
      `INSERT INTO agent_tool_call
       (session_id, tool_name, args_json, result_json, status, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      toolName,
      JSON.stringify(args),
      JSON.stringify(result),
      status,
      durationMs,
    );
  return db
    .prepare(`SELECT * FROM agent_tool_call WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as AgentToolCallRow;
}

export function listToolCalls(sessionId: number): AgentToolCallRow[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM agent_tool_call WHERE session_id = ? ORDER BY id ASC`,
    )
    .all(sessionId) as AgentToolCallRow[];
}
