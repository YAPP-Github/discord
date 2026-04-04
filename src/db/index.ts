import Database from "better-sqlite3";
import { config } from "../config.js";
import { runMigrations } from "./schema.js";

let db: Database.Database;

export function initDatabase(): Database.Database {
  db = new Database(config.db.path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error("Database not initialized");
  return db;
}
