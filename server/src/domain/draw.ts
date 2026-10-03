import type { DatabaseSync } from "node:sqlite";
import { buildTagQueryClause, type TagQuery } from "./tagQuery.js";
import { DomainError } from "./errors.js";
import { computeWeakWeights, weightedSampleWithoutReplacement } from "./weights.js";
import { dueInfoByLineage, dueWeightFactor, rankByDue, type DueMode } from "./retention.js";

// Re-exported: these lived here before retention needed them too.
export { computeWeakWeights, weightedSampleWithoutReplacement };

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

export function buildEligibilityClause(params: EligibilityParams): { sql: string; args: unknown[] } {
  const clauses = [
    "q.retired_at IS NULL",
    // An ephemeral item exists for one live moment in one session; it is
    // never drawable, by template, daily draw, or tag_query pick.
    "q.ephemeral = 0",
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
  // How due-ness shapes the draw (retention.ts). Absent = "off": a caller
  // that says nothing gets the draw it always got; templates pass their own.
  due_mode?: DueMode | null;
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
  const dueMode = params.due_mode ?? "off";

  if (dueMode === "gate") return resolveGatedDraw(db, pool, params, weighting);

  // "weight": a due item counts two to four times as much as it otherwise
  // would; nothing is excluded, and a pool with nothing scheduled draws
  // exactly as "off" does.
  const due = dueMode === "weight" ? dueInfoByLineage(db) : null;
  const weightsFor = (items: EligibleQuestion[]): number[] => {
    const base = weighting === "weak_weighted" ? computeWeakWeights(db, items) : items.map(() => 1);
    return due ? base.map((w, i) => w * dueWeightFactor(due.get(items[i].lineage_id))) : base;
  };

  if (params.mc_ratio !== undefined && params.mc_ratio !== null) {
    const mcPool = pool.filter((q) => q.type === "mc");
    const writtenPool = pool.filter((q) => q.type === "written");
    const split = splitMcRatio(mcPool.length, writtenPool.length, params.question_count, params.mc_ratio);

    const mcDrawn = weightedSampleWithoutReplacement(mcPool, weightsFor(mcPool), split.mcTake, rng);
    const writtenDrawn = weightedSampleWithoutReplacement(writtenPool, weightsFor(writtenPool), split.writtenTake, rng);

    const questions = [...mcDrawn, ...writtenDrawn];
    return {
      questions,
      short_draw: questions.length < params.question_count,
      requested: params.question_count,
      returned: questions.length,
      mix_adjusted: split.mixAdjusted,
    };
  }

  const questions = weightedSampleWithoutReplacement(pool, weightsFor(pool), params.question_count, rng);

  return {
    questions,
    short_draw: questions.length < params.question_count,
    requested: params.question_count,
    returned: questions.length,
  };
}

// "gate": a homework or review set Osmosis schedules. Only due items are
// eligible, most overdue first; when the draw is weak_weighted, weakness
// orders items equally overdue. mc_ratio splits the ranked set the same way
// it splits a sampled one. Nothing due is an empty draw, not a fallback.
function resolveGatedDraw(
  db: DatabaseSync,
  pool: EligibleQuestion[],
  params: DrawParams,
  weighting: "random" | "weak_weighted"
): DrawResult {
  const due = dueInfoByLineage(db);
  const ranked = rankByDue(pool, due, weighting === "weak_weighted" ? computeWeakWeights(db, pool) : undefined);

  let questions: EligibleQuestion[];
  let mixAdjusted: boolean | undefined;
  if (params.mc_ratio !== undefined && params.mc_ratio !== null) {
    const mc = ranked.filter((q) => q.type === "mc");
    const written = ranked.filter((q) => q.type === "written");
    const split = splitMcRatio(mc.length, written.length, params.question_count, params.mc_ratio);
    const chosen = new Set([...mc.slice(0, split.mcTake), ...written.slice(0, split.writtenTake)]);
    questions = ranked.filter((q) => chosen.has(q));
    mixAdjusted = split.mixAdjusted;
  } else {
    questions = ranked.slice(0, params.question_count);
  }

  return {
    questions,
    short_draw: questions.length < params.question_count,
    requested: params.question_count,
    returned: questions.length,
    ...(mixAdjusted !== undefined ? { mix_adjusted: mixAdjusted } : {}),
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
  due_mode: DueMode;
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
      due_mode: template.due_mode,
    },
    rng
  );
}
