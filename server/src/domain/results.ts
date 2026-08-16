import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "./errors.js";
import { buildTagQueryClause, type TagQuery } from "./tagQuery.js";

export interface GetResultsParams {
  scope: "tag" | "question" | "attempt" | "daily";
  tag_query?: TagQuery;
  since?: string;
  limit?: number;
}

function tagScope(db: DatabaseSync, params: GetResultsParams) {
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

  const rows = db
    .prepare(
      `SELECT tp.tag_slug, tp.responses, tp.mean_score, tp.misses, tp.last_seen,
              (SELECT AVG(COALESCE(rs.score, 0)) FROM response_score rs
                 JOIN response r ON r.id = rs.response_id
                 JOIN attempt a ON a.id = r.attempt_id AND a.submitted_at >= datetime('now', '-30 days')
                 JOIN question_tag qt ON qt.question_id = rs.question_id
                 WHERE qt.tag_slug = tp.tag_slug) AS recent_mean,
              (SELECT AVG(COALESCE(rs.score, 0)) FROM response_score rs
                 JOIN response r ON r.id = rs.response_id
                 JOIN attempt a ON a.id = r.attempt_id
                   AND a.submitted_at >= datetime('now', '-60 days') AND a.submitted_at < datetime('now', '-30 days')
                 JOIN question_tag qt ON qt.question_id = rs.question_id
                 WHERE qt.tag_slug = tp.tag_slug) AS prior_mean
       FROM tag_performance tp
       ${where}
       ORDER BY tp.mean_score ASC
       LIMIT ?`
    )
    .all(...(args as any[]), limit) as {
    tag_slug: string;
    responses: number;
    mean_score: number;
    misses: number;
    last_seen: string;
    recent_mean: number | null;
    prior_mean: number | null;
  }[];

  return rows.map((r) => ({
    tag_slug: r.tag_slug,
    responses: r.responses,
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

function questionScope(db: DatabaseSync, params: GetResultsParams) {
  const tagClause = params.tag_query ? buildTagQueryClause(params.tag_query) : { sql: "", params: [] };
  const limit = params.limit ?? 50;

  const lineages = db
    .prepare(
      `SELECT q.lineage_id,
              COUNT(*) AS responses,
              AVG(COALESCE(rs.score, 0)) AS mean_score,
              MAX(a.submitted_at) AS last_seen
       FROM response_score rs
       JOIN response r ON r.id = rs.response_id
       JOIN attempt a ON a.id = r.attempt_id AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL
       JOIN question q ON q.id = rs.question_id
       WHERE 1=1 ${tagClause.sql}
       GROUP BY q.lineage_id
       ORDER BY mean_score ASC
       LIMIT ?`
    )
    .all(...(tagClause.params as any[]), limit) as {
    lineage_id: string;
    responses: number;
    mean_score: number;
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
      db.prepare("SELECT tag_slug FROM question_tag WHERE question_id = ?").all(current.id) as {
        tag_slug: string;
      }[]
    ).map((t) => t.tag_slug);

    const recent = db
      .prepare(
        `SELECT rs.score, r.response_text, r.answered_at
         FROM response_score rs
         JOIN response r ON r.id = rs.response_id
         JOIN attempt a ON a.id = r.attempt_id AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL
         JOIN question q ON q.id = rs.question_id
         WHERE q.lineage_id = ?
         ORDER BY r.answered_at DESC
         LIMIT 3`
      )
      .all(l.lineage_id) as { score: number; response_text: string | null; answered_at: string }[];

    return {
      lineage_id: l.lineage_id,
      current_id: current.id,
      prompt_preview: current.prompt.slice(0, 120),
      tags,
      responses: l.responses,
      mean_score: l.mean_score,
      last_seen: l.last_seen,
      last_score: recent[0]?.score ?? null,
      // Written responses carry their raw text alongside the score, so it's
      // visible *how* an answer was wrong, not just that it was (spec 9.12).
      recent_responses:
        current.type === "written"
          ? recent.map((r) => ({
              response_text: truncateResponseText(r.response_text),
              score: r.score,
              answered_at: r.answered_at,
            }))
          : undefined,
    };
  });
}

function attemptScope(db: DatabaseSync, params: GetResultsParams) {
  const clauses: string[] = ["a.submitted_at IS NOT NULL"];
  const args: unknown[] = [];
  if (params.since) {
    clauses.push("a.submitted_at >= ?");
    args.push(params.since);
  }
  const limit = params.limit ?? 50;

  const rows = db
    .prepare(
      `SELECT a.id, a.source, t.name AS template_name, a.submitted_at, a.offline,
              (SELECT COUNT(*) FROM response r WHERE r.attempt_id = a.id) AS question_count,
              (SELECT AVG(COALESCE(rs.score, 0)) FROM response_score rs WHERE rs.attempt_id = a.id) AS mean_score
       FROM attempt a
       LEFT JOIN template t ON t.id = a.template_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY a.submitted_at DESC
       LIMIT ?`
    )
    .all(...(args as any[]), limit) as {
    id: string;
    source: string;
    template_name: string | null;
    submitted_at: string;
    offline: number;
    question_count: number;
    mean_score: number | null;
  }[];

  return rows.map((r) => ({ ...r, offline: r.offline === 1 }));
}

function dailyScope(db: DatabaseSync, params: GetResultsParams) {
  const limit = params.limit ?? 50;
  // Only the first submitted attempt per daily draw is authoritative (spec 5.6);
  // later retakes are visible in attempt history but excluded here.
  const rows = db
    .prepare(
      `SELECT d.draw_date, d.kind,
              (SELECT COUNT(*) FROM daily_draw_question dq WHERE dq.daily_draw_id = d.id) AS question_count,
              (SELECT AVG(COALESCE(rs.score, 0)) FROM response_score rs
                 WHERE rs.attempt_id = (
                   SELECT a.id FROM attempt a
                   WHERE a.daily_draw_id = d.id AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL
                   ORDER BY a.submitted_at ASC LIMIT 1
                 )) AS score,
              EXISTS (
                SELECT 1 FROM attempt a
                WHERE a.daily_draw_id = d.id AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL
              ) AS completed
       FROM daily_draw d
       ORDER BY d.draw_date DESC
       LIMIT ?`
    )
    .all(limit) as {
    draw_date: string;
    kind: string;
    question_count: number;
    score: number | null;
    completed: number;
  }[];

  return rows.map((r) => ({
    draw_date: r.draw_date,
    kind: r.kind,
    score: r.score,
    question_count: r.question_count,
    completed: r.completed === 1,
  }));
}

export function getResults(db: DatabaseSync, params: GetResultsParams): Record<string, unknown> {
  switch (params.scope) {
    case "tag":
      return { tags: tagScope(db, params) };
    case "question":
      return { questions: questionScope(db, params) };
    case "attempt":
      return { attempts: attemptScope(db, params) };
    case "daily":
      return { daily: dailyScope(db, params) };
    default:
      throw new DomainError("invalid_scope", `Unknown scope "${params.scope}".`);
  }
}
