import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "./errors.js";

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
  const target = new Date(input.needs_last_until).getTime();
  const totalDays = Math.max((target - now) / (1000 * 60 * 60 * 24), 0);
  const firstGapDays = totalDays * firstGapRatio(totalDays);
  const dueAtMs = now + firstGapDays * 24 * 60 * 60 * 1000;
  const dueAt = new Date(dueAtMs).toISOString().replace("T", " ").slice(0, 19);

  const id = uuidv4();
  db.prepare(
    `INSERT INTO retention_schedule (id, identity_key, retention_target, first_gap_days, due_at, target_source)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (identity_key, retention_target) DO UPDATE SET
       first_gap_days = excluded.first_gap_days,
       due_at = excluded.due_at,
       target_source = excluded.target_source,
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
  const before = opts.before ?? new Date().toISOString().replace("T", " ").slice(0, 19);
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const total = (
    db.prepare("SELECT COUNT(*) AS n FROM retention_schedule WHERE due_at <= ?").get(before) as { n: number }
  ).n;

  const items = db
    .prepare(
      `SELECT id, identity_key, retention_target, due_at, last_result, target_source
       FROM retention_schedule WHERE due_at <= ? ORDER BY due_at ASC, id ASC LIMIT ? OFFSET ?`
    )
    .all(before, limit, offset);

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
