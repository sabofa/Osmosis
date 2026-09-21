import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
// Same import the question validator uses for graph_spec, so a show's graph
// and an item's graph are held to exactly one grammar.
import { parseSpec } from "graph-engine/parser";
import { DomainError } from "./errors.js";
import { emitSessionEvent } from "../lib/events.js";
import { assertSessionOpen, sessionIsOpen, type Reveal, type SessionStatus } from "./sessions.js";
import { serializeContext, parseContext, type ItemContext } from "./context.js";
import type { Viewer } from "./reveal.js";

// ----------------------------------------------------------------------------
// Showing (spec §5.1–§5.3). A show is the tutor putting something on the
// learner's screen that is not a question: a line of text, a paragraph of
// markdown, a graph it wants to talk through. Nothing is answered and nothing
// is graded — the only thing that comes back is whether it was seen, how long
// it was in front of them, and whether they said OK.
//
// A show is never in the bank. It lives on the session, it dies with it, and
// migration 020 gives it no lineage, no version and no retire for that reason.
// ----------------------------------------------------------------------------

export type ShowKind = "text" | "markdown" | "graph";

const SHOW_KINDS: readonly ShowKind[] = ["text", "markdown", "graph"];
const CAPTION_MAX = 500;

export interface PresentShowInput {
  session_id: string;
  kind: ShowKind;
  payload: string;
  caption?: string | null;
  context?: ItemContext | null;
}

// A graph show's payload is a graph-engine spec, and an unparseable one would
// otherwise reach the learner's screen as an empty canvas with a console
// warning. Rejected here, at the tool boundary, carrying the parser's own
// message so the tutor can fix the line it named.
function assertValidPayload(kind: ShowKind, payload: string): void {
  if (typeof payload !== "string" || payload.trim() === "") {
    throw new DomainError("invalid_payload", "payload must be a non-empty string.");
  }
  if (kind !== "graph") return;
  const result = parseSpec(payload);
  if (result.errors.length > 0) {
    throw new DomainError(
      "invalid_graph_spec",
      `payload failed to parse as a graph spec: ${result.errors
        .map((e: { message: string }) => e.message)
        .join("; ")}`
    );
  }
}

export function presentShow(
  db: DatabaseSync,
  input: PresentShowInput
): { show_id: string; presented_at: string } {
  if (!SHOW_KINDS.includes(input.kind)) {
    throw new DomainError("invalid_kind", `kind must be one of ${SHOW_KINDS.join(", ")}.`);
  }
  // Ordered deliberately: the session gate first, so a show aimed at a session
  // that has already closed is refused for that reason rather than for a
  // payload problem the tutor would then "fix" and still be refused for.
  assertSessionOpen(db, input.session_id);
  assertValidPayload(input.kind, input.payload);

  const caption = input.caption == null || input.caption.trim() === "" ? null : input.caption;
  if (caption !== null && caption.length > CAPTION_MAX) {
    throw new DomainError(
      "caption_too_long",
      `caption is ${caption.length} characters; the limit is ${CAPTION_MAX}. A caption is a label, not the content — put the content in payload.`
    );
  }
  const contextJson = serializeContext(input.context);

  const id = uuidv4();
  db.prepare(
    `INSERT INTO show (id, session_id, kind, payload, caption, context_json, presented_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(id, input.session_id, input.kind, input.payload, caption, contextJson);

  const row = db.prepare("SELECT presented_at FROM show WHERE id = ?").get(id) as { presented_at: string };

  // After the insert commits, so the screen this wakes up finds the show.
  emitSessionEvent(input.session_id, { type: "show_presented", show_id: id });

  return { show_id: id, presented_at: row.presented_at };
}

interface ShowRow {
  id: string;
  session_id: string;
  kind: ShowKind;
  payload: string;
  caption: string | null;
  context_json: string | null;
  presented_at: string;
  updated_at: string | null;
  seen_at: string | null;
  dwell_ms: number | null;
  acknowledged_at: string | null;
  dismissed_at: string | null;
}

function loadShow(db: DatabaseSync, showId: string): ShowRow {
  const row = db.prepare("SELECT * FROM show WHERE id = ?").get(showId) as unknown as ShowRow | undefined;
  if (!row) throw new DomainError("not_found", `Show "${showId}" does not exist.`);
  return row;
}

// §5.2 — redrawing a graph in place while the tutor talks over it. Only graphs:
// the whole point is that the app keeps the same canvas and feeds it a new
// spec, which is meaningless for a block of prose (present_show a new one).
export function updateShow(
  db: DatabaseSync,
  showId: string,
  payload: string
): { show_id: string; kind: ShowKind; updated_at: string } {
  const show = loadShow(db, showId);
  if (show.kind !== "graph") {
    throw new DomainError(
      "update_not_supported",
      `Only a graph show can be updated in place; this one is '${show.kind}'. Call present_show again for new text.`
    );
  }
  assertSessionOpen(db, show.session_id);
  assertValidPayload(show.kind, payload);

  db.prepare("UPDATE show SET payload = ?, updated_at = datetime('now') WHERE id = ?").run(payload, showId);
  const row = db.prepare("SELECT updated_at FROM show WHERE id = ?").get(showId) as { updated_at: string };

  emitSessionEvent(show.session_id, { type: "show_updated", show_id: showId });

  return { show_id: showId, kind: show.kind, updated_at: row.updated_at };
}

// ----------------------------------------------------------------------------
// What came back (§5.1). Three timestamps, three different facts — hence three
// statuses rather than a boolean: 'pending' is "the tutor sent it and nothing
// has happened", 'seen' is "it was on screen", 'acknowledged' is "they said OK",
// which is the only one that means the tutor may move on.
// ----------------------------------------------------------------------------

export type ShowStatus = "pending" | "seen" | "acknowledged";

export interface ShowOutcome {
  show_id: string;
  status: ShowStatus;
  seen_at: string | null;
  dwell_ms: number | null;
  acknowledged_at: string | null;
}

function outcomeOf(row: ShowRow): ShowOutcome {
  const status: ShowStatus = row.acknowledged_at ? "acknowledged" : row.seen_at ? "seen" : "pending";
  return {
    show_id: row.id,
    status,
    seen_at: row.seen_at,
    dwell_ms: row.dwell_ms,
    acknowledged_at: row.acknowledged_at
  };
}

export function getShowOutcome(db: DatabaseSync, showId: string): ShowOutcome {
  return outcomeOf(loadShow(db, showId));
}

// Dwell only ever grows. The card reports it from more than one place (a scroll
// out of view, the session ending, the OK button), and the highest of those is
// the true time it stood in front of the learner — taking the last one would
// let a stray zero erase a minute of reading.
function nextDwell(stored: number | null, given: number | null | undefined): number | null {
  if (given == null || !Number.isFinite(given) || given < 0) return stored;
  return stored == null ? Math.round(given) : Math.max(stored, Math.round(given));
}

// Gates acknowledgement, and only acknowledgement. Saying OK to a show is an
// act, and a session that has ended takes no further acts. Being *seen* is not
// an act — it is a measurement of something that already happened — so a card
// that was on screen when the session closed under it must still be able to
// report what it observed. See markShowSeen.
function assertShowSessionOpen(db: DatabaseSync, show: ShowRow): void {
  if (!sessionIsOpen(db, show.session_id)) {
    throw new DomainError(
      "session_ended",
      `Session "${show.session_id}" has ended; its shows take no further acknowledgement.`
    );
  }
}

// The card reached the screen. Idempotent in the way that matters: seen_at is
// the *first* time it was seen, so a re-report does not rewrite history.
//
// Deliberately *not* gated on the session being open, unlike acknowledgeShow.
// The commonest way a show is read and never acknowledged is the tutor ending
// the session while the card is still on screen; refusing the report then
// would leave exactly that show reading `pending` with no dwell forever, which
// is the one case the measurement is most worth having.
export function markShowSeen(db: DatabaseSync, showId: string, dwellMs?: number | null): ShowOutcome {
  const show = loadShow(db, showId);
  db.prepare("UPDATE show SET seen_at = COALESCE(seen_at, datetime('now')), dwell_ms = ? WHERE id = ?").run(
    nextDwell(show.dwell_ms, dwellMs),
    showId
  );
  return outcomeOf(loadShow(db, showId));
}

// The learner said OK. Sets seen_at too when nothing set it — acknowledging
// something you never saw is not a state worth being able to represent.
export function acknowledgeShow(db: DatabaseSync, showId: string, dwellMs?: number | null): ShowOutcome {
  const show = loadShow(db, showId);
  assertShowSessionOpen(db, show);
  db.prepare(
    `UPDATE show
     SET seen_at = COALESCE(seen_at, datetime('now')),
         acknowledged_at = COALESCE(acknowledged_at, datetime('now')),
         dwell_ms = ?
     WHERE id = ?`
  ).run(nextDwell(show.dwell_ms, dwellMs), showId);
  return outcomeOf(loadShow(db, showId));
}

// ----------------------------------------------------------------------------
// The stream (§5.3) — everything this session put on the learner's screen, in
// the order it landed there. Items and shows merged, oldest first, which is
// exactly the order the app renders down the page.
//
// An item entry is a *reference*: attempt_id and the one fact the reveal gate
// needs (`revealed`). The app fetches /api/attempts/:id for the one it is
// actually showing, rather than this route carrying every answer key of every
// item in the session.
// ----------------------------------------------------------------------------

export type ItemEntryStatus = "pending" | "answered" | "abandoned" | "paused";

export interface ItemEntry {
  kind: "item";
  at: string;
  attempt_id: string;
  response_id: string | null;
  reveal: Reveal;
  revealed: boolean;
  status: ItemEntryStatus;
  context: ItemContext | null;
}

export interface ShowEntry {
  kind: "show";
  at: string;
  show_id: string;
  show_kind: ShowKind;
  payload: string;
  caption: string | null;
  context: ItemContext | null;
  seen_at: string | null;
  acknowledged_at: string | null;
  updated_at: string | null;
}

export type StreamEntry = ItemEntry | ShowEntry;

export interface SessionStream {
  session: {
    id: string;
    name: string;
    status: SessionStatus;
    summary: string | null;
    // The breadcrumb the banner renders: the most recent non-null context
    // across both kinds of entry, so a show that moved the lesson on is what
    // the banner says even when the newest entry carries none of its own.
    context: ItemContext | null;
  };
  entries: StreamEntry[];
}

function itemStatus(row: {
  submitted_at: string | null;
  abandoned_at: string | null;
  paused_at: string | null;
}): ItemEntryStatus {
  if (row.submitted_at) return "answered";
  if (row.abandoned_at) return "abandoned";
  if (row.paused_at) return "paused";
  return "pending";
}

// Ordering the merged stream. Both timestamps are datetime('now') — one
// second of resolution — and a tutor's live loop puts several entries inside
// one second, so `at` alone is not an order. What settles a tie:
//
//   * a show comes before an item. The loop is show-then-ask: present_show
//     followed immediately by present_item, both landing in the same second
//     over one MCP turn. The reverse (an item, then a show about it) has a
//     learner answering in between, which is never sub-second.
//   * within one kind, the row's own insertion order (SQLite's rowid), which
//     is the only record of "which call came first" that survives a
//     second-resolution timestamp.
interface Ordered {
  entry: StreamEntry;
  seq: number;
}

function streamOrder(x: Ordered, y: Ordered): number {
  if (x.entry.at !== y.entry.at) return x.entry.at < y.entry.at ? -1 : 1;
  if (x.entry.kind !== y.entry.kind) return x.entry.kind === "show" ? -1 : 1;
  return x.seq - y.seq;
}

export function getSessionStream(
  db: DatabaseSync,
  sessionId: string,
  opts: { viewer?: Viewer } = {}
): SessionStream {
  const viewer = opts.viewer ?? "learner";
  const session = db
    .prepare("SELECT id, name, ended_at, summary FROM tutor_session WHERE id = ?")
    .get(sessionId) as
    | {
        id: string;
        name: string;
        ended_at: string | null;
        summary: string | null;
      }
    | undefined;
  if (!session) throw new DomainError("not_found", `Session "${sessionId}" does not exist.`);

  const open = session.ended_at === null;

  const attempts = db
    .prepare(
      `SELECT a.rowid AS seq, a.id, a.started_at, a.submitted_at, a.abandoned_at, a.paused_at, a.reveal, a.context_json,
              (SELECT r.id FROM response r WHERE r.attempt_id = a.id ORDER BY r.ordinal LIMIT 1) AS response_id
       FROM attempt a
       WHERE a.session_id = ? AND a.delivery_mode = 'app_live'
       ORDER BY a.started_at, a.id`
    )
    .all(sessionId) as {
    id: string;
    started_at: string;
    submitted_at: string | null;
    abandoned_at: string | null;
    paused_at: string | null;
    reveal: Reveal;
    context_json: string | null;
    response_id: string | null;
    seq: number;
  }[];

  const shows = db
    .prepare(
      `SELECT rowid AS seq, id, kind, payload, caption, context_json, presented_at, updated_at, seen_at, acknowledged_at
       FROM show WHERE session_id = ? ORDER BY presented_at, id`
    )
    .all(sessionId) as {
    id: string;
    kind: ShowKind;
    payload: string;
    caption: string | null;
    context_json: string | null;
    presented_at: string;
    updated_at: string | null;
    seen_at: string | null;
    acknowledged_at: string | null;
    seq: number;
  }[];

  const itemEntries: Ordered[] = attempts.map((a) => {
    // The same hold getAttemptDetail applies, restated for the list: a
    // deferred attempt is unrevealed to the learner for as long as its
    // session runs, however long ago it was answered.
    const held = viewer === "learner" && a.reveal === "deferred" && open;
    return {
      seq: a.seq,
      entry: {
        kind: "item",
        at: a.started_at,
        attempt_id: a.id,
        response_id: a.response_id,
        reveal: a.reveal,
        revealed: !held && a.submitted_at !== null,
        status: itemStatus(a),
        context: parseContext(a.context_json)
      }
    };
  });

  const showEntries: Ordered[] = shows.map((s) => ({
    seq: s.seq,
    entry: {
      kind: "show",
      at: s.presented_at,
      show_id: s.id,
      show_kind: s.kind,
      payload: s.payload,
      caption: s.caption,
      context: parseContext(s.context_json),
      seen_at: s.seen_at,
      acknowledged_at: s.acknowledged_at,
      updated_at: s.updated_at
    }
  }));

  const entries: StreamEntry[] = [...itemEntries, ...showEntries].sort(streamOrder).map((o) => o.entry);

  let context: ItemContext | null = null;
  for (const entry of entries) if (entry.context) context = entry.context;

  return {
    session: {
      id: session.id,
      name: session.name,
      status: open ? "open" : "closed",
      summary: session.summary ?? null,
      context
    },
    entries
  };
}
