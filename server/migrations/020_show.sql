-- Showing (polish stage 1 §5): the tutor putting something on the learner's
-- screen that is not a question — a worked step, a paragraph of markdown, a
-- graph it wants to talk through. A show is never an item: nothing is
-- answered, nothing is graded, and nothing enters the bank.
--
-- It is also deliberately ephemeral. A show belongs to the session it was
-- presented in and dies with it; there is no lineage, no version, no retire,
-- and no sync (the sync column allowlists don't name this table, so it stays
-- node-local exactly like attempt.session_id does).
--
-- The three timestamps are three different facts, which is why they are three
-- columns rather than one status:
--   seen_at         — it reached the learner's screen.
--   acknowledged_at — they said OK to it, which is the tutor's cue to move on.
--   dismissed_at    — reserved for the learner closing one without
--                     acknowledging; nothing writes it yet.
-- dwell_ms is how long the card was actually in front of them, measured from
-- its first paint, and only ever grows.

CREATE TABLE show (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES tutor_session (id),
    kind            TEXT NOT NULL CHECK (kind IN ('text', 'markdown', 'graph')),
    payload         TEXT NOT NULL,
    caption         TEXT,
    context_json    TEXT,
    presented_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT,
    seen_at         TEXT,
    dwell_ms        INTEGER,
    acknowledged_at TEXT,
    dismissed_at    TEXT
);

-- The one read there is: this session's shows, oldest first, merged with its
-- attempts into the stream the app renders.
CREATE INDEX show_by_session ON show (session_id, presented_at);

-- Where in the course an item was presented from — the same {course, unit,
-- node, step, timer_s} object a show carries, so the app's banner reads the
-- same whichever kind of entry is newest. Stored as JSON because it is the
-- tutor's own breadcrumb, displayed verbatim and never queried.
ALTER TABLE attempt ADD COLUMN context_json TEXT;
