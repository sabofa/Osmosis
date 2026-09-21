-- Item channel (polish stage 1 §3): how an item reaches the learner, and what
-- comes back.
--
-- 1. reveal — whether the learner sees the answer key as soon as they submit
--    ('immediate', today's behaviour) or only once the tutoring session ends
--    ('deferred'). Set per attempt, defaulted per session. The tutor's own
--    reads are never gated by it: withholding is for the learner's screen.
-- 2. question.ephemeral / question.session_id — a question written for one
--    live moment. It never enters a draw, a search, or the bank count, and
--    end_session retires it.
-- 3. create_questions_batch — idempotency for the one write that is
--    expensive to repeat. The stored result is replayed verbatim.
-- 4. question_node_key — the many-key successor to question.node_key. The
--    singular column stays, kept in sync as the primary key of the set, so
--    every existing reader (sync's QUESTION_COLUMNS, search rows, the
--    retention identity_key) keeps working unchanged.

ALTER TABLE attempt ADD COLUMN reveal TEXT NOT NULL DEFAULT 'immediate'
    CHECK (reveal IN ('immediate', 'deferred'));

ALTER TABLE tutor_session ADD COLUMN reveal_default TEXT NOT NULL DEFAULT 'immediate'
    CHECK (reveal_default IN ('immediate', 'deferred'));

ALTER TABLE question ADD COLUMN ephemeral INTEGER NOT NULL DEFAULT 0;
ALTER TABLE question ADD COLUMN session_id TEXT REFERENCES tutor_session (id);

CREATE TABLE create_questions_batch (
    idempotency_key TEXT PRIMARY KEY,
    result_json     TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 011 named its index on question(node_key) `question_node_key`, and SQLite
-- keeps tables and indexes in one namespace — so the index has to give the
-- name up before the table can take it. Recreated verbatim under a name that
-- says what it indexes.
DROP INDEX question_node_key;
CREATE INDEX question_primary_node_key ON question (node_key) WHERE node_key IS NOT NULL;

CREATE TABLE question_node_key (
    question_id TEXT NOT NULL REFERENCES question (id) ON DELETE CASCADE,
    node_key    TEXT NOT NULL,
    is_primary  INTEGER NOT NULL DEFAULT 0,
    ordinal     INTEGER NOT NULL,
    PRIMARY KEY (question_id, node_key)
);

CREATE INDEX question_node_key_by_key ON question_node_key (node_key);

-- Backfill: every question that already has a node_key gets one primary row,
-- so question_node_key is the complete picture from the first read.
INSERT INTO question_node_key (question_id, node_key, is_primary, ordinal)
SELECT id, node_key, 1, 0 FROM question WHERE node_key IS NOT NULL;
