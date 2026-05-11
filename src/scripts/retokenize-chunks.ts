import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { logger } from "../utils/logger.js";
import { getRagDatabase } from "../db/rag.js";
import { tokenizeJoined } from "../services/koreanTokenizer.js";

interface Row {
  id: string;
  text: string;
}

function main() {
  const db = getRagDatabase();
  const rows = db.prepare(`SELECT id, text FROM rag_chunks`).all() as Row[];
  logger.info(`Re-tokenizing ${rows.length} chunks ...`);

  const updChunk = db.prepare(
    `UPDATE rag_chunks SET text_tokenized = ? WHERE id = ?`,
  );
  const delFts = db.prepare(`DELETE FROM rag_fts WHERE chunk_id = ?`);
  const insFts = db.prepare(
    `INSERT INTO rag_fts (chunk_id, text_tokenized) VALUES (?, ?)`,
  );

  const tx = db.transaction((rows: Row[]) => {
    for (const r of rows) {
      const t = tokenizeJoined(r.text);
      updChunk.run(t, r.id);
      delFts.run(r.id);
      insFts.run(r.id, t);
    }
  });
  tx(rows);

  logger.info(`Done!`);
}

main();
