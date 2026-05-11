import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { getEmbedDim } from "../services/embeddingProvider.js";

const RAG_DB_PATH = process.env.RAG_DB_PATH ?? "./data/rag.db";

let ragDb: Database.Database | null = null;

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function migrateAddColumns(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(rag_chunks)").all() as Array<{
    name: string;
  }>;
  const have = new Set(cols.map((c) => c.name));
  const add = (name: string, def: string) => {
    if (!have.has(name))
      db.exec(`ALTER TABLE rag_chunks ADD COLUMN ${name} ${def}`);
  };
  add("signal_score", "REAL");
  add("is_smalltalk", "INTEGER");
  add("is_canonical", "INTEGER");
  add("is_question", "INTEGER");
  add("age_bucket", "TEXT");
}

function runMigrations(db: Database.Database): void {
  const dim = getEmbedDim();
  db.exec(`
    CREATE TABLE IF NOT EXISTS rag_chunks (
      id TEXT PRIMARY KEY,
      parent_thread_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      channel_category TEXT,
      generation TEXT,
      thread_id TEXT,
      thread_name TEXT,
      is_starter_only INTEGER NOT NULL,
      message_ids TEXT NOT NULL,
      author_ids TEXT NOT NULL,
      author_names TEXT NOT NULL,
      timestamp_start TEXT NOT NULL,
      timestamp_end TEXT NOT NULL,
      reply_count INTEGER NOT NULL,
      reaction_positive INTEGER NOT NULL,
      reaction_negative INTEGER NOT NULL,
      has_attachments INTEGER NOT NULL,
      has_link INTEGER NOT NULL,
      has_code INTEGER NOT NULL,
      topic_tags TEXT,
      language TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      text TEXT NOT NULL,
      text_tokenized TEXT NOT NULL,
      embedded_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_rag_channel ON rag_chunks(channel_id);
    CREATE INDEX IF NOT EXISTS idx_rag_generation ON rag_chunks(generation);
    CREATE INDEX IF NOT EXISTS idx_rag_category ON rag_chunks(channel_category);
    CREATE INDEX IF NOT EXISTS idx_rag_time ON rag_chunks(timestamp_start);
    CREATE INDEX IF NOT EXISTS idx_rag_parent ON rag_chunks(parent_thread_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS rag_vec USING vec0(
      chunk_id TEXT PRIMARY KEY,
      embedding float[${dim}]
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS rag_fts USING fts5(
      chunk_id UNINDEXED,
      text_tokenized,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TABLE IF NOT EXISTS rag_channel (
      channel_id TEXT PRIMARY KEY,
      channel_name TEXT NOT NULL,
      primary_topic TEXT,
      topics TEXT,                 -- JSON array
      description TEXT,
      answers_questions TEXT,      -- JSON array
      does_not_answer TEXT,        -- JSON array
      labeled_at TEXT
    );
  `);

  migrateAddColumns(db);
}

export function getRagDatabase(): Database.Database {
  if (ragDb) return ragDb;
  ensureDir(RAG_DB_PATH);
  const db = new Database(RAG_DB_PATH);
  db.pragma("journal_mode = WAL");
  sqliteVec.load(db);
  runMigrations(db);
  ragDb = db;
  return db;
}

export function closeRagDatabase(): void {
  if (ragDb) {
    ragDb.close();
    ragDb = null;
  }
}

export const ragDbPath = RAG_DB_PATH;
