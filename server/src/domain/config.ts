import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "./errors.js";

// Every key that may be present in `config`, minus any future secret keys
// (model_grader_api_key, model_grader_name) which set_config refuses over MCP
// per spec 9.13 and are never exposed here either.
const ALLOWED_KEYS = new Set([
  "default_weighting",
  "daily_question_weighting",
  "daily_quiz_weighting",
  "daily_quiz_size",
  "daily_exclusion_days",
  "daily_tag_filter",
  "daily_timezone",
  "written_grader",
  "synced_attempt_retention_days",
  "duplicate_similarity_threshold",
  "abandon_after_hours",
]);

export function getConfig(db: DatabaseSync): Record<string, unknown> {
  const rows = db.prepare("SELECT key, value FROM config").all() as { key: string; value: string }[];
  const config: Record<string, unknown> = {};
  for (const r of rows) config[r.key] = JSON.parse(r.value);
  return config;
}

export function setConfig(db: DatabaseSync, key: string, value: unknown): { key: string; value: unknown; updated_at: string } {
  if (!ALLOWED_KEYS.has(key)) {
    throw new DomainError("unknown_key", `"${key}" is not a known, settable config key.`);
  }

  const existing = db.prepare("SELECT key FROM config WHERE key = ?").get(key);
  if (!existing) {
    throw new DomainError("unknown_key", `"${key}" is not a known, settable config key.`);
  }

  db.prepare("UPDATE config SET value = ?, updated_at = datetime('now') WHERE key = ?").run(
    JSON.stringify(value),
    key
  );

  const row = db.prepare("SELECT value, updated_at FROM config WHERE key = ?").get(key) as {
    value: string;
    updated_at: string;
  };

  return { key, value: JSON.parse(row.value), updated_at: row.updated_at };
}
