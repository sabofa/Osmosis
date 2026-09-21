import type { DatabaseSync } from "node:sqlite";
import { isValidSlug } from "./tags.js";

// ----------------------------------------------------------------------------
// node_keys (§3.10) — the tutor's own identifiers for the teachable idea an
// item targets, finer-grained than a tag. An item can carry several; the
// first is primary and is what question.node_key (the singular column every
// older reader still uses) is kept in sync with.
// ----------------------------------------------------------------------------

// Same grammar as a tag slug (Task 1), plus a `node:` root so a node key is
// never mistaken for a tag slug in a field that accepts either — e.g.
// set_retention_target's identity_key.
export const NODE_KEY_PREFIX = "node:";

export function isValidNodeKey(key: string): boolean {
  return key.startsWith(NODE_KEY_PREFIX) && isValidSlug(key);
}

export interface NodeKeyInput {
  node_key?: string | null;
  node_keys?: string[] | null;
}

// Validation shared by create and edit. Returns a rejection or null.
// The singular node_key is deliberately NOT grammar-checked: it predates this
// grammar and older items carry free-form values. Only the plural form, which
// is new, is held to it.
export function validateNodeKeys(input: NodeKeyInput): { reason: string; detail: string } | null {
  const list = input.node_keys;
  if (list == null) return null;
  if (!Array.isArray(list)) {
    return { reason: "invalid_node_key", detail: "node_keys must be an array of strings" };
  }
  for (const key of list) {
    if (typeof key !== "string" || !isValidNodeKey(key)) {
      return {
        reason: "invalid_node_key",
        detail:
          `node_keys entry ${JSON.stringify(key)} is not a valid node key — it must start with "${NODE_KEY_PREFIX}" ` +
          "and follow the tag slug grammar (lowercase ascii segments joined by ':', words joined by '_' or '.').",
      };
    }
  }
  if (list.length > 0 && input.node_key != null && input.node_key !== list[0]) {
    return {
      reason: "node_key_mismatch",
      detail: `node_key "${input.node_key}" disagrees with node_keys[0] "${list[0]}" — the first node_keys entry is the primary.`,
    };
  }
  return null;
}

// The set to store, primary first and de-duplicated. Either form alone works;
// together, node_keys wins (validateNodeKeys has already refused a
// disagreeing pair).
export function resolveNodeKeys(input: NodeKeyInput): string[] {
  const list = input.node_keys != null && input.node_keys.length > 0 ? input.node_keys : input.node_key ? [input.node_key] : [];
  return [...new Set(list)];
}

export function primaryNodeKey(input: NodeKeyInput): string | null {
  return resolveNodeKeys(input)[0] ?? null;
}

export function replaceNodeKeys(db: DatabaseSync, questionId: string, keys: string[]): void {
  db.prepare("DELETE FROM question_node_key WHERE question_id = ?").run(questionId);
  const insert = db.prepare(
    "INSERT INTO question_node_key (question_id, node_key, is_primary, ordinal) VALUES (?, ?, ?, ?)"
  );
  keys.forEach((key, i) => insert.run(questionId, key, i === 0 ? 1 : 0, i));
}

// Primary first, then the rest in stored order. Falls back to the singular
// column for a row written before question_node_key existed and never
// re-saved since (the 018 backfill covers everything at migration time, but a
// direct INSERT in a test or a sync pull can still set only the column).
export function getNodeKeys(db: DatabaseSync, questionId: string): string[] {
  const rows = db
    .prepare("SELECT node_key FROM question_node_key WHERE question_id = ? ORDER BY is_primary DESC, ordinal ASC")
    .all(questionId) as { node_key: string }[];
  if (rows.length > 0) return rows.map((r) => r.node_key);
  const fallback = db.prepare("SELECT node_key FROM question WHERE id = ?").get(questionId) as
    | { node_key: string | null }
    | undefined;
  return fallback?.node_key ? [fallback.node_key] : [];
}

// The pair every read path attaches: the full set plus its primary, so a
// caller that only knows the singular field keeps working.
export function nodeKeyFields(db: DatabaseSync, questionId: string): { node_key: string | null; node_keys: string[] } {
  const keys = getNodeKeys(db, questionId);
  return { node_key: keys[0] ?? null, node_keys: keys };
}

// WHERE fragment for search_questions's node_key filter: exact match, or
// prefix match when the caller's value ends with ':' ("node:ebbing11e:2.4:"
// matches every key under that section).
// The `q.node_key OR` half mirrors getNodeKeys' fallback: a row written
// straight to the column (a sync pull, a raw test INSERT) has no
// question_node_key rows yet and must still be findable by its primary key.
export function nodeKeyFilterClause(value: string): { sql: string; params: unknown[] } {
  if (value.endsWith(":")) {
    const pattern = `${value.replace(/[\\%_]/g, "\\$&")}%`;
    return {
      sql:
        "(EXISTS (SELECT 1 FROM question_node_key nk WHERE nk.question_id = q.id AND nk.node_key LIKE ? ESCAPE '\\')" +
        " OR q.node_key LIKE ? ESCAPE '\\')",
      params: [pattern, pattern],
    };
  }
  return {
    sql:
      "(EXISTS (SELECT 1 FROM question_node_key nk WHERE nk.question_id = q.id AND nk.node_key = ?)" +
      " OR q.node_key = ?)",
    params: [value, value],
  };
}
