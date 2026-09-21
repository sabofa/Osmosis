import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "./errors.js";

// ----------------------------------------------------------------------------
// Tutor sessions — the grouping the tutor creates once per tutoring session so
// everything it does afterward (live items, session-specific tests) lands under
// one entry the app can list and Ben can look back at. See migration 010.
// ----------------------------------------------------------------------------

export interface CreateSessionInput {
  name: string;
  tag_slug?: string | null;
}

export interface SessionRow {
  id: string;
  name: string;
  tag_slug: string | null;
  created_at: string;
  ended_at: string | null;
}

export function createSession(
  db: DatabaseSync,
  input: CreateSessionInput
): { id: string; name: string; tag_slug: string | null } {
  if (!input.name || input.name.trim() === "") {
    throw new DomainError("invalid_name", "A session needs a non-empty name.");
  }
  if (input.tag_slug) {
    const tag = db.prepare("SELECT slug FROM tag WHERE slug = ?").get(input.tag_slug);
    if (!tag) throw new DomainError("not_found", `Tag "${input.tag_slug}" does not exist.`);
  }

  const id = uuidv4();
  db.prepare("INSERT INTO tutor_session (id, name, tag_slug) VALUES (?, ?, ?)").run(
    id,
    input.name,
    input.tag_slug ?? null
  );
  return { id, name: input.name, tag_slug: input.tag_slug ?? null };
}

// Every write that attaches something to a session (present_item,
// quick_check, create_template) goes through here: an unknown id is a
// legible not_found instead of a raw FK error, and an ended session refuses
// new work rather than silently collecting attempts that postdate its own
// ended_at.
export function assertSessionOpen(db: DatabaseSync, id: string): void {
  const session = db.prepare("SELECT ended_at FROM tutor_session WHERE id = ?").get(id) as
    | { ended_at: string | null }
    | undefined;
  if (!session) throw new DomainError("not_found", `Session "${id}" does not exist.`);
  if (session.ended_at) {
    throw new DomainError("session_ended", `Session "${id}" ended at ${session.ended_at}; create_session for new work.`);
  }
}

export interface EndSessionSummary {
  presented: number;
  answered: number;
  abandoned: number;
  dont_know: number;
  paused_now: false;
}

// The tutor's CLOSE step cross-checks its own count against this (spec §3.7),
// so it has to be final: anything still pending when the session ends is
// marked abandoned here rather than left to the lazy sweep hours later. That
// also makes paused_now trivially false — a paused attempt is pending.
export function endSession(
  db: DatabaseSync,
  id: string
): { id: string; ended_at: string; summary: EndSessionSummary } {
  const current = db.prepare("SELECT ended_at FROM tutor_session WHERE id = ?").get(id) as
    | { ended_at: string | null }
    | undefined;
  if (!current) throw new DomainError("not_found", `Session "${id}" does not exist.`);
  if (current.ended_at) throw new DomainError("already_ended", `Session "${id}" already ended.`);

  db.prepare("UPDATE tutor_session SET ended_at = datetime('now') WHERE id = ?").run(id);
  db.prepare(
    `UPDATE attempt SET abandoned_at = datetime('now'), paused_at = NULL
     WHERE session_id = ? AND delivery_mode = 'app_live' AND submitted_at IS NULL AND abandoned_at IS NULL`
  ).run(id);

  const counts = db
    .prepare(
      `SELECT COUNT(*) AS presented,
              SUM(CASE WHEN a.submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS answered,
              SUM(CASE WHEN a.abandoned_at IS NOT NULL AND a.submitted_at IS NULL THEN 1 ELSE 0 END) AS abandoned
       FROM attempt a
       WHERE a.session_id = ? AND a.delivery_mode = 'app_live'`
    )
    .get(id) as { presented: number; answered: number | null; abandoned: number | null };

  // An idk is a third answer, not a wrong one: it counts here and never under
  // incorrect anywhere else.
  const dontKnow = (
    db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM response r
         JOIN attempt a ON a.id = r.attempt_id
         WHERE a.session_id = ? AND a.delivery_mode = 'app_live' AND a.submitted_at IS NOT NULL AND r.idk = 1`
      )
      .get(id) as { n: number }
  ).n;

  const row = db.prepare("SELECT ended_at FROM tutor_session WHERE id = ?").get(id) as { ended_at: string };
  return {
    id,
    ended_at: row.ended_at,
    summary: {
      presented: counts.presented,
      answered: counts.answered ?? 0,
      abandoned: counts.abandoned ?? 0,
      dont_know: dontKnow,
      paused_now: false,
    },
  };
}

// Mirrors the total/limit/offset contract searchQuestions/listAttempts already
// establish — the app and the tutor both browse session history the same way
// every other listing is browsed.
export function listSessions(
  db: DatabaseSync,
  opts: { limit?: number; offset?: number } = {}
): { total: number; sessions: SessionRow[] } {
  const total = (db.prepare("SELECT COUNT(*) AS n FROM tutor_session").get() as { n: number }).n;
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const sessions = db
    .prepare(
      `SELECT id, name, tag_slug, created_at, ended_at
       FROM tutor_session
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as unknown as SessionRow[];
  return { total, sessions };
}

// The session plus its attempts and templates — one function, two callers:
// GET /api/sessions/:id (the app's expanded session row) and the get_session
// MCP tool (the tutor reading its own history back for calibration). Attempt
// rows mirror listAttempts's summary shape; templates mirror the columns the
// app's template list already knows how to render.
export function getSessionDetail(db: DatabaseSync, sessionId: string): Record<string, unknown> {
  const session = db
    .prepare("SELECT id, name, tag_slug, created_at, ended_at FROM tutor_session WHERE id = ?")
    .get(sessionId) as SessionRow | undefined;
  if (!session) throw new DomainError("not_found", `Session "${sessionId}" does not exist.`);

  const attempts = db
    .prepare(
      `SELECT a.id, a.source, a.delivery_mode, a.template_id, t.name AS template_name,
              a.started_at, a.submitted_at, a.abandoned_at, a.offline,
              (SELECT COUNT(*) FROM response r WHERE r.attempt_id = a.id) AS question_count,
              (SELECT AVG(rs.score) FROM response_score rs WHERE rs.attempt_id = a.id) AS mean_score,
              (SELECT COUNT(*) FROM response_score rs WHERE rs.attempt_id = a.id AND rs.score IS NULL) AS ungraded
       FROM attempt a
       LEFT JOIN template t ON t.id = a.template_id
       WHERE a.session_id = ?
       ORDER BY a.started_at DESC, a.id DESC`
    )
    .all(sessionId) as {
    id: string;
    source: string;
    delivery_mode: string | null;
    template_id: string | null;
    template_name: string | null;
    started_at: string;
    submitted_at: string | null;
    abandoned_at: string | null;
    offline: number;
    question_count: number;
    mean_score: number | null;
    ungraded: number;
  }[];

  const templates = db
    .prepare(
      `SELECT id, name, description, question_count, frozen, time_limit_sec, created_at, retired_at
       FROM template
       WHERE session_id = ? AND retired_at IS NULL
       ORDER BY created_at DESC, id DESC`
    )
    .all(sessionId) as {
    id: string;
    name: string;
    description: string | null;
    question_count: number;
    frozen: number;
    time_limit_sec: number | null;
    created_at: string;
    retired_at: string | null;
  }[];

  return {
    id: session.id,
    name: session.name,
    tag_slug: session.tag_slug,
    created_at: session.created_at,
    ended_at: session.ended_at,
    attempts: attempts.map((a) => ({
      id: a.id,
      source: a.source,
      delivery_mode: a.delivery_mode,
      template_id: a.template_id,
      template_name: a.template_name,
      started_at: a.started_at,
      submitted_at: a.submitted_at,
      abandoned_at: a.abandoned_at,
      offline: a.offline === 1,
      question_count: a.question_count,
      mean_score: a.mean_score,
      ungraded: a.ungraded,
    })),
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      question_count: t.question_count,
      frozen: t.frozen === 1,
      time_limit_sec: t.time_limit_sec,
      created_at: t.created_at,
      retired_at: t.retired_at,
    })),
  };
}
