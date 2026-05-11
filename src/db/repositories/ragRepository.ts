import { getRagDatabase } from "../rag.js";

export interface ChunkRow {
  id: string;
  parent_thread_id: string;
  channel_id: string;
  channel_name: string;
  channel_category: string | null;
  generation: string | null;
  thread_id: string | null;
  thread_name: string | null;
  is_starter_only: number;
  message_ids: string;
  author_ids: string;
  author_names: string;
  timestamp_start: string;
  timestamp_end: string;
  reply_count: number;
  reaction_positive: number;
  reaction_negative: number;
  has_attachments: number;
  has_link: number;
  has_code: number;
  topic_tags: string | null;
  language: string;
  token_count: number;
  text: string;
  text_tokenized: string;
  embedded_at: string | null;
}

export interface ChunkInsert {
  id: string;
  parent_thread_id: string;
  channel_id: string;
  channel_name: string;
  channel_category: string | null;
  generation: string | null;
  thread_id: string | null;
  thread_name: string | null;
  is_starter_only: boolean;
  message_ids: string[];
  author_ids: string[];
  author_names: string[];
  timestamp_start: string;
  timestamp_end: string;
  reply_count: number;
  reaction_positive: number;
  reaction_negative: number;
  has_attachments: boolean;
  has_link: boolean;
  has_code: boolean;
  topic_tags: string[] | null;
  language: string;
  token_count: number;
  text: string;
  text_tokenized: string;
}

export interface SearchFilters {
  generation?: string;
  channel_category?: string;
  channel_id?: string;
  timestamp_from?: string;
  timestamp_to?: string;
}

export interface BM25Hit {
  chunk_id: string;
  score: number;
}

export interface VectorHit {
  chunk_id: string;
  distance: number;
}

function b(v: boolean): number {
  return v ? 1 : 0;
}

export function upsertChunk(
  chunk: ChunkInsert,
  embedding?: Float32Array,
): void {
  const db = getRagDatabase();
  const insertChunk = db.prepare(`
    INSERT OR REPLACE INTO rag_chunks (
      id, parent_thread_id, channel_id, channel_name, channel_category, generation,
      thread_id, thread_name, is_starter_only, message_ids, author_ids, author_names,
      timestamp_start, timestamp_end, reply_count, reaction_positive, reaction_negative,
      has_attachments, has_link, has_code, topic_tags, language, token_count,
      text, text_tokenized, embedded_at
    ) VALUES (
      @id, @parent_thread_id, @channel_id, @channel_name, @channel_category, @generation,
      @thread_id, @thread_name, @is_starter_only, @message_ids, @author_ids, @author_names,
      @timestamp_start, @timestamp_end, @reply_count, @reaction_positive, @reaction_negative,
      @has_attachments, @has_link, @has_code, @topic_tags, @language, @token_count,
      @text, @text_tokenized, @embedded_at
    )
  `);

  const insertFts = db.prepare(`
    INSERT INTO rag_fts (chunk_id, text_tokenized) VALUES (?, ?)
  `);
  const deleteFts = db.prepare(`DELETE FROM rag_fts WHERE chunk_id = ?`);
  const insertVec = db.prepare(`
    INSERT INTO rag_vec (chunk_id, embedding) VALUES (?, ?)
  `);
  const deleteVec = db.prepare(`DELETE FROM rag_vec WHERE chunk_id = ?`);

  db.transaction(() => {
    insertChunk.run({
      id: chunk.id,
      parent_thread_id: chunk.parent_thread_id,
      channel_id: chunk.channel_id,
      channel_name: chunk.channel_name,
      channel_category: chunk.channel_category,
      generation: chunk.generation,
      thread_id: chunk.thread_id,
      thread_name: chunk.thread_name,
      is_starter_only: b(chunk.is_starter_only),
      message_ids: JSON.stringify(chunk.message_ids),
      author_ids: JSON.stringify(chunk.author_ids),
      author_names: JSON.stringify(chunk.author_names),
      timestamp_start: chunk.timestamp_start,
      timestamp_end: chunk.timestamp_end,
      reply_count: chunk.reply_count,
      reaction_positive: chunk.reaction_positive,
      reaction_negative: chunk.reaction_negative,
      has_attachments: b(chunk.has_attachments),
      has_link: b(chunk.has_link),
      has_code: b(chunk.has_code),
      topic_tags: chunk.topic_tags ? JSON.stringify(chunk.topic_tags) : null,
      language: chunk.language,
      token_count: chunk.token_count,
      text: chunk.text,
      text_tokenized: chunk.text_tokenized,
      embedded_at: embedding ? new Date().toISOString() : null,
    });

    deleteFts.run(chunk.id);
    insertFts.run(chunk.id, chunk.text_tokenized);

    if (embedding) {
      deleteVec.run(chunk.id);
      insertVec.run(chunk.id, Buffer.from(embedding.buffer));
    }
  })();
}

export function attachEmbedding(
  chunkId: string,
  embedding: Float32Array,
): void {
  const db = getRagDatabase();
  db.transaction(() => {
    db.prepare(`DELETE FROM rag_vec WHERE chunk_id = ?`).run(chunkId);
    db.prepare(`INSERT INTO rag_vec (chunk_id, embedding) VALUES (?, ?)`).run(
      chunkId,
      Buffer.from(embedding.buffer),
    );
    db.prepare(`UPDATE rag_chunks SET embedded_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      chunkId,
    );
  })();
}

export function wipeChunks(): void {
  const db = getRagDatabase();
  db.transaction(() => {
    db.exec(
      `DELETE FROM rag_chunks; DELETE FROM rag_fts; DELETE FROM rag_vec;`,
    );
  })();
}

export function countChunks(): number {
  const db = getRagDatabase();
  return (
    (db.prepare(`SELECT COUNT(*) as c FROM rag_chunks`).get() as { c: number })
      .c ?? 0
  );
}

export function countUnembedded(): number {
  const db = getRagDatabase();
  return (
    (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM rag_chunks WHERE embedded_at IS NULL`,
        )
        .get() as { c: number }
    ).c ?? 0
  );
}

export function listUnembedded(limit: number): ChunkRow[] {
  const db = getRagDatabase();
  return db
    .prepare(
      `SELECT * FROM rag_chunks WHERE embedded_at IS NULL ORDER BY id LIMIT ?`,
    )
    .all(limit) as ChunkRow[];
}

export function getChunk(id: string): ChunkRow | undefined {
  const db = getRagDatabase();
  return db.prepare(`SELECT * FROM rag_chunks WHERE id = ?`).get(id) as
    | ChunkRow
    | undefined;
}

export function getChunksByThread(parentThreadId: string): ChunkRow[] {
  const db = getRagDatabase();
  return db
    .prepare(`SELECT * FROM rag_chunks WHERE parent_thread_id = ? ORDER BY id`)
    .all(parentThreadId) as ChunkRow[];
}

export interface ChannelLabelRow {
  channel_id: string;
  channel_name: string;
  primary_topic: string | null;
  topics: string | null;
  description: string | null;
  answers_questions: string | null;
  does_not_answer: string | null;
}

export function getAllChannelLabels(): ChannelLabelRow[] {
  const db = getRagDatabase();
  return db.prepare(`SELECT * FROM rag_channel`).all() as ChannelLabelRow[];
}

export function getChunkLabels(chunkIds: string[]): Map<
  string,
  {
    signal_score: number | null;
    is_smalltalk: number | null;
    is_canonical: number | null;
    is_question: number | null;
    age_bucket: string | null;
    channel_id: string;
    channel_category: string | null;
  }
> {
  const db = getRagDatabase();
  if (chunkIds.length === 0) return new Map();
  const placeholders = chunkIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, signal_score, is_smalltalk, is_canonical, is_question,
              age_bucket, channel_id, channel_category
       FROM rag_chunks WHERE id IN (${placeholders})`,
    )
    .all(...chunkIds) as Array<{
    id: string;
    signal_score: number | null;
    is_smalltalk: number | null;
    is_canonical: number | null;
    is_question: number | null;
    age_bucket: string | null;
    channel_id: string;
    channel_category: string | null;
  }>;
  const m = new Map();
  for (const r of rows) {
    const { id, ...rest } = r;
    m.set(id, rest);
  }
  return m;
}

function buildFilterClause(filters: SearchFilters): {
  clause: string;
  params: unknown[];
} {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filters.generation) {
    conds.push("generation = ?");
    params.push(filters.generation);
  }
  if (filters.channel_category) {
    conds.push("channel_category = ?");
    params.push(filters.channel_category);
  }
  if (filters.channel_id) {
    conds.push("channel_id = ?");
    params.push(filters.channel_id);
  }
  if (filters.timestamp_from) {
    conds.push("timestamp_start >= ?");
    params.push(filters.timestamp_from);
  }
  if (filters.timestamp_to) {
    conds.push("timestamp_end <= ?");
    params.push(filters.timestamp_to);
  }
  return {
    clause: conds.length ? ` AND ${conds.join(" AND ")}` : "",
    params,
  };
}

/**
 * BM25 over `rag_fts.text_tokenized`. Lower bm25() score = better match.
 * 입력은 공백 분리 토큰 문자열. fts5 의 기본 AND 매칭이 너무 빡빡하므로 OR 로 join.
 * (정밀도는 BM25 score 와 후단 re-rank 가 보정)
 */
export function searchBM25(
  tokenizedQuery: string,
  limit: number,
  filters: SearchFilters = {},
): BM25Hit[] {
  const db = getRagDatabase();
  const tokens = tokenizedQuery.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const ftsQuery = tokens.join(" OR ");
  const { clause, params } = buildFilterClause(filters);
  const sql = `
    SELECT f.chunk_id as chunk_id, bm25(rag_fts) as score
    FROM rag_fts f
    JOIN rag_chunks c ON c.id = f.chunk_id
    WHERE f.text_tokenized MATCH ?${clause}
    ORDER BY score
    LIMIT ?
  `;
  return db.prepare(sql).all(ftsQuery, ...params, limit) as BM25Hit[];
}

/** Dense vector KNN via sqlite-vec. Smaller distance = closer. */
export function searchVector(
  embedding: Float32Array,
  limit: number,
  filters: SearchFilters = {},
): VectorHit[] {
  const db = getRagDatabase();
  const { clause, params } = buildFilterClause(filters);
  // sqlite-vec 의 KNN 구문: vec0 가상 테이블에 MATCH 로 쿼리 벡터 바인딩 + k=?
  // 필터링을 위해 rag_chunks 와 join.
  const sql = `
    SELECT v.chunk_id as chunk_id, v.distance as distance
    FROM rag_vec v
    JOIN rag_chunks c ON c.id = v.chunk_id
    WHERE v.embedding MATCH ? AND k = ?${clause}
    ORDER BY distance
    LIMIT ?
  `;
  return db
    .prepare(sql)
    .all(Buffer.from(embedding.buffer), limit, ...params, limit) as VectorHit[];
}
