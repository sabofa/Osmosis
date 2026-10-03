import type { DatabaseSync } from "node:sqlite";

// The pool shape weak weighting needs: an item and its lineage. draw.ts's
// EligibleQuestion satisfies it.
export interface WeightedItem {
  id: string;
  lineage_id: string;
}

// ----------------------------------------------------------------------------
// weak_weighted: for each lineage, mean of its last three authoritative scores
// (0.5 if never answered), scaled by a recency factor (0.25 if the most recent
// answer was within the last 24h, so one bad session doesn't dominate a day).
// ----------------------------------------------------------------------------

interface LineageStat {
  mean_score: number;
  most_recent: string;
}

function computeLineageStats(db: DatabaseSync, lineageIds: string[]): Map<string, LineageStat> {
  const stats = new Map<string, LineageStat>();
  if (lineageIds.length === 0) return stats;

  const unique = [...new Set(lineageIds)];
  const placeholders = unique.map(() => "?").join(", ");

  const rows = db
    .prepare(
      `WITH scored AS (
         SELECT q.lineage_id AS lineage_id, rs.score AS score, r.answered_at AS answered_at,
                ROW_NUMBER() OVER (PARTITION BY q.lineage_id ORDER BY r.answered_at DESC) AS rn
         FROM response_score rs
         JOIN response r ON r.id = rs.response_id
         JOIN attempt a ON a.id = r.attempt_id AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL
         JOIN question q ON q.id = rs.question_id
         WHERE rs.score IS NOT NULL AND q.lineage_id IN (${placeholders})
       )
       SELECT lineage_id, AVG(score) AS mean_score, MAX(answered_at) AS most_recent
       FROM scored
       WHERE rn <= 3
       GROUP BY lineage_id`
    )
    .all(...unique) as { lineage_id: string; mean_score: number; most_recent: string }[];

  for (const r of rows) stats.set(r.lineage_id, { mean_score: r.mean_score, most_recent: r.most_recent });
  return stats;
}

function weightFor(stat: LineageStat | undefined, now: Date): number {
  const s = stat ? stat.mean_score : 0.5;
  let r = 1.0;
  if (stat) {
    const ageMs = now.getTime() - new Date(`${stat.most_recent}Z`).getTime();
    if (ageMs <= 24 * 60 * 60 * 1000) r = 0.25;
  }
  return (1 + 2 * (1 - s)) * r;
}

export function computeWeakWeights(db: DatabaseSync, pool: WeightedItem[], now: Date = new Date()): number[] {
  const stats = computeLineageStats(
    db,
    pool.map((q) => q.lineage_id)
  );
  return pool.map((q) => weightFor(stats.get(q.lineage_id), now));
}

// ----------------------------------------------------------------------------
// Weighted sampling without replacement. O(n * k); fine at personal-bank scale.
// ----------------------------------------------------------------------------

export function weightedSampleWithoutReplacement<T>(
  items: T[],
  weights: number[],
  count: number,
  rng: () => number = Math.random
): T[] {
  const pool = items.map((item, i) => ({ item, weight: weights[i] }));
  const n = Math.min(count, pool.length);
  const result: T[] = [];

  for (let k = 0; k < n; k++) {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let r = rng() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    result.push(pool[idx].item);
    pool.splice(idx, 1);
  }

  return result;
}

