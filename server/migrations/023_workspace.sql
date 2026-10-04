-- The workspace (Learn spec/osmosis/workspace/02-data-layer.md §2). Every
-- trajectory, track, course, folder and file is a node; a placement is an
-- edge that says "this node appears in this container, under this name". A
-- node has no primary parent: that is the point (the brief: "every primary
-- parent is a lie somewhere"). Containment, cycles, kind tags and name
-- uniqueness are enforced in domain/workspace/graph.ts: they depend on live
-- vs. archived nodes and on Unicode case folding, neither of which a SQLite
-- constraint can see.
--
-- This migration was rewritten in place for the second data-layer design. The
-- first one (ws_file, ws_file_revision, trashed_at) was never merged or
-- deployed, so no database anywhere holds it.

CREATE TABLE ws_node (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL CHECK (kind IN ('trajectory', 'track', 'course', 'folder', 'file')),
    title         TEXT NOT NULL,   -- the fallback name, and the default name when placed
    kind_tag      TEXT,            -- files only; an open vocabulary, checked in code
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at   TEXT,            -- set by delete(), cleared by restore()
    archive_batch TEXT             -- one id per delete() call, so a restore can offer what went with it
);
CREATE INDEX ws_node_live_kind ON ws_node (kind) WHERE archived_at IS NULL;
CREATE INDEX ws_node_archive_batch ON ws_node (archive_batch) WHERE archive_batch IS NOT NULL;

CREATE TABLE ws_placement (
    id           TEXT PRIMARY KEY,
    container_id TEXT NOT NULL REFERENCES ws_node (id) ON DELETE CASCADE,
    child_id     TEXT NOT NULL REFERENCES ws_node (id) ON DELETE CASCADE,
    name         TEXT NOT NULL,    -- what the child is called in this container
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at  TEXT,             -- marked, not dropped, by delete(child)
    UNIQUE (container_id, child_id)
);
CREATE INDEX ws_placement_child ON ws_placement (child_id);

-- One row per saved version; the latest is the current content. `format` is an
-- opaque identifier the layer never parses. A format's owner may supply hooks
-- (domain/workspace/formats.ts) that fill search_text when a version is
-- written; reads never call them.
CREATE TABLE ws_content (
    node_id     TEXT NOT NULL REFERENCES ws_node (id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    format      TEXT NOT NULL,
    body        TEXT,
    asset_id    TEXT REFERENCES asset (id) ON DELETE SET NULL,
    search_text TEXT,
    author      TEXT NOT NULL CHECK (author IN ('ben', 'tutor', 'planner')),
    saved_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (node_id, version)
);
