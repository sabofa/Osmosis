-- Tracks which templates have been "downloaded" to this node. There's no
-- real canonical->local pull mechanism yet (see local_slice/sync_state,
-- also unused for that purpose) — this is a simple local marker so the
-- Library page has something real to toggle, ready to be backed by an
-- actual sync later without changing its shape.
CREATE TABLE local_template (
    template_id  TEXT PRIMARY KEY REFERENCES template (id) ON DELETE CASCADE,
    downloaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
