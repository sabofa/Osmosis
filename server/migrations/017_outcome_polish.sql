-- Outcome record completeness (polish stage 1 §2).
--
-- 1. best_guess_choice_id — the option the learner names *after* saying "I
--    don't know". It is recorded, never scored: the response stays an idk.
-- 2. diagnosis — the tutor's one-line read of what went wrong, written back
--    through grade_response and readable on every outcome path.
-- 3. paused_at / paused_ms — a live item the learner stepped away from. A
--    paused attempt is never swept as abandoned, and its accumulated pause
--    time is discounted from the abandon window.
-- 4. grade.grader gains 'oracle' and 'judge' (spec §2.9). 'auto_mc' and
--    'model' stay: an mc auto-grade and a DeepSeek grade should keep their
--    honest labels rather than be relabelled as a tutor judgement.

ALTER TABLE response ADD COLUMN best_guess_choice_id TEXT REFERENCES choice (id) ON DELETE SET NULL;
ALTER TABLE response ADD COLUMN diagnosis TEXT;

ALTER TABLE attempt ADD COLUMN paused_at TEXT;
ALTER TABLE attempt ADD COLUMN paused_ms INTEGER NOT NULL DEFAULT 0;

-- A CHECK constraint can only be changed by rebuilding the table. Nothing
-- references grade by foreign key; the two indexes and the response_score
-- view (which resolves by name at query time) are the only dependents, and
-- the indexes go with the dropped table, so they are recreated verbatim from
-- 001_init.sql below.
CREATE TABLE grade_new (
    id             TEXT PRIMARY KEY,
    response_id    TEXT NOT NULL REFERENCES response (id) ON DELETE CASCADE,
    grader         TEXT NOT NULL CHECK (grader IN ('auto_mc', 'self', 'model', 'oracle', 'judge')),
    score          REAL NOT NULL CHECK (score BETWEEN 0 AND 1),
    feedback       TEXT,
    rubric_version TEXT,
    model_name     TEXT,                          -- null unless grader = 'model'
    graded_at      TEXT NOT NULL DEFAULT (datetime('now')),
    superseded_at  TEXT
);

INSERT INTO grade_new (id, response_id, grader, score, feedback, rubric_version, model_name, graded_at, superseded_at)
SELECT id, response_id, grader, score, feedback, rubric_version, model_name, graded_at, superseded_at FROM grade;

-- RENAME re-parses every view in the schema, and response_score names `grade`
-- directly: without legacy mode the rename fails with "error in view
-- response_score: no such table: main.grade" in the window where the old
-- table is gone. Legacy mode renames the table only, which is exactly what
-- this rebuild wants — the view's text still says `grade` and still resolves
-- once the rename lands.
PRAGMA legacy_alter_table = ON;

DROP TABLE grade;

ALTER TABLE grade_new RENAME TO grade;

PRAGMA legacy_alter_table = OFF;

CREATE INDEX grade_by_response ON grade (response_id, superseded_at);
CREATE UNIQUE INDEX grade_one_live_per_response
    ON grade (response_id) WHERE superseded_at IS NULL;
