import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "./errors.js";

// Caller-supplied date strings (needs_last_until, before) funnel through
// here. A bare "YYYY-MM-DD HH:MM:SS" is exactly the format this module
// itself stores in and returns from due_at (see setRetentionTarget below),
// so the natural caller flow is "read a due_at value, pass it back in" — but
// new Date() parses a space-separated, no-timezone string as LOCAL time, not
// UTC, which would silently shift it by the server's UTC offset on any
// non-UTC host. Force UTC for that exact shape rather than trusting the
// runtime's local-time interpretation. Also converts a genuinely
// unparseable string into a legible DomainError instead of letting
// toISOString() throw a raw RangeError — these are LLM-supplied free-form
// strings via MCP tools.
function parseCallerDateMs(input: string, field: string): number {
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(input) ? input.replace(" ", "T") + "Z" : input;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) {
    throw new DomainError("invalid_date", `${field} is not a parseable date: "${input}"`);
  }
  return ms;
}

function toSqliteDatetime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

export interface SetRetentionTargetInput {
  identity_key: string;
  retention_target: string;
  target_source: "engine" | "tutor_direct";
  needs_last_until: string; // ISO date or datetime the material needs to last until
}

// Cepeda et al. 2008: optimal first gap is ~20-40% of the retention interval,
// dropping to 5-10% for year-long targets. Linear interpolation between the
// two known bands, clamped at the boundaries — not a precise model, a
// reasonable default per the source plan's own framing.
function firstGapRatio(totalDays: number): number {
  if (totalDays <= 14) return 0.3; // midpoint of 20-40%
  if (totalDays >= 365) return 0.075; // midpoint of 5-10%
  // Linear interpolation between (14, 0.3) and (365, 0.075).
  const t = (totalDays - 14) / (365 - 14);
  return 0.3 + t * (0.075 - 0.3);
}

export function setRetentionTarget(
  db: DatabaseSync,
  input: SetRetentionTargetInput
): { id: string; due_at: string; first_gap_days: number } {
  const now = Date.now();
  const target = parseCallerDateMs(input.needs_last_until, "needs_last_until");
  const totalDays = Math.max((target - now) / (1000 * 60 * 60 * 24), 0);
  const firstGapDays = totalDays * firstGapRatio(totalDays);
  const dueAtMs = now + firstGapDays * 24 * 60 * 60 * 1000;
  const dueAt = toSqliteDatetime(dueAtMs);

  const id = uuidv4();
  db.prepare(
    `INSERT INTO retention_schedule (id, identity_key, retention_target, first_gap_days, due_at, target_source)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (identity_key, retention_target) DO UPDATE SET
       first_gap_days = excluded.first_gap_days,
       due_at = excluded.due_at,
       target_source = excluded.target_source,
       last_result = 'never_attempted',
       updated_at = datetime('now')`
  ).run(id, input.identity_key, input.retention_target, firstGapDays, dueAt, input.target_source);

  const row = db
    .prepare("SELECT id, due_at, first_gap_days FROM retention_schedule WHERE identity_key = ? AND retention_target = ?")
    .get(input.identity_key, input.retention_target) as { id: string; due_at: string; first_gap_days: number };
  return row;
}

export function getNextDueForIdentity(db: DatabaseSync, identityKey: string): string | null {
  const row = db
    .prepare(
      `SELECT MIN(due_at) AS due_at FROM retention_schedule
       WHERE identity_key = ? AND last_result != 'fail'`
    )
    .get(identityKey) as { due_at: string | null };
  return row.due_at;
}

export function getDueItems(
  db: DatabaseSync,
  opts: { before?: string; limit?: number; offset?: number } = {}
): { total: number; items: unknown[]; has_more: boolean } {
  // Normalize before to "YYYY-MM-DD HH:MM:SS" format to match stored due_at values.
  // Accepts both ISO-8601 (with T separator) and space-separated formats —
  // the latter is exactly what due_at itself is stored/returned as, so
  // parseCallerDateMs forces UTC on that shape rather than letting the
  // server's local timezone shift it.
  const normalizedBefore = opts.before
    ? toSqliteDatetime(parseCallerDateMs(opts.before, "before"))
    : toSqliteDatetime(Date.now());
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const total = (
    db.prepare("SELECT COUNT(*) AS n FROM retention_schedule WHERE due_at <= ?").get(normalizedBefore) as { n: number }
  ).n;

  const items = db
    .prepare(
      `SELECT id, identity_key, retention_target, due_at, last_result, target_source
       FROM retention_schedule WHERE due_at <= ? ORDER BY due_at ASC, id ASC LIMIT ? OFFSET ?`
    )
    .all(normalizedBefore, limit, offset);

  return { total, items, has_more: offset + items.length < total };
}

export function recordRetentionResult(db: DatabaseSync, identityKey: string, retentionTarget: string, passed: boolean): void {
  const row = db
    .prepare("SELECT id FROM retention_schedule WHERE identity_key = ? AND retention_target = ?")
    .get(identityKey, retentionTarget) as { id: string } | undefined;
  if (!row) throw new DomainError("not_found", `No retention_schedule row for "${identityKey}"/"${retentionTarget}".`);
  db.prepare("UPDATE retention_schedule SET last_result = ?, updated_at = datetime('now') WHERE id = ?").run(
    passed ? "pass" : "fail",
    row.id
  );
}
