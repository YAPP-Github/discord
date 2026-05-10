import { initDatabase } from "../../src/db/index.js";

// Reinitialise the SQLite singleton at :memory:. Each call gets a fresh DB.
// `tests/setup.ts` sets DATABASE_PATH=:memory: so initDatabase() picks that up.
export function initTestDb() {
  return initDatabase();
}
