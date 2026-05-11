import dotenv from "dotenv";
// .env.local 이 시스템 환경변수보다 우선하도록 override
dotenv.config({
  path: process.env.NODE_ENV === "prod" ? ".env.prod" : ".env.local",
  override: true,
});

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";
import {
  upsertChunk,
  countChunks,
  countUnembedded,
  listUnembedded,
  attachEmbedding,
  wipeChunks,
} from "../db/repositories/ragRepository.js";
import type { ChunkInsert } from "../db/repositories/ragRepository.js";
import {
  embedTexts,
  getEmbedProviderInfo,
} from "../services/embeddingProvider.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSONL_PATH = join(__dirname, "../../data/export/rag/chunks.jsonl");

const BATCH_SIZE = 100;
const EMBED_LIMIT = process.env.EMBED_LIMIT
  ? parseInt(process.env.EMBED_LIMIT, 10)
  : Infinity;

interface ChunkJsonl {
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

function loadJsonlToDb(): number {
  if (!existsSync(JSONL_PATH)) {
    throw new Error(
      `Chunks JSONL not found: ${JSONL_PATH}. Run 'npm run build-rag-chunks' first.`,
    );
  }
  // readline 은 일부 unicode 줄바꿈을 분할 경계로 오인하는 케이스가 있어
  // \n 으로만 split 하는 단순 파싱으로 안전성 확보. 25MB 정도는 메모리 처리 OK.
  const raw = readFileSync(JSONL_PATH, "utf-8");
  const lines = raw.split("\n").filter((l) => l.length > 0);

  // Resume 가능하게: 이미 같은 수의 청크가 DB 에 있으면 적재 단계 skip.
  // (chunks.jsonl 이 wipe&rebuild 라 id 는 매번 새로 생성되므로, jsonl 갱신 후엔 DB 도 wipe 해야 함)
  const existing = countChunks();
  if (existing === lines.length) {
    logger.info(
      `  ${existing} chunks already in DB — skipping JSONL load (resume mode)`,
    );
    return 0;
  }
  if (existing > 0 && existing !== lines.length) {
    logger.info(
      `  DB has ${existing} chunks but JSONL has ${lines.length} — wiping and reloading`,
    );
    wipeChunks();
  }

  let loaded = 0;
  for (const line of lines) {
    const chunk = JSON.parse(line) as ChunkJsonl;
    const insert: ChunkInsert = { ...chunk };
    upsertChunk(insert);
    loaded += 1;
    if (loaded % 500 === 0) logger.info(`  loaded ${loaded} chunks`);
  }
  return loaded;
}

async function main() {
  const info = getEmbedProviderInfo();
  logger.info(`Embedding model: ${info.model} / dim: ${info.dim}`);

  logger.info("[1/2] Loading chunks JSONL into rag.db ...");
  const loaded = loadJsonlToDb();
  logger.info(`  chunks in DB: ${countChunks()}  (loaded this run: ${loaded})`);

  if (EMBED_LIMIT !== Infinity) {
    logger.info(`  EMBED_LIMIT=${EMBED_LIMIT} (test mode)`);
  }

  logger.info("[2/2] Embedding unembedded chunks ...");
  let processed = 0;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;
  while (processed < EMBED_LIMIT) {
    const remaining = EMBED_LIMIT - processed;
    const take = Math.min(BATCH_SIZE, remaining);
    const batch = listUnembedded(take);
    if (batch.length === 0) break;
    try {
      const embeddings = await embedTexts(batch.map((c) => c.text));
      for (let i = 0; i < batch.length; i++) {
        attachEmbedding(batch[i].id, embeddings[i]);
      }
      processed += batch.length;
      consecutiveFailures = 0;
      logger.info(`  embedded ${processed} (remaining: ${countUnembedded()})`);
    } catch (err) {
      consecutiveFailures += 1;
      const msg = err instanceof Error ? err.message : String(err);
      const is429 = msg.includes("429");
      const backoffMs = is429
        ? Math.min(60_000, 5_000 * 2 ** (consecutiveFailures - 1))
        : 2_000;
      logger.error(
        `  batch failed (attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}, first id=${batch[0].id}, backoff=${backoffMs}ms): ${msg}`,
      );
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        logger.error(
          `Aborting after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. ` +
            `Hint: 429 indicates OpenAI rate limit — wait and retry, or check your account quota.`,
        );
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }

  logger.info(
    `\nDone! total embedded chunks: ${countChunks() - countUnembedded()}`,
  );
}

main().catch((err) => {
  logger.error("embed-chunks failed", err);
  process.exit(1);
});
