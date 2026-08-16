import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  const fts5 = db
    .prepare("SELECT compile_options FROM pragma_compile_options WHERE compile_options LIKE 'ENABLE_FTS5'")
    .all();
  if (fts5.length === 0) {
    throw new Error(
      "SQLite build lacks FTS5 (ENABLE_FTS5 not in pragma_compile_options). " +
        "Duplicate detection requires it and has no fallback."
    );
  }

  return db;
}
