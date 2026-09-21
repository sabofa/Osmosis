import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "./errors.js";
import { buildTagQueryClause, type TagQuery } from "./tagQuery.js";
import { bestGuessCorrect, confidenceNumeric, deriveOutcome, type Confidence } from "./attempts.js";
import { nodeKeyFields } from "./nodeKeys.js";
import { notHeldSql, type Viewer } from "./reveal.js";

// Every per-response row get_results hands back, at either scope. The binding
// rule (spec §2): anything the response accepted on input is readable here,
// and the outcome label is the same deriveOutcome the attempt paths use — an
// idk is dont_know, never incorrect, and a null score is never a zero.
interface ResponseRecordRow {
  question_id: string;
  score: number | null;
  grader: string | null;
  response_text: string | null;
  selected_choice_id: string | null;
  best_guess_choice_id: string | null;
  idk: number;
  confidence: Confidence | null;
  misapplied_method: string | null;
  diagnosis: string | null;
  elapsed_ms: number | null;
  answered_at: string | null;
}

const RESPONSE_RECORD_COLUMNS = `r.question_id, rs.score, rs.grader, r.response_text, r.selected_choice_id, r.best_guess_choice_id,
                r.idk, r.confidence, r.misapplied_method, r.diagnosis, r.elapsed_ms, r.answered_at`;

function responseRecord(db: DatabaseSync, r: ResponseRecordRow, chosenMisconception: string | null) {
  return {
    response_text: truncateResponseText(r.response_text),
    selected_choice_id: r.selected_choice_id,
    chosen_misconception: chosenMisconception,
    best_guess_choice_id: r.best_guess_choice_id,
    best_guess_correct: bestGuessCorrect(db, r.best_guess_choice_id),
    idk: r.idk === 1,
    confidence: r.confidence,
    confidence_numeric: confidenceNumeric(r.confidence),
    misapplied_method: r.misapplied_method,
    diagnosis: r.diagnosis,
    elapsed_ms: r.elapsed_ms,
    score: r.score,
    grader: r.grader,
    outcome: deriveOutcome(r.idk === 1, r.score),
    answered_at: r.answered_at,
    // Which teachable idea the item was targeting (§3.10), so an outcome can
    // be filed without a second read.
    ...nodeKeyFields(db, r.question_id),
  };
}

function chosenMisconception(db: DatabaseSync, choiceId: string | null): string | null {
  if (!choiceId) return null;
  const choice = db.prepare("SELECT misconception FROM choice WHERE id = ?").get(choiceId) as
    | { misconception: string | null }
    | undefined;
  return choice?.misconception ?? null;
}

export interface GetResultsParams {
  scope: "tag" | "question" | "attempt" | "daily";
  tag_query?: TagQuery;
  since?: string;
  limit?: number;
  offset?: number;
}

// tag_performance's own text, plus the learner's hold filter. The view
// cannot be filtered from outside (it is already grouped), so the learner's
// read recomputes it from the same base tables — keep this in step with
// migration 015's CREATE VIEW if that ever changes.
function tagPerformanceSource(viewer: Viewer): string {
  if (viewer !== "learner") return "tag_performance";
  return `(SELECT qt.tag_slug,
                  COUNT(*) AS responses,
                  COUNT(rs.score) AS graded,
                  AVG(rs.score) AS mean_score,
                  SUM(CASE WHEN rs.score < 0.5 THEN 1 ELSE 0 END) AS misses,
                  MAX(a.submitted_at) AS last_seen
           FROM response_score rs
           JOIN attempt a ON a.id = rs.attempt_id AND a.submitted_at IS NOT NULL
           JOIN question_tag qt ON qt.question_id = rs.question_id
           WHERE ${notHeldSql(viewer)}
           GROUP BY qt.tag_slug)`;
}

function tagScope(db: DatabaseSync, params: GetResultsParams, viewer: Viewer) {
  const clauses: string[] = [];
  const args: unknown[] = [];

  if (params.tag_query) {
    // tag_performance is one row per tag_slug already, so reuse the same
    // all/any/none matching directly against tag_slug rather than joining
    // through question.
    const slugMatch = (slugs: string[]) =>
      slugs.map(() => "(tp.tag_slug = ? OR tp.tag_slug LIKE ?)").join(" OR ");
    const expand = (slugs: string[]) => slugs.flatMap((s) => [s, `${s}:%`]);

    for (const slug of params.tag_query.all ?? []) {
      clauses.push(`(${slugMatch([slug])})`);
      args.push(...expand([slug]));
    }
    if (params.tag_query.any?.length) {
      clauses.push(`(${slugMatch(params.tag_query.any)})`);
      args.push(...expand(params.tag_query.any));
    }
    if (params.tag_query.none?.length) {
      clauses.push(`NOT (${slugMatch(params.tag_query.none)})`);
      args.push(...expand(params.tag_query.none));
    }
  }
  if (params.since) {
    clauses.push("tp.last_seen >= ?");
    args.push(params.since);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  const rows = db
    .prepare(
      `SELECT tp.tag_slug, tp.responses, tp.graded, tp.mean_score, tp.misses, tp.last_seen,
              (SELECT AVG(rs.score) FROM response_score rs
                 JOIN response r ON r.id = rs.response_id
                 JOIN attempt a ON a.id = r.attempt_id AND a.submitted_at >= datetime('now', '-30 days')
                 JOIN question_tag qt ON qt.question_id = rs.question_id
                 WHERE qt.tag_slug = tp.tag_slug AND ${notHeldSql(viewer)}) AS recent_mean,
              (SELECT AVG(rs.score) FROM response_score rs
                 JOIN response r ON r.id = rs.response_id
                 JOIN attempt a ON a.id = r.attempt_id
                   AND a.submitted_at >= datetime('now', '-60 days') AND a.submitted_at < datetime('now', '-30 days')
                 JOIN question_tag qt ON qt.question_id = rs.question_id
                 WHERE qt.tag_slug = tp.tag_slug AND ${notHeldSql(viewer)}) AS prior_mean
       FROM ${tagPerformanceSource(viewer)} tp
       ${where}
       ORDER BY tp.mean_score IS NULL, tp.mean_score ASC
       LIMIT ? OFFSET ?`
    )
    .all(...(args as any[]), limit, offset) as {
    tag_slug: string;
    responses: number;
    graded: number;
    mean_score: number | null;
    misses: number;
    last_seen: string;
    recent_mean: number | null;
    prior_mean: number | null;
  }[];

  return rows.map((r) => ({
    tag_slug: r.tag_slug,
    responses: r.responses,
    graded: r.graded,
    mean_score: r.mean_score,
    misses: r.misses,
    last_seen: r.last_seen,
    trend_30d: r.recent_mean !== null && r.prior_mean !== null ? r.recent_mean - r.prior_mean : null,
  }));
}

const RESPONSE_TEXT_PREVIEW_LENGTH = 500;

function truncateResponseText(text: string | null): string | null {
  if (text === null || text.length <= RESPONSE_TEXT_PREVIEW_LENGTH) return text;
  return `${text.slice(0, RESPONSE_TEXT_PREVIEW_LENGTH)}...`;
}

function questionScope(db: DatabaseSync, params: GetResultsParams, viewer: Viewer) {
  const tagClause = params.tag_query ? buildTagQueryClause(params.tag_query) : { sql: "", params: [] };
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  // AVG ignores NULL: an ungraded written response contributes to `responses`
  // and `ungraded` but never to the mean — a null score is "not yet graded",
  // not zero.
  const lineages = db
    .prepare(
      `SELECT q.lineage_id,
              COUNT(*) AS responses,
              COUNT(rs.score) AS graded,
              AVG(rs.score) AS mean_score,
              MAX(a.submitted_at) AS last_seen
       FROM response_score rs
       JOIN response r ON r.id = rs.response_id
       JOIN attempt a ON a.id = r.attempt_id AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL
       JOIN question q ON q.id = rs.question_id
       WHERE ${notHeldSql(viewer)} ${tagClause.sql}
       GROUP BY q.lineage_id
       ORDER BY mean_score IS NULL, mean_score ASC
       LIMIT ? OFFSET ?`
    )
    .all(...(tagClause.params as any[]), limit, offset) as {
    lineage_id: string;
    responses: number;
    graded: number;
    mean_score: number | null;
    last_seen: string;
  }[];

  return lineages.map((l) => {
    const current = db
      .prepare(
        `SELECT id, prompt, type FROM question
         WHERE lineage_id = ? AND NOT EXISTS (
           SELECT 1 FROM question q2 WHERE q2.lineage_id = question.lineage_id AND q2.version > question.version
         )`
      )
      .get(l.lineage_id) as { id: string; prompt: string; type: "mc" | "written" };

    const tags = (
      db.prepare("SELECT tag_slug FROM question_tag WHERE question_id = ?").all(current.id) as { tag_slug: string }[]
    ).map((t) => t.tag_slug);

    const gradedBy = db
      .prepare(
        `SELECT rs.grader, COUNT(*) AS n
         FROM response_score rs
         JOIN response r ON r.id = rs.response_id
         JOIN attempt a ON a.id = r.attempt_id AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL
         JOIN question q ON q.id = rs.question_id
         WHERE q.lineage_id = ? AND rs.grader IS NOT NULL AND ${notHeldSql(viewer)}
         GROUP BY rs.grader`
      )
      .all(l.lineage_id) as { grader: string; n: number }[];

    const recent = db
      .prepare(
        `SELECT ${RESPONSE_RECORD_COLUMNS}
         FROM response_score rs
         JOIN response r ON r.id = rs.response_id
         JOIN attempt a ON a.id = r.attempt_id AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL
         JOIN question q ON q.id = rs.question_id
         WHERE q.lineage_id = ? AND ${notHeldSql(viewer)}
         ORDER BY r.answered_at DESC
         LIMIT 3`
      )
      .all(l.lineage_id) as unknown as ResponseRecordRow[];

    return {
      lineage_id: l.lineage_id,
      current_id: current.id,
      prompt_preview: current.prompt.slice(0, 120),
      tags,
      responses: l.responses,
      graded: l.graded,
      ungraded: l.responses - l.graded,
      mean_score: l.mean_score,
      last_seen: l.last_seen,
      last_score: recent[0]?.score ?? null,
      // Which grader stands behind this lineage's live scores — a self-graded
      // row is distinguishable from an oracle-graded one (spec §2.9).
      graded_by: {
        self: 0,
        model: 0,
        oracle: 0,
        judge: 0,
        auto_mc: 0,
        ...Object.fromEntries(gradedBy.map((g) => [g.grader, g.n])),
      },
      // Every input field the response accepted comes back out, for mc and
      // written alike: the chosen option is the diagnosis for mc, the text is
      // for written (spec 9.12), and confidence/idk/misapplied_method/
      // best_guess/diagnosis are the tutor's own annotations.
      recent_responses: recent.map((r) => responseRecord(db, r, chosenMisconception(db, r.selected_choice_id))),
    };
  });
}

function attemptScope(db: DatabaseSync, params: GetResultsParams, viewer: Viewer) {
  // A held attempt drops out whole: every one of its responses would be
  // withheld anyway, and a row of nulls says less than no row.
  const clauses: string[] = ["a.submitted_at IS NOT NULL", notHeldSql(viewer)];
  const args: unknown[] = [];
  if (params.since) {
    clauses.push("a.submitted_at >= ?");
    args.push(params.since);
  }
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  const rows = db
    .prepare(
      `SELECT a.id, a.source, t.name AS template_name, a.submitted_at, a.offline,
              (SELECT COUNT(*) FROM response r WHERE r.attempt_id = a.id) AS question_count,
              (SELECT AVG(rs.score) FROM response_score rs WHERE rs.attempt_id = a.id) AS mean_score,
              (SELECT COUNT(*) FROM response_score rs WHERE rs.attempt_id = a.id AND rs.score IS NULL) AS ungraded
       FROM attempt a
       LEFT JOIN template t ON t.id = a.template_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY a.submitted_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...(args as any[]), limit, offset) as {
    id: string;
    source: string;
    template_name: string | null;
    submitted_at: string;
    offline: number;
    question_count: number;
    mean_score: number | null;
    ungraded: number;
  }[];

  // §2.1: the chosen option is the diagnosis, so attempt scope carries the
  // per-response record too — without it a distractor rationale is write-only
  // for anyone reading results rather than one attempt at a time.
  const responsesFor = db.prepare(
    `SELECT ${RESPONSE_RECORD_COLUMNS}, r.ordinal
     FROM response_score rs
     JOIN response r ON r.id = rs.response_id
     WHERE r.attempt_id = ?
     ORDER BY r.ordinal`
  );

  return rows.map((r) => ({
    ...r,
    offline: r.offline === 1,
    responses: (responsesFor.all(r.id) as unknown as (ResponseRecordRow & { ordinal: number; question_id: string })[]).map(
      (row) => ({
        ordinal: row.ordinal,
        question_id: row.question_id,
        ...responseRecord(db, row, chosenMisconception(db, row.selected_choice_id)),
      })
    ),
  }));
}

function dailyScope(db: DatabaseSync, params: GetResultsParams, viewer: Viewer) {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  // Only the first submitted attempt per daily draw is authoritative (spec 5.6);
  // later retakes are visible in attempt history but excluded here.
  const rows = db
    .prepare(
      `SELECT d.draw_date, d.kind,
              (SELECT COUNT(*) FROM daily_draw_question dq WHERE dq.daily_draw_id = d.id) AS question_count,
              (SELECT AVG(rs.score) FROM response_score rs
                 WHERE rs.attempt_id = (
                   SELECT a.id FROM attempt a
                   WHERE a.daily_draw_id = d.id AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL
                     AND ${notHeldSql(viewer)}
                   ORDER BY a.submitted_at ASC LIMIT 1
                 )) AS score,
              (SELECT COUNT(*) FROM response_score rs
                 WHERE rs.attempt_id = (
                   SELECT a.id FROM attempt a
                   WHERE a.daily_draw_id = d.id AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL
                     AND ${notHeldSql(viewer)}
                   ORDER BY a.submitted_at ASC LIMIT 1
                 ) AND rs.score IS NULL) AS ungraded,
              EXISTS (
                SELECT 1 FROM attempt a
                WHERE a.daily_draw_id = d.id AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL
                  AND ${notHeldSql(viewer)}
              ) AS completed
       FROM daily_draw d
       ORDER BY d.draw_date DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as {
    draw_date: string;
    kind: string;
    question_count: number;
    score: number | null;
    ungraded: number;
    completed: number;
  }[];

  return rows.map((r) => ({
    draw_date: r.draw_date,
    kind: r.kind,
    score: r.score,
    ungraded: r.ungraded,
    question_count: r.question_count,
    completed: r.completed === 1,
  }));
}

// viewer defaults to 'learner', the withholding view: a caller that names no
// viewer must not be handed a held attempt's score by accident. The MCP
// get_results reads the full record and says so — `{ viewer: "tutor" }` — and
// nothing else has to remember anything.
export function getResults(
  db: DatabaseSync,
  params: GetResultsParams,
  opts: { viewer?: Viewer } = {}
): Record<string, unknown> {
  const viewer = opts.viewer ?? "learner";
  switch (params.scope) {
    case "tag":
      return { tags: tagScope(db, params, viewer) };
    case "question":
      return { questions: questionScope(db, params, viewer) };
    case "attempt":
      return { attempts: attemptScope(db, params, viewer) };
    case "daily":
      return { daily: dailyScope(db, params, viewer) };
    default:
      throw new DomainError("invalid_scope", `Unknown scope "${params.scope}".`);
  }
}
