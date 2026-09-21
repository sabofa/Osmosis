import type { DatabaseSync } from "node:sqlite";
import { notHeldSql, type Viewer } from "./reveal.js";
import { deriveOutcome } from "./attempts.js";
import { DomainError } from "./errors.js";

// ----------------------------------------------------------------------------
// The results subpages: a parent tag's roll-up and its score over time, and
// one day of daily history in detail. All learner-viewer reads — the
// deferred-reveal hold applies to every aggregate here, as it does in
// results.ts.
// ----------------------------------------------------------------------------

// Responses joined to their attempt and question, held rows excluded.
const RESPONSE_BASE = (viewer: Viewer) => `
  FROM response_score rs
  JOIN attempt a ON a.id = rs.attempt_id AND a.submitted_at IS NOT NULL
  JOIN question_tag qt ON qt.question_id = rs.question_id
  WHERE ${notHeldSql(viewer)}`;

export interface ParentTagStat {
  tag_slug: string;
  label: string;
  responses: number;
  graded: number;
  mean_score: number | null;
  misses: number;
  last_seen: string | null;
  child_count: number;
}

// One row per top-level tag, rolled up over every descendant. A question
// tagged under two children of the same parent counts once for the parent.
export function listParentTagStats(db: DatabaseSync, viewer: Viewer = "learner"): ParentTagStat[] {
  const rows = db
    .prepare(
      `SELECT parent,
              COUNT(*) AS responses,
              COUNT(score) AS graded,
              AVG(score) AS mean_score,
              SUM(CASE WHEN score < 0.5 THEN 1 ELSE 0 END) AS misses,
              MAX(submitted_at) AS last_seen
       FROM (
         SELECT DISTINCT rs.response_id,
                CASE WHEN instr(qt.tag_slug, ':') > 0 THEN substr(qt.tag_slug, 1, instr(qt.tag_slug, ':') - 1) ELSE qt.tag_slug END AS parent,
                rs.score, a.submitted_at
         ${RESPONSE_BASE(viewer)}
       )
       GROUP BY parent
       ORDER BY (mean_score IS NULL), mean_score ASC, responses DESC`
    )
    .all() as { parent: string; responses: number; graded: number; mean_score: number | null; misses: number; last_seen: string | null }[];
  const label = db.prepare("SELECT label FROM tag WHERE slug = ?");
  const childCount = db.prepare("SELECT COUNT(*) AS n FROM tag WHERE slug LIKE ? ESCAPE '\\' AND retired_at IS NULL");
  return rows.map((r) => ({
    tag_slug: r.parent,
    label: (label.get(r.parent) as { label: string } | undefined)?.label ?? r.parent,
    responses: r.responses,
    graded: r.graded,
    mean_score: r.mean_score,
    misses: r.misses,
    last_seen: r.last_seen,
    child_count: (childCount.get(r.parent.replace(/[\\%_]/g, (c) => `\\${c}`) + ":%") as { n: number }).n,
  }));
}

export interface TagHistory {
  tag: { slug: string; label: string; description: string | null; parent_slug: string | null };
  overall: { responses: number; graded: number; mean_score: number | null; misses: number; last_seen: string | null };
  // One point per submitted attempt that touched the tag, oldest first —
  // per attempt, not per day, so an afternoon of work draws a line rather
  // than nudging a single dot.
  points: { at: string; mean_score: number; responses: number }[];
  children: { tag_slug: string; label: string; responses: number; graded: number; mean_score: number | null; misses: number }[];
}

// A tag's score over time, over the tag and every descendant, plus each
// direct child's own roll-up so the page can drill down.
export function getTagHistory(db: DatabaseSync, slug: string, opts: { days?: number; viewer?: Viewer } = {}): TagHistory {
  const viewer = opts.viewer ?? "learner";
  const days = Math.min(365, Math.max(7, opts.days ?? 90));
  const tag = db
    .prepare("SELECT slug, label, description, parent_slug FROM tag WHERE slug = ?")
    .get(slug) as TagHistory["tag"] | undefined;
  if (!tag) throw new DomainError("not_found", `Tag "${slug}" does not exist.`);
  const escaped = slug.replace(/[\\%_]/g, (c) => `\\${c}`);
  const subtree = `(qt.tag_slug = ? OR qt.tag_slug LIKE ? ESCAPE '\\')`;
  const subtreeParams = [slug, escaped + ":%"];

  const overall = db
    .prepare(
      `SELECT COUNT(*) AS responses, COUNT(score) AS graded, AVG(score) AS mean_score,
              SUM(CASE WHEN score < 0.5 THEN 1 ELSE 0 END) AS misses, MAX(submitted_at) AS last_seen
       FROM (SELECT DISTINCT rs.response_id, rs.score, a.submitted_at ${RESPONSE_BASE(viewer)} AND ${subtree})`
    )
    .get(...subtreeParams) as TagHistory["overall"];

  const points = db
    .prepare(
      `SELECT at, AVG(score) AS mean_score, COUNT(*) AS responses
       FROM (SELECT DISTINCT rs.response_id, rs.score, a.id AS attempt_id, a.submitted_at AS at
             ${RESPONSE_BASE(viewer)} AND ${subtree}
               AND rs.score IS NOT NULL AND a.submitted_at >= datetime('now', '-' || ? || ' days'))
       GROUP BY attempt_id ORDER BY at ASC`
    )
    .all(...subtreeParams, days) as TagHistory["points"];

  const children = db
    .prepare(
      `SELECT t.slug AS tag_slug, t.label,
              COUNT(x.response_id) AS responses, COUNT(x.score) AS graded, AVG(x.score) AS mean_score,
              SUM(CASE WHEN x.score < 0.5 THEN 1 ELSE 0 END) AS misses
       FROM tag t
       LEFT JOIN (
         SELECT DISTINCT rs.response_id, rs.score,
                CASE WHEN instr(substr(qt.tag_slug, length(?) + 2), ':') > 0
                     THEN substr(qt.tag_slug, 1, length(?) + 1 + instr(substr(qt.tag_slug, length(?) + 2), ':') - 1)
                     ELSE qt.tag_slug END AS child
         ${RESPONSE_BASE(viewer)} AND qt.tag_slug LIKE ? ESCAPE '\\'
       ) x ON x.child = t.slug
       WHERE t.parent_slug = ? AND t.retired_at IS NULL
       GROUP BY t.slug
       ORDER BY (mean_score IS NULL), mean_score ASC, t.slug`
    )
    .all(slug, slug, slug, escaped + ":%", slug) as TagHistory["children"];

  return { tag, overall, points, children };
}

export interface DailyDayDetail {
  draw_date: string;
  draws: {
    kind: string;
    attempt_id: string | null;
    submitted_at: string | null;
    mean_score: number | null;
    responses: {
      question_id: string;
      prompt: string;
      type: string;
      tags: string[];
      outcome: string;
      score: number | null;
      answer: string | null;
      correct_answer: string | null;
      explanation: string | null;
    }[];
  }[];
  // Every tag the day touched, with the day's mean on it and the tag's
  // overall mean for contrast.
  tags_touched: { tag_slug: string; responses: number; day_mean: number | null; overall_mean: number | null }[];
}

export function getDailyDayDetail(db: DatabaseSync, drawDate: string, viewer: Viewer = "learner"): DailyDayDetail {
  const draws = db.prepare("SELECT id, kind FROM daily_draw WHERE draw_date = ? ORDER BY kind").all(drawDate) as {
    id: string;
    kind: string;
  }[];
  if (draws.length === 0) throw new DomainError("not_found", `No daily draw on ${drawDate}.`);

  const attemptStmt = db.prepare(
    `SELECT a.id, a.submitted_at FROM attempt a
     WHERE a.daily_draw_id = ? AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL AND ${notHeldSql(viewer)}
     ORDER BY a.submitted_at ASC LIMIT 1`
  );
  const responseStmt = db.prepare(
    `SELECT r.id, r.question_id, r.idk, r.selected_choice_id, r.response_text, q.prompt, q.type, q.explanation,
            (SELECT score FROM response_score rs WHERE rs.response_id = r.id) AS score,
            (SELECT body FROM choice c WHERE c.id = r.selected_choice_id) AS chosen_body,
            (SELECT body FROM choice c WHERE c.question_id = q.id AND c.is_correct = 1 ORDER BY c.ordinal LIMIT 1) AS correct_body,
            q.model_answer
     FROM response r JOIN question q ON q.id = r.question_id
     WHERE r.attempt_id = ? ORDER BY r.ordinal`
  );
  const tagStmt = db.prepare("SELECT tag_slug FROM question_tag WHERE question_id = ? ORDER BY tag_slug");
  const overallStmt = db.prepare(
    `SELECT AVG(score) AS m FROM (SELECT DISTINCT rs.response_id, rs.score ${RESPONSE_BASE(viewer)} AND qt.tag_slug = ?)`
  );

  const touched = new Map<string, { scores: (number | null)[] }>();
  const out: DailyDayDetail["draws"] = draws.map((d) => {
    const attempt = attemptStmt.get(d.id) as { id: string; submitted_at: string } | undefined;
    if (!attempt) return { kind: d.kind, attempt_id: null, submitted_at: null, mean_score: null, responses: [] };
    const rows = responseStmt.all(attempt.id) as {
      id: string;
      question_id: string;
      idk: number;
      selected_choice_id: string | null;
      response_text: string | null;
      prompt: string;
      type: string;
      explanation: string | null;
      score: number | null;
      chosen_body: string | null;
      correct_body: string | null;
      model_answer: string | null;
    }[];
    const responses = rows.map((r) => {
      const tags = (tagStmt.all(r.question_id) as { tag_slug: string }[]).map((t) => t.tag_slug);
      for (const t of tags) {
        const entry = touched.get(t) ?? { scores: [] };
        entry.scores.push(r.score);
        touched.set(t, entry);
      }
      return {
        question_id: r.question_id,
        prompt: r.prompt,
        type: r.type,
        tags,
        outcome: deriveOutcome(r.idk === 1, r.score),
        score: r.score,
        answer: r.type === "mc" ? r.chosen_body : r.response_text,
        correct_answer: r.type === "mc" ? r.correct_body : r.model_answer,
        explanation: r.explanation,
      };
    });
    const graded = responses.map((r) => r.score).filter((s): s is number => s !== null);
    return {
      kind: d.kind,
      attempt_id: attempt.id,
      submitted_at: attempt.submitted_at,
      mean_score: graded.length ? graded.reduce((a, b) => a + b, 0) / graded.length : null,
      responses,
    };
  });

  const tags_touched = [...touched.entries()]
    .map(([tag_slug, { scores }]) => {
      const graded = scores.filter((s): s is number => s !== null);
      return {
        tag_slug,
        responses: scores.length,
        day_mean: graded.length ? graded.reduce((a, b) => a + b, 0) / graded.length : null,
        overall_mean: (overallStmt.get(tag_slug) as { m: number | null }).m,
      };
    })
    .sort((a, b) => a.tag_slug.localeCompare(b.tag_slug));

  return { draw_date: drawDate, draws: out, tags_touched };
}
