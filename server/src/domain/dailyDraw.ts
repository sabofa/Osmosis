import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import type { TagQuery } from "./tagQuery.js";
import { getEligibleQuestions, weightedSampleWithoutReplacement, computeWeakWeights, type EligibilityParams } from "./draw.js";

function configString(db: DatabaseSync, key: string, fallback: string): string {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as string) : fallback;
}

function configNumber(db: DatabaseSync, key: string, fallback: number): number {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as number) : fallback;
}

export function computeDrawDate(db: DatabaseSync, now: Date = new Date()): string {
  const timezone = configString(db, "daily_timezone", "America/Los_Angeles");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA formats as YYYY-MM-DD directly, no manual reassembly needed.
  return formatter.format(now);
}

function recentExcludedLineages(db: DatabaseSync, drawDate: string, days: number): string[] {
  if (days <= 0) return [];
  const rows = db
    .prepare(
      `SELECT DISTINCT lineage_id FROM daily_recent_lineage
       WHERE draw_date < ? AND draw_date >= date(?, '-' || ? || ' days')`
    )
    .all(drawDate, drawDate, days) as { lineage_id: string }[];
  return rows.map((r) => r.lineage_id);
}

function drawWithRelaxation(
  db: DatabaseSync,
  drawDate: string,
  count: number,
  weighting: "random" | "weak_weighted",
  tagFilter: TagQuery | null,
  maxExclusionDays: number,
  extraExcludeLineageIds: string[],
  rng: () => number
): { questions: ReturnType<typeof getEligibleQuestions>; relaxedTo: number; short: boolean } {
  // Only ever relax DOWNWARD from the configured max — [maxExclusionDays, 1, 0]
  // deduped and sorted descending, but never including a level above the
  // configured value (e.g. if daily_exclusion_days is itself 0, the level list
  // must be just [0], not [1, 0], which would relax "up" past the config).
  // Clamp a misconfigured negative value to 0 ("no exclusion") rather than
  // letting it produce an empty levels list, which would hit the unreachable
  // throw below.
  const clampedMaxExclusionDays = Math.max(0, maxExclusionDays);
  const levels = [...new Set([clampedMaxExclusionDays, 1, 0].filter((d) => d <= clampedMaxExclusionDays))]
    .filter((d) => d >= 0)
    .sort((a, b) => b - a);

  for (const days of levels) {
    const excluded = [...recentExcludedLineages(db, drawDate, days), ...extraExcludeLineageIds];
    const params: EligibilityParams = {
      tag_query: tagFilter ?? undefined,
      calculator_policy: "any",
      exclude_lineage_ids: excluded,
    };
    const pool = getEligibleQuestions(db, params);
    if (pool.length >= count || days === 0) {
      const weights = weighting === "weak_weighted" ? computeWeakWeights(db, pool) : pool.map(() => 1);
      const questions = weightedSampleWithoutReplacement(pool, weights, count, rng);
      return { questions, relaxedTo: days, short: questions.length < count };
    }
  }
  // Unreachable — days=0 is always in `levels` and always returns above.
  throw new Error("drawWithRelaxation: no relaxation level satisfied");
}

export interface ResolvedDailyQuestion {
  id: string;
  lineage_id: string;
  type: "mc" | "written";
}

export interface ResolvedDailyDraw {
  daily_draw_id: string;
  draw_date: string;
  kind: "question" | "quiz";
  questions: ResolvedDailyQuestion[];
  exclusion_relaxed: number | null; // days actually used, or null if a cached (already-generated) draw was read, not freshly generated
  short_draw: boolean;
  requested: number;
  returned: number;
}

export function resolveDailyDraw(
  db: DatabaseSync,
  kind: "question" | "quiz",
  now: Date = new Date(),
  rng: () => number = Math.random
): ResolvedDailyDraw {
  const drawDate = computeDrawDate(db, now);

  const existing = db
    .prepare("SELECT id FROM daily_draw WHERE draw_date = ? AND kind = ?")
    .get(drawDate, kind) as { id: string } | undefined;

  if (existing) {
    const rows = db
      .prepare(
        `SELECT q.id, q.lineage_id, q.type FROM daily_draw_question dq
         JOIN question q ON q.id = dq.question_id
         WHERE dq.daily_draw_id = ? ORDER BY dq.ordinal`
      )
      .all(existing.id) as unknown as ResolvedDailyQuestion[];
    return {
      daily_draw_id: existing.id,
      draw_date: drawDate,
      kind,
      questions: rows,
      exclusion_relaxed: null, // not known for a cached read — only meaningful at generation time
      short_draw: false,
      requested: rows.length,
      returned: rows.length,
    };
  }

  const tagFilterRaw = db.prepare("SELECT value FROM config WHERE key = 'daily_tag_filter'").get() as
    | { value: string }
    | undefined;
  const tagFilter = tagFilterRaw ? (JSON.parse(tagFilterRaw.value) as TagQuery | null) : null;
  const maxExclusionDays = configNumber(db, "daily_exclusion_days", 2);

  let extraExclude: string[] = [];
  if (kind === "quiz") {
    // The daily question is drawn first; its lineage is excluded from the quiz.
    // resolveDailyDraw is idempotent/cached, so calling it here either generates
    // today's question draw (first call of the day) or reads the cached one.
    const questionDraw = resolveDailyDraw(db, "question", now, rng);
    extraExclude = questionDraw.questions.map((q) => q.lineage_id);
  }

  const count = kind === "question" ? 1 : configNumber(db, "daily_quiz_size", 10);
  const weighting =
    kind === "question"
      ? (configString(db, "daily_question_weighting", "weak_weighted") as "random" | "weak_weighted")
      : (configString(db, "daily_quiz_weighting", "random") as "random" | "weak_weighted");

  const { questions, relaxedTo, short } = drawWithRelaxation(
    db,
    drawDate,
    count,
    weighting,
    tagFilter,
    maxExclusionDays,
    extraExclude,
    rng
  );

  const id = uuidv4();
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO daily_draw (id, draw_date, kind) VALUES (?, ?, ?) ON CONFLICT (draw_date, kind) DO NOTHING").run(
      id,
      drawDate,
      kind
    );
    const winner = db.prepare("SELECT id FROM daily_draw WHERE draw_date = ? AND kind = ?").get(drawDate, kind) as {
      id: string;
    };
    if (winner.id === id) {
      // We won the race — insert the question set. A concurrent loser (winner.id !== id)
      // skips this and falls through to re-read the winner's already-inserted rows below.
      const insertQ = db.prepare("INSERT INTO daily_draw_question (daily_draw_id, question_id, ordinal) VALUES (?, ?, ?)");
      questions.forEach((q, i) => insertQ.run(winner.id, q.id, i));
    }
    db.exec("COMMIT");

    const finalRows = db
      .prepare(
        `SELECT q.id, q.lineage_id, q.type FROM daily_draw_question dq
         JOIN question q ON q.id = dq.question_id
         WHERE dq.daily_draw_id = ? ORDER BY dq.ordinal`
      )
      .all(winner.id) as unknown as ResolvedDailyQuestion[];

    return {
      daily_draw_id: winner.id,
      draw_date: drawDate,
      kind,
      questions: finalRows,
      exclusion_relaxed: winner.id === id ? relaxedTo : null,
      short_draw: winner.id === id ? short : false,
      requested: count,
      returned: finalRows.length,
    };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
