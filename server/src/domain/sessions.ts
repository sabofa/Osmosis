import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "./errors.js";
import { emitSessionEvent } from "../lib/events.js";
import type { Viewer } from "./reveal.js";

// ----------------------------------------------------------------------------
// Tutor sessions — the grouping the tutor creates once per tutoring session so
// everything it does afterward (live items, session-specific tests) lands under
// one entry the app can list and Ben can look back at. See migration 010.
// ----------------------------------------------------------------------------

export type Reveal = "immediate" | "deferred";

export interface CreateSessionInput {
  name: string;
  tag_slug?: string | null;
  // What every item presented in this session does with its answer key
  // unless present_item says otherwise: 'immediate' (today's behaviour — the
  // learner sees it on submit) or 'deferred' (they see it when the session
  // ends, so an early item's key can't teach the next one).
  reveal_default?: Reveal | null;
}

export interface SessionRow {
  id: string;
  name: string;
  tag_slug: string | null;
  reveal_default: Reveal;
  created_at: string;
  ended_at: string | null;
  // The tutor's closing words (markdown), written by end_session. Null while
  // the session runs, and null afterwards if the tutor ended it without any.
  summary: string | null;
  // Derived, not stored: ended_at restated as the word the app renders.
  status: SessionStatus;
  // A tutor_session row only ever comes from create_session over MCP, so this
  // is constant — it exists so the app can tell a tutor-made row from a
  // self-started attempt without special-casing the session list.
  source: "tutor";
}

export type SessionStatus = "open" | "closed";

export function createSession(
  db: DatabaseSync,
  input: CreateSessionInput
): { id: string; name: string; tag_slug: string | null; reveal_default: Reveal } {
  if (!input.name || input.name.trim() === "") {
    throw new DomainError("invalid_name", "A session needs a non-empty name.");
  }
  if (input.tag_slug) {
    const tag = db.prepare("SELECT slug FROM tag WHERE slug = ?").get(input.tag_slug);
    if (!tag) throw new DomainError("not_found", `Tag "${input.tag_slug}" does not exist.`);
  }

  const revealDefault: Reveal = input.reveal_default ?? "immediate";
  if (revealDefault !== "immediate" && revealDefault !== "deferred") {
    throw new DomainError("invalid_reveal", "reveal_default must be 'immediate' or 'deferred'.");
  }

  const id = uuidv4();
  db.prepare("INSERT INTO tutor_session (id, name, tag_slug, reveal_default) VALUES (?, ?, ?, ?)").run(
    id,
    input.name,
    input.tag_slug ?? null,
    revealDefault
  );
  return { id, name: input.name, tag_slug: input.tag_slug ?? null, reveal_default: revealDefault };
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

// present_item's fallback when the call itself doesn't name a reveal.
export function sessionRevealDefault(db: DatabaseSync, id: string): Reveal {
  const row = db.prepare("SELECT reveal_default FROM tutor_session WHERE id = ?").get(id) as
    | { reveal_default: Reveal }
    | undefined;
  return row?.reveal_default ?? "immediate";
}

// Whether a session is still running — the gate on a deferred attempt's key.
export function sessionIsOpen(db: DatabaseSync, id: string): boolean {
  const row = db.prepare("SELECT ended_at FROM tutor_session WHERE id = ?").get(id) as
    | { ended_at: string | null }
    | undefined;
  return row !== undefined && row.ended_at === null;
}

export interface EndSessionSummary {
  presented: number;
  answered: number;
  abandoned: number;
  dont_know: number;
  // Non-answerable things the tutor put on the screen during the session
  // (present_show, §5.1). Counted beside the items, never among them.
  shows: number;
  paused_now: false;
  // Questions written for this session alone, retired here — they were never
  // part of the bank and must not outlive the moment they were written for.
  retired_ephemeral: number;
}

// The tutor's CLOSE step cross-checks its own count against this (spec §3.7),
// so it has to be final: anything still pending when the session ends is
// marked abandoned here rather than left to the lazy sweep hours later. That
// also makes paused_now trivially false — a paused attempt is pending.
export function endSession(
  db: DatabaseSync,
  id: string,
  opts: { summary?: string | null } = {}
): { id: string; ended_at: string; summary: EndSessionSummary; summary_text: string | null } {
  const current = db.prepare("SELECT ended_at FROM tutor_session WHERE id = ?").get(id) as
    | { ended_at: string | null }
    | undefined;
  if (!current) throw new DomainError("not_found", `Session "${id}" does not exist.`);
  if (current.ended_at) throw new DomainError("already_ended", `Session "${id}" already ended.`);

  // The tutor's own recap, stored verbatim (markdown) so the app can show the
  // learner what was said without them keeping the conversation around.
  // Whitespace-only is the same as nothing said.
  if (opts.summary !== undefined && opts.summary !== null && typeof opts.summary !== "string") {
    throw new DomainError("invalid_summary", "summary must be a string of markdown.");
  }
  const summaryText =
    typeof opts.summary === "string" && opts.summary.trim() !== "" ? opts.summary : null;

  db.prepare("UPDATE tutor_session SET ended_at = datetime('now'), summary = ? WHERE id = ?").run(summaryText, id);
  db.prepare(
    `UPDATE attempt SET abandoned_at = datetime('now'), paused_at = NULL
     WHERE session_id = ? AND delivery_mode = 'app_live' AND submitted_at IS NULL AND abandoned_at IS NULL`
  ).run(id);

  const retiredEphemeral = db
    .prepare(
      `UPDATE question SET retired_at = datetime('now'), retired_reason = 'ephemeral_session_ended'
       WHERE session_id = ? AND ephemeral = 1 AND retired_at IS NULL`
    )
    .run(id).changes as number;

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

  // Every screen reading this session is now looking at stale state — the
  // deferred reveals just opened up and the live screen has nothing more
  // coming. Emitted last, after all of the writes above have landed.
  emitSessionEvent(id, { type: "session_ended", session_id: id });

  return {
    id,
    ended_at: row.ended_at,
    summary_text: summaryText,
    summary: {
      presented: counts.presented,
      answered: counts.answered ?? 0,
      abandoned: counts.abandoned ?? 0,
      dont_know: dontKnow,
      // Counted inline rather than through domain/shows.ts: shows.ts already
      // imports this module for its session gates, and a cycle between the
      // two for one COUNT(*) is not worth the tidiness.
      shows: (db.prepare("SELECT COUNT(*) AS n FROM show WHERE session_id = ?").get(id) as { n: number }).n,
      paused_now: false,
      retired_ephemeral: Number(retiredEphemeral),
    },
  };
}

function sessionStatus(endedAt: string | null): SessionStatus {
  return endedAt === null ? "open" : "closed";
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
      `SELECT id, name, tag_slug, reveal_default, created_at, ended_at, summary
       FROM tutor_session
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as unknown as Omit<SessionRow, "status" | "source">[];
  return {
    total,
    sessions: sessions.map((s) => ({
      ...s,
      summary: s.summary ?? null,
      status: sessionStatus(s.ended_at),
      source: "tutor" as const,
    })),
  };
}

// The session plus its attempts and templates — one function, two callers:
// GET /api/sessions/:id (the app's expanded session row) and the get_session
// MCP tool (the tutor reading its own history back for calibration). Attempt
// rows mirror listAttempts's summary shape; templates mirror the columns the
// app's template list already knows how to render.
export function getSessionDetail(
  db: DatabaseSync,
  sessionId: string,
  opts: { viewer?: Viewer } = {}
): Record<string, unknown> {
  const viewer = opts.viewer ?? "tutor";
  const session = db
    .prepare("SELECT id, name, tag_slug, reveal_default, created_at, ended_at, summary FROM tutor_session WHERE id = ?")
    .get(sessionId) as Omit<SessionRow, "status" | "source"> | undefined;
  if (!session) throw new DomainError("not_found", `Session "${sessionId}" does not exist.`);

  const attempts = db
    .prepare(
      `SELECT a.id, a.source, a.delivery_mode, a.template_id, t.name AS template_name,
              a.started_at, a.submitted_at, a.abandoned_at, a.offline, a.reveal,
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
    reveal: Reveal;
    question_count: number;
    mean_score: number | null;
    ungraded: number;
  }[];

  // Same hold as getAttemptDetail's, applied to the summary the app's session
  // list renders: a held attempt's mean_score is its score, by another name.
  const held = (reveal: Reveal) => viewer === "learner" && reveal === "deferred" && session.ended_at === null;

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
    reveal_default: session.reveal_default,
    created_at: session.created_at,
    ended_at: session.ended_at,
    summary: session.summary ?? null,
    status: sessionStatus(session.ended_at),
    source: "tutor",
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
      reveal: a.reveal,
      revealed: !held(a.reveal),
      question_count: a.question_count,
      mean_score: held(a.reveal) ? null : a.mean_score,
      ungraded: held(a.reveal) ? null : a.ungraded,
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
