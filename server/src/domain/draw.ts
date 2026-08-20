import type { DatabaseSync } from "node:sqlite";
import { buildTagQueryClause, type TagQuery } from "./tagQuery.js";
import { DomainError } from "./errors.js";

export type CalculatorFilter = "allowed" | "forbidden" | "any";

export interface EligibilityParams {
  tag_query?: TagQuery;
  difficulty_min?: number | null;
  difficulty_max?: number | null;
  calculator_policy?: CalculatorFilter;
  exclude_lineage_ids?: string[];
}

export interface EligibleQuestion {
  id: string;
  lineage_id: string;
  type: "mc" | "written";
}

function buildEligibilityClause(params: EligibilityParams): { sql: string; args: unknown[] } {
  const clauses = [
    "q.retired_at IS NULL",
    "NOT EXISTS (SELECT 1 FROM question q2 WHERE q2.lineage_id = q.lineage_id AND q2.version > q.version)",
  ];
  const args: unknown[] = [];

  if (params.difficulty_min !== undefined && params.difficulty_min !== null) {
    clauses.push("q.difficulty >= ?");
    args.push(params.difficulty_min);
  }
  if (params.difficulty_max !== undefined && params.difficulty_max !== null) {
    clauses.push("q.difficulty <= ?");
    args.push(params.difficulty_max);
  }
  if (params.calculator_policy && params.calculator_policy !== "any") {
    clauses.push("q.calculator_policy = ?");
    args.push(params.calculator_policy);
  }

  if (params.exclude_lineage_ids && params.exclude_lineage_ids.length > 0) {
    clauses.push(`q.lineage_id NOT IN (${params.exclude_lineage_ids.map(() => "?").join(",")})`);
    args.push(...params.exclude_lineage_ids);
  }

  const tagClause = params.tag_query ? buildTagQueryClause(params.tag_query) : { sql: "", params: [] };

  return { sql: `WHERE ${clauses.join(" AND ")} ${tagClause.sql}`.trim(), args: [...args, ...tagClause.params] };
}

export function getEligibleQuestions(db: DatabaseSync, params: EligibilityParams): EligibleQuestion[] {
  const { sql, args } = buildEligibilityClause(params);
  return db
    .prepare(`SELECT q.id, q.lineage_id, q.type FROM question q ${sql}`)
    .all(...(args as any[])) as unknown as EligibleQuestion[];
}

export function countEligible(db: DatabaseSync, params: EligibilityParams): number {
  const { sql, args } = buildEligibilityClause(params);
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM question q ${sql}`).get(...(args as any[])) as { n: number }
  ).n;
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

export function computeWeakWeights(db: DatabaseSync, pool: EligibleQuestion[], now: Date = new Date()): number[] {
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

// ----------------------------------------------------------------------------
// mc_ratio partition: split question_count into an MC side and a written side,
// backfilling from whichever side has room when the other comes up short.
// ----------------------------------------------------------------------------

function splitMcRatio(
  mcAvail: number,
  writtenAvail: number,
  questionCount: number,
  mcRatio: number
): { mcTake: number; writtenTake: number; mixAdjusted: boolean } {
  const mcWant = Math.round(questionCount * mcRatio);
  const writtenWant = questionCount - mcWant;

  let mcTake = Math.min(mcWant, mcAvail);
  let writtenTake = Math.min(writtenWant, writtenAvail);
  let mixAdjusted = false;

  const mcDeficit = mcWant - mcTake;
  const writtenDeficit = writtenWant - writtenTake;

  if (mcDeficit > 0) {
    const extra = Math.min(mcDeficit, writtenAvail - writtenTake);
    if (extra > 0) {
      writtenTake += extra;
      mixAdjusted = true;
    }
  }
  if (writtenDeficit > 0) {
    const extra = Math.min(writtenDeficit, mcAvail - mcTake);
    if (extra > 0) {
      mcTake += extra;
      mixAdjusted = true;
    }
  }

  return { mcTake, writtenTake, mixAdjusted };
}

// ----------------------------------------------------------------------------
// Draw resolution
// ----------------------------------------------------------------------------

export interface DrawParams {
  tag_query?: TagQuery;
  question_count: number;
  mc_ratio?: number | null;
  difficulty_min?: number | null;
  difficulty_max?: number | null;
  calculator_policy?: CalculatorFilter;
  weighting?: "random" | "weak_weighted" | null;
}

export interface DrawResult {
  questions: EligibleQuestion[];
  short_draw: boolean;
  requested: number;
  returned: number;
  mix_adjusted?: boolean;
}

export function getDefaultWeighting(db: DatabaseSync): "random" | "weak_weighted" {
  const row = db.prepare("SELECT value FROM config WHERE key = 'default_weighting'").get() as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as "random" | "weak_weighted") : "random";
}

function weightsFor(
  db: DatabaseSync,
  pool: EligibleQuestion[],
  weighting: "random" | "weak_weighted"
): number[] {
  return weighting === "weak_weighted" ? computeWeakWeights(db, pool) : pool.map(() => 1);
}

export function resolveDrawFromParams(
  db: DatabaseSync,
  params: DrawParams,
  rng: () => number = Math.random
): DrawResult {
  const weighting = params.weighting ?? getDefaultWeighting(db);
  const eligParams: EligibilityParams = {
    tag_query: params.tag_query,
    difficulty_min: params.difficulty_min ?? null,
    difficulty_max: params.difficulty_max ?? null,
    calculator_policy: params.calculator_policy ?? "any",
  };
  const pool = getEligibleQuestions(db, eligParams);

  if (params.mc_ratio !== undefined && params.mc_ratio !== null) {
    const mcPool = pool.filter((q) => q.type === "mc");
    const writtenPool = pool.filter((q) => q.type === "written");
    const split = splitMcRatio(mcPool.length, writtenPool.length, params.question_count, params.mc_ratio);

    const mcDrawn = weightedSampleWithoutReplacement(
      mcPool,
      weightsFor(db, mcPool, weighting),
      split.mcTake,
      rng
    );
    const writtenDrawn = weightedSampleWithoutReplacement(
      writtenPool,
      weightsFor(db, writtenPool, weighting),
      split.writtenTake,
      rng
    );

    const questions = [...mcDrawn, ...writtenDrawn];
    return {
      questions,
      short_draw: questions.length < params.question_count,
      requested: params.question_count,
      returned: questions.length,
      mix_adjusted: split.mixAdjusted,
    };
  }

  const questions = weightedSampleWithoutReplacement(
    pool,
    weightsFor(db, pool, weighting),
    params.question_count,
    rng
  );

  return {
    questions,
    short_draw: questions.length < params.question_count,
    requested: params.question_count,
    returned: questions.length,
  };
}

export function resolveFrozenDraw(db: DatabaseSync, templateId: string): EligibleQuestion[] {
  return db
    .prepare(
      `SELECT q.id, q.lineage_id, q.type
       FROM template_frozen_question tfq
       JOIN question q ON q.id = tfq.question_id
       WHERE tfq.template_id = ?
       ORDER BY tfq.ordinal`
    )
    .all(templateId) as unknown as EligibleQuestion[];
}

interface TemplateDrawRow {
  frozen: 0 | 1;
  tag_query: string;
  question_count: number;
  mc_ratio: number | null;
  difficulty_min: number | null;
  difficulty_max: number | null;
  calculator_policy: CalculatorFilter;
  weighting: "random" | "weak_weighted" | null;
  retired_at: string | null;
}

// Resolves a template by id: stored order if frozen, a fresh sampled draw otherwise.
export function resolveTemplateDraw(
  db: DatabaseSync,
  templateId: string,
  rng: () => number = Math.random
): DrawResult {
  const template = db.prepare("SELECT * FROM template WHERE id = ?").get(templateId) as
    | TemplateDrawRow
    | undefined;
  if (!template) throw new DomainError("not_found", `Template "${templateId}" does not exist.`);
  if (template.retired_at) throw new DomainError("template_retired", `Template "${templateId}" is retired.`);

  if (template.frozen) {
    const questions = resolveFrozenDraw(db, templateId);
    return { questions, short_draw: false, requested: questions.length, returned: questions.length };
  }

  return resolveDrawFromParams(
    db,
    {
      tag_query: JSON.parse(template.tag_query),
      question_count: template.question_count,
      mc_ratio: template.mc_ratio,
      difficulty_min: template.difficulty_min,
      difficulty_max: template.difficulty_max,
      calculator_policy: template.calculator_policy,
      weighting: template.weighting,
    },
    rng
  );
}
