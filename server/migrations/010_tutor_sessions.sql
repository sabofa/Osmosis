-- Tutor sessions: a grouping for everything one tutoring session produces —
-- live items presented into the app, and any session-specific test template.
-- Both new FK columns are nullable by design: a row with session_id IS NULL
-- behaves exactly as it does today (homework, the general template list, the
-- plain question bank), with no special-casing anywhere that doesn't care.
CREATE TABLE tutor_session (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    tag_slug    TEXT REFERENCES tag(slug),   -- nullable: a session need not be scoped to one tag
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at    TEXT
);

ALTER TABLE attempt ADD COLUMN session_id TEXT REFERENCES tutor_session(id);
ALTER TABLE template ADD COLUMN session_id TEXT REFERENCES tutor_session(id);

CREATE INDEX attempt_by_session ON attempt (session_id, started_at DESC);
CREATE INDEX template_by_session ON template (session_id);
