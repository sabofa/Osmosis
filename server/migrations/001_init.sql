
-- ----------------------------------------------------------------------------
-- Node identity and config
-- ----------------------------------------------------------------------------

CREATE TABLE node (
    id                TEXT PRIMARY KEY,           -- uuid, generated at first boot
    label             TEXT NOT NULL,              -- 'server', 'laptop', 'desktop'
    canonical         INTEGER NOT NULL DEFAULT 0 CHECK (canonical IN (0, 1)),
    remote_url        TEXT,                       -- null when canonical
    protocol_version  INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((canonical = 1 AND remote_url IS NULL)
        OR (canonical = 0 AND remote_url IS NOT NULL))
);

CREATE UNIQUE INDEX node_singleton ON node ((1));

CREATE TABLE config (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,                    -- JSON scalar or object
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO config (key, value) VALUES
    ('default_weighting',        '"random"'),     -- 'random' | 'weak_weighted'
    ('daily_question_weighting', '"weak_weighted"'),
    ('daily_quiz_weighting',     '"random"'),
    ('daily_quiz_size',          '10'),
    ('daily_exclusion_days',     '2'),
    ('daily_tag_filter',         'null'),         -- null = whole bank
    ('daily_timezone',           '"America/Los_Angeles"'),
    ('written_grader',           '"model_when_online"'),
    ('synced_attempt_retention_days', '30'),
    ('duplicate_similarity_threshold', '0.55');

-- ----------------------------------------------------------------------------
-- Controlled tag vocabulary
-- Unknown tags are rejected at write time. Adding one is a deliberate call.
-- ----------------------------------------------------------------------------

CREATE TABLE tag (
    slug        TEXT PRIMARY KEY,                 -- 'math:functions', 'history:17c'
    label       TEXT NOT NULL,
    parent_slug TEXT REFERENCES tag (slug) ON DELETE RESTRICT,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    retired_at  TEXT
);

CREATE INDEX tag_parent ON tag (parent_slug);
CREATE INDEX tag_active ON tag (retired_at) WHERE retired_at IS NULL;

-- ----------------------------------------------------------------------------
-- Questions
-- Immutable once attempted. An edit inserts a new row sharing lineage_id and
-- retires the old one. Attempts always reference a specific version.
-- ----------------------------------------------------------------------------

CREATE TABLE question (
    id            TEXT PRIMARY KEY,               -- uuid, per version
    lineage_id    TEXT NOT NULL,                  -- stable across versions
    version       INTEGER NOT NULL DEFAULT 1,
    supersedes_id TEXT REFERENCES question (id) ON DELETE SET NULL,
    type          TEXT NOT NULL CHECK (type IN ('mc', 'written')),
    prompt        TEXT NOT NULL,
    explanation   TEXT,                           -- shown after answering
    model_answer  TEXT,                           -- written only
    rubric        TEXT,                           -- written only, JSON
    difficulty    INTEGER NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
    calculator_policy TEXT NOT NULL DEFAULT 'n_a'
                      CHECK (calculator_policy IN ('allowed', 'forbidden', 'n_a')),
    source_note   TEXT,                           -- which note it came from
    created_by    TEXT NOT NULL DEFAULT 'claude' CHECK (created_by IN ('claude', 'human')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    retired_at    TEXT,
    retired_reason TEXT,
    CHECK (type = 'mc' OR model_answer IS NOT NULL)
);

CREATE INDEX question_lineage ON question (lineage_id, version);
CREATE INDEX question_active ON question (retired_at) WHERE retired_at IS NULL;
CREATE INDEX question_type ON question (type) WHERE retired_at IS NULL;
CREATE INDEX question_calc ON question (calculator_policy) WHERE retired_at IS NULL;
CREATE UNIQUE INDEX question_lineage_version ON question (lineage_id, version);

CREATE TABLE question_tag (
    question_id TEXT NOT NULL REFERENCES question (id) ON DELETE CASCADE,
    tag_slug    TEXT NOT NULL REFERENCES tag (slug) ON DELETE RESTRICT,
    PRIMARY KEY (question_id, tag_slug)
);

CREATE INDEX question_tag_by_tag ON question_tag (tag_slug, question_id);

CREATE TABLE choice (
    id          TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES question (id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    is_correct  INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
    ordinal     INTEGER NOT NULL                  -- authoring order; UI shuffles
);

CREATE INDEX choice_by_question ON choice (question_id, ordinal);

-- Duplicate detection. Populated by trigger, queried by create_questions.
CREATE VIRTUAL TABLE question_fts USING fts5 (
    prompt,
    content = 'question',
    content_rowid = 'rowid',
    tokenize = 'porter unicode61'
);

CREATE TRIGGER question_fts_insert AFTER INSERT ON question BEGIN
    INSERT INTO question_fts (rowid, prompt) VALUES (new.rowid, new.prompt);
END;

CREATE TRIGGER question_fts_delete AFTER DELETE ON question BEGIN
    INSERT INTO question_fts (question_fts, rowid, prompt)
    VALUES ('delete', old.rowid, old.prompt);
END;

CREATE TRIGGER question_fts_update AFTER UPDATE OF prompt ON question BEGIN
    INSERT INTO question_fts (question_fts, rowid, prompt)
    VALUES ('delete', old.rowid, old.prompt);
    INSERT INTO question_fts (rowid, prompt) VALUES (new.rowid, new.prompt);
END;

-- ----------------------------------------------------------------------------
-- Templates — saved draw specs. A "test" is a template plus a draw.
-- ----------------------------------------------------------------------------

CREATE TABLE template (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    description    TEXT,
    tag_query      TEXT NOT NULL,                 -- JSON: {all:[],any:[],none:[]}
    question_count INTEGER NOT NULL CHECK (question_count > 0),
    mc_ratio       REAL CHECK (mc_ratio BETWEEN 0 AND 1),  -- null = no constraint
    difficulty_min INTEGER CHECK (difficulty_min BETWEEN 1 AND 5),
    difficulty_max INTEGER CHECK (difficulty_max BETWEEN 1 AND 5),
    calculator_policy TEXT NOT NULL DEFAULT 'any'
                      CHECK (calculator_policy IN ('allowed', 'forbidden', 'any')),
    weighting      TEXT CHECK (weighting IN ('random', 'weak_weighted')),
    frozen         INTEGER NOT NULL DEFAULT 0 CHECK (frozen IN (0, 1)),
    time_limit_sec INTEGER,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    retired_at     TEXT,
    CHECK (difficulty_min IS NULL OR difficulty_max IS NULL
           OR difficulty_min <= difficulty_max)
);

CREATE INDEX template_active ON template (retired_at) WHERE retired_at IS NULL;

-- Only populated when frozen = 1. Locks the exact question set.
CREATE TABLE template_frozen_question (
    template_id TEXT NOT NULL REFERENCES template (id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES question (id) ON DELETE RESTRICT,
    ordinal     INTEGER NOT NULL,
    PRIMARY KEY (template_id, question_id)
);

CREATE INDEX template_frozen_order ON template_frozen_question (template_id, ordinal);

-- ----------------------------------------------------------------------------
-- Daily draws — generated canonically, online only, cached per date.
-- Same date returns the same questions on every node.
-- ----------------------------------------------------------------------------

CREATE TABLE daily_draw (
    id         TEXT PRIMARY KEY,
    draw_date  TEXT NOT NULL,                     -- 'YYYY-MM-DD' in daily_timezone
    kind       TEXT NOT NULL CHECK (kind IN ('question', 'quiz')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (draw_date, kind)
);

CREATE INDEX daily_draw_by_date ON daily_draw (draw_date DESC);

CREATE TABLE daily_draw_question (
    daily_draw_id TEXT NOT NULL REFERENCES daily_draw (id) ON DELETE CASCADE,
    question_id   TEXT NOT NULL REFERENCES question (id) ON DELETE RESTRICT,
    ordinal       INTEGER NOT NULL,
    PRIMARY KEY (daily_draw_id, question_id)
);

CREATE INDEX daily_draw_question_lookup ON daily_draw_question (question_id);
CREATE INDEX daily_draw_question_order ON daily_draw_question (daily_draw_id, ordinal);

-- Questions ineligible for today's draws: anything drawn in the last N days,
-- matched by lineage so a re-versioned question does not sneak back in.
CREATE VIEW daily_recent_lineage AS
SELECT DISTINCT q.lineage_id, d.draw_date
FROM daily_draw d
JOIN daily_draw_question dq ON dq.daily_draw_id = d.id
JOIN question q ON q.id = dq.question_id;

-- ----------------------------------------------------------------------------
-- Attempts and responses
-- IDs are uuids generated on the node that takes the test, so replaying the
-- outbox after a failed push cannot duplicate a row.
-- ----------------------------------------------------------------------------

CREATE TABLE attempt (
    id            TEXT PRIMARY KEY,               -- uuid, local origin
    node_id       TEXT NOT NULL,                  -- where it was taken
    source        TEXT NOT NULL CHECK (source IN
                    ('template', 'daily_question', 'daily_quiz', 'adhoc')),
    template_id   TEXT REFERENCES template (id) ON DELETE SET NULL,
    daily_draw_id TEXT REFERENCES daily_draw (id) ON DELETE SET NULL,
    started_at    TEXT NOT NULL DEFAULT (datetime('now')),
    submitted_at  TEXT,
    abandoned_at  TEXT,
    offline       INTEGER NOT NULL DEFAULT 0 CHECK (offline IN (0, 1)),
    synced_at     TEXT,                           -- null until server acks
    CHECK (source <> 'template' OR template_id IS NOT NULL),
    CHECK (source NOT IN ('daily_question', 'daily_quiz') OR daily_draw_id IS NOT NULL)
);

CREATE INDEX attempt_unsynced ON attempt (synced_at) WHERE synced_at IS NULL;
CREATE INDEX attempt_by_template ON attempt (template_id, submitted_at DESC);
CREATE INDEX attempt_by_date ON attempt (submitted_at DESC);
CREATE INDEX attempt_by_daily ON attempt (daily_draw_id);

CREATE TABLE response (
    id                 TEXT PRIMARY KEY,          -- uuid, local origin
    attempt_id         TEXT NOT NULL REFERENCES attempt (id) ON DELETE CASCADE,
    question_id        TEXT NOT NULL REFERENCES question (id) ON DELETE RESTRICT,
    ordinal            INTEGER NOT NULL,
    selected_choice_id TEXT REFERENCES choice (id) ON DELETE SET NULL,
    response_text      TEXT,                      -- raw written answer, always kept
    skipped            INTEGER NOT NULL DEFAULT 0 CHECK (skipped IN (0, 1)),
    answered_at        TEXT,
    elapsed_ms         INTEGER,
    UNIQUE (attempt_id, question_id)
);

CREATE INDEX response_by_question ON response (question_id);
CREATE INDEX response_order ON response (attempt_id, ordinal);

-- Grades are derived, not intrinsic. A response can carry several over time:
-- a self-grade taken offline, later superseded by a model grade on the server.
CREATE TABLE grade (
    id             TEXT PRIMARY KEY,
    response_id    TEXT NOT NULL REFERENCES response (id) ON DELETE CASCADE,
    grader         TEXT NOT NULL CHECK (grader IN ('auto_mc', 'self', 'model')),
    score          REAL NOT NULL CHECK (score BETWEEN 0 AND 1),
    feedback       TEXT,
    rubric_version TEXT,
    model_name     TEXT,                          -- null unless grader = 'model'
    graded_at      TEXT NOT NULL DEFAULT (datetime('now')),
    superseded_at  TEXT
);

CREATE INDEX grade_by_response ON grade (response_id, superseded_at);
CREATE UNIQUE INDEX grade_one_live_per_response
    ON grade (response_id) WHERE superseded_at IS NULL;

-- Authoritative score per response.
CREATE VIEW response_score AS
SELECT r.id           AS response_id,
       r.attempt_id,
       r.question_id,
       g.grader,
       g.score,
       g.feedback
FROM response r
LEFT JOIN grade g ON g.response_id = r.id AND g.superseded_at IS NULL;

-- Per-tag performance. Backs get_results and the bootstrap pointer.
CREATE VIEW tag_performance AS
SELECT qt.tag_slug,
       COUNT(*)                                    AS responses,
       AVG(COALESCE(rs.score, 0))                  AS mean_score,
       SUM(CASE WHEN COALESCE(rs.score, 0) < 0.5 THEN 1 ELSE 0 END) AS misses,
       MAX(a.submitted_at)                         AS last_seen
FROM response_score rs
JOIN attempt a      ON a.id = rs.attempt_id AND a.submitted_at IS NOT NULL
JOIN question_tag qt ON qt.question_id = rs.question_id
GROUP BY qt.tag_slug;

-- ----------------------------------------------------------------------------
-- Sync
-- Non-canonical nodes only. Results flow up, bank content flows down.
-- ----------------------------------------------------------------------------

CREATE TABLE outbox (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('attempt', 'response', 'grade')),
    entity_id   TEXT NOT NULL,
    payload     TEXT NOT NULL,                    -- JSON snapshot
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    tries       INTEGER NOT NULL DEFAULT 0,
    last_try_at TEXT,
    last_error  TEXT,
    UNIQUE (entity_type, entity_id)
);

CREATE INDEX outbox_pending ON outbox (created_at);

-- Which tag slices this node holds locally, and how fresh they are.
CREATE TABLE local_slice (
    tag_slug       TEXT PRIMARY KEY REFERENCES tag (slug) ON DELETE CASCADE,
    pulled_at      TEXT NOT NULL DEFAULT (datetime('now')),
    question_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sync_state (
    id                 INTEGER PRIMARY KEY CHECK (id = 1),
    last_pull_at       TEXT,
    last_push_at       TEXT,
    last_error         TEXT,
    remote_protocol_version INTEGER
);

INSERT INTO sync_state (id) VALUES (1);
