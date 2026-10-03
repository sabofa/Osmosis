-- The workspace (Learn spec/osmosis/workspace/01-shell.md §2). Every track,
-- course, folder and file is a node; a placement is an edge that says "this
-- node appears in this container, under this name". A node has no primary
-- parent — that is the point (the brief: "every primary parent is a lie
-- somewhere"). Containment, cycles and name uniqueness are enforced in
-- domain/workspace/graph.ts: they depend on live vs. trashed nodes and on
-- Unicode case folding, neither of which a SQLite constraint can see.

CREATE TABLE ws_node (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('track', 'course', 'folder', 'file')),
    title       TEXT NOT NULL,
    kind_tag    TEXT CHECK (kind_tag IN ('source', 'resource', 'homework', 'test', 'flowchart')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    trashed_at  TEXT
);
CREATE INDEX ws_node_live_kind ON ws_node (kind) WHERE trashed_at IS NULL;

CREATE TABLE ws_placement (
    id           TEXT PRIMARY KEY,
    container_id TEXT NOT NULL REFERENCES ws_node (id) ON DELETE CASCADE,
    child_id     TEXT NOT NULL REFERENCES ws_node (id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (container_id, child_id)
);
CREATE INDEX ws_placement_child ON ws_placement (child_id);

-- Content, files only. `type` names a registered file type
-- (domain/workspace/fileTypes.ts): the built-ins are markdown, graph and
-- asset; special types (item files, USERNOTES …) are added by registering.
CREATE TABLE ws_file (
    node_id   TEXT PRIMARY KEY REFERENCES ws_node (id) ON DELETE CASCADE,
    type      TEXT NOT NULL,
    body      TEXT,
    asset_id  TEXT REFERENCES asset (id) ON DELETE SET NULL,
    revision  INTEGER NOT NULL DEFAULT 1,
    saved_at  TEXT NOT NULL DEFAULT (datetime('now')),
    saved_by  TEXT NOT NULL DEFAULT 'ben' CHECK (saved_by IN ('ben', 'tutor', 'planner'))
);

-- One row per save, so every revision says who wrote it: Ben, the tutor
-- (who teaches, and writes its notes about Ben into a unit's USERNOTES) or
-- the planner (who writes the plan). Retention: all kept for now.
CREATE TABLE ws_file_revision (
    node_id   TEXT NOT NULL REFERENCES ws_node (id) ON DELETE CASCADE,
    revision  INTEGER NOT NULL,
    type      TEXT NOT NULL,
    body      TEXT,
    asset_id  TEXT,
    saved_at  TEXT NOT NULL,
    saved_by  TEXT NOT NULL CHECK (saved_by IN ('ben', 'tutor', 'planner')),
    PRIMARY KEY (node_id, revision)
);
