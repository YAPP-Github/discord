import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { logger } from "../utils/logger.js";
import { getRagDatabase } from "../db/rag.js";
import { computeLabels } from "../services/chunkLabels.js";

interface Row {
  id: string;
  text: string;
  channel_category: string | null;
  is_starter_only: number;
  reply_count: number;
  reaction_positive: number;
  reaction_negative: number;
  has_attachments: number;
  has_link: number;
  has_code: number;
  token_count: number;
  timestamp_start: string;
}

function main() {
  const db = getRagDatabase();
  const now = new Date();
  const rows = db
    .prepare(
      `SELECT id, text, channel_category, is_starter_only, reply_count,
       reaction_positive, reaction_negative, has_attachments, has_link, has_code,
       token_count, timestamp_start FROM rag_chunks`,
    )
    .all() as Row[];

  logger.info(`Computing labels for ${rows.length} chunks ...`);

  const upd = db.prepare(
    `UPDATE rag_chunks SET
      signal_score = @signal_score,
      is_smalltalk = @is_smalltalk,
      is_canonical = @is_canonical,
      is_question = @is_question,
      age_bucket = @age_bucket
     WHERE id = @id`,
  );

  const buckets: Record<string, number> = {};
  let smalltalk = 0;
  let canonical = 0;
  let question = 0;
  let sumSignal = 0;

  const tx = db.transaction((rows: Row[]) => {
    for (const r of rows) {
      const labels = computeLabels(r, now);
      upd.run({ id: r.id, ...labels });
      buckets[labels.age_bucket] = (buckets[labels.age_bucket] ?? 0) + 1;
      smalltalk += labels.is_smalltalk;
      canonical += labels.is_canonical;
      question += labels.is_question;
      sumSignal += labels.signal_score;
    }
  });
  tx(rows);

  logger.info(`Done!`);
  logger.info(`  total:        ${rows.length}`);
  logger.info(`  smalltalk:    ${smalltalk}`);
  logger.info(`  canonical:    ${canonical}`);
  logger.info(`  question:     ${question}`);
  logger.info(`  avg signal:   ${(sumSignal / rows.length).toFixed(3)}`);
  logger.info(`  age buckets:  ${JSON.stringify(buckets)}`);
}

main();
