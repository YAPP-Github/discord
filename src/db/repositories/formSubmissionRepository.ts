import { getDatabase } from "../index.js";

export interface FormSubmissionRow {
  id: number;
  form_id: string | null;
  submitted_at: string | null;
  payload: string | null;
  status: string;
  idempotency_key: string | null;
  created_at: string;
}

export interface CreateFormSubmissionInput {
  form_id: string | null;
  submitted_at: string | null;
  payload: string;
  idempotency_key: string;
}

export function createSubmission(
  input: CreateFormSubmissionInput,
): FormSubmissionRow | null {
  const db = getDatabase();
  try {
    const info = db
      .prepare(
        `INSERT INTO form_submission (form_id, submitted_at, payload, idempotency_key)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        input.form_id,
        input.submitted_at,
        input.payload,
        input.idempotency_key,
      );
    return findById(Number(info.lastInsertRowid));
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("UNIQUE constraint failed")
    ) {
      return null;
    }
    throw err;
  }
}

export function findById(id: number): FormSubmissionRow | null {
  const db = getDatabase();
  return (
    (db.prepare(`SELECT * FROM form_submission WHERE id = ?`).get(id) as
      | FormSubmissionRow
      | undefined) ?? null
  );
}

export function findByIdempotencyKey(key: string): FormSubmissionRow | null {
  const db = getDatabase();
  return (
    (db
      .prepare(`SELECT * FROM form_submission WHERE idempotency_key = ?`)
      .get(key) as FormSubmissionRow | undefined) ?? null
  );
}

export function updateStatus(id: number, status: string): void {
  const db = getDatabase();
  db.prepare(`UPDATE form_submission SET status = ? WHERE id = ?`).run(
    status,
    id,
  );
}

export function recordHandlerResult(
  submissionId: number,
  handler: string,
  status: string,
  detail: string | null,
): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO form_provisioning_result (submission_id, handler, status, detail)
     VALUES (?, ?, ?, ?)`,
  ).run(submissionId, handler, status, detail);
}
