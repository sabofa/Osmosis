-- Stage 2a: the retention loop.
--
-- 1. Every node key is rendered into tag shape. node_keys[] with one primary
--    already exists (018's question_node_key); what 018 left alone is the
--    legacy free-form values it backfilled verbatim ("2.4",
--    "balancing-chemical-equations", ...). They are rewritten here, in the
--    singular column and in question_node_key alike, and any row with a
--    node_key but no question_node_key row gets its one primary row, so
--    node_keys = [node_key] holds for every question.
-- 2. Every node key in use is registered as a node: tag, so merge_tags can
--    merge two node identities (it refuses slugs that are not tags).
-- 3. The retention schedule splits in two. A target and its inheritance
--    belong to the node (node_retention_target); scheduling state belongs to
--    the item, keyed by lineage_id so a reworded version is the same item
--    (retention_item). The two-key row joining them is retention_schedule:
--    one per (node_key, lineage_id, retention_target), carrying the item's
--    role in that target's first probe — 'draw' or 'reserve'.
-- 4. A template says how due-ness shapes its draw (due_mode).
-- 5. Two config parameters: the first-probe draw size k and the clamp floor.

-- ----------------------------------------------------------------------------
-- 1. Render legacy node keys into tag shape
-- ----------------------------------------------------------------------------

-- The values on record on 2026-10-03, each rendered by evidence on the item:
-- "2.4" and "2.6" were section numbers (chem:atomic_weight, with a source
-- note citing a textbook example; chem:chemical_formulas). They take the
-- topic shape node:<topic_slug>:<subtopic>:<node_key> rather than a
-- textbook slug — Ben, 2026-10-03: identity leans away from textbooks — in
-- the chemistry:atoms_molecules_ions subtree, where the bank's other atomic
-- mass nodes already sit. The three hyphenated keys are the leaves of the
-- node: tags the tutor's backfill attached to the same items, so the
-- rendered key IS that tag — including on the two items that never got the
-- tag, because the same key must render the same way. Anything else falls
-- through to node:legacy:<key>.
CREATE TEMP TABLE legacy_node_key_map (
    legacy   TEXT PRIMARY KEY,
    rendered TEXT NOT NULL
);

INSERT INTO legacy_node_key_map (legacy, rendered) VALUES
    ('2.4', 'node:chemistry:atoms_molecules_ions:atomic_weight'),
    ('2.6', 'node:chemistry:atoms_molecules_ions:chemical_formulas'),
    ('balancing-chemical-equations',
     'node:chemistry_ch3_4_bonding_and_equations:ionic_vs_molecular_compounds_formula_writing_charge_balancing_balancing_chemical_equations:balancing_chemical_equations'),
    ('ionic-vs-molecular-compounds',
     'node:chemistry_ch3_4_bonding_and_equations:ionic_vs_molecular_compounds_formula_writing_charge_balancing_balancing_chemical_equations:ionic_vs_molecular_compounds'),
    ('writing-balancing-formulas',
     'node:chemistry_ch3_4_bonding_and_equations:ionic_vs_molecular_compounds_formula_writing_charge_balancing_balancing_chemical_equations:writing_balancing_formulas');

-- The fallback: lowercased, spaces and hyphens to "_" (runs collapsed, ends
-- trimmed), under node:legacy:. A value with other punctuation still fails
-- the grammar after this; it is kept, but not registered as a tag (below).
INSERT OR IGNORE INTO legacy_node_key_map (legacy, rendered)
SELECT DISTINCT key, 'node:legacy:' || trim(
    replace(replace(replace(lower(replace(replace(trim(key), ' ', '_'), '-', '_')), '__', '_'), '__', '_'), '__', '_'),
    '_')
FROM (
    SELECT node_key AS key FROM question WHERE node_key IS NOT NULL
    UNION
    SELECT node_key FROM question_node_key
)
WHERE key <> '' AND key NOT LIKE 'node:%';

-- An incremental pull has to re-send every question whose keys move.
UPDATE question SET updated_at = datetime('now')
WHERE node_key IN (SELECT legacy FROM legacy_node_key_map)
   OR id IN (SELECT question_id FROM question_node_key WHERE node_key IN (SELECT legacy FROM legacy_node_key_map));

UPDATE question
SET node_key = (SELECT rendered FROM legacy_node_key_map WHERE legacy = question.node_key)
WHERE node_key IN (SELECT legacy FROM legacy_node_key_map);

-- (question_id, node_key) is the primary key: a question already carrying
-- the rendered key alongside its legacy spelling keeps one row, primary if
-- either was. Same order as merge_tags: promote, drop the duplicate, rename.
UPDATE question_node_key SET is_primary = 1
WHERE EXISTS (
    SELECT 1 FROM question_node_key old
    JOIN legacy_node_key_map m ON m.legacy = old.node_key
    WHERE old.question_id = question_node_key.question_id
      AND old.is_primary = 1
      AND m.rendered = question_node_key.node_key
);

DELETE FROM question_node_key
WHERE node_key IN (SELECT legacy FROM legacy_node_key_map)
  AND EXISTS (
    SELECT 1 FROM question_node_key dup
    JOIN legacy_node_key_map m ON m.rendered = dup.node_key
    WHERE dup.question_id = question_node_key.question_id
      AND m.legacy = question_node_key.node_key
  );

UPDATE question_node_key
SET node_key = (SELECT rendered FROM legacy_node_key_map WHERE legacy = question_node_key.node_key)
WHERE node_key IN (SELECT legacy FROM legacy_node_key_map);

-- node_keys = [node_key] for every row that has a key but no key rows (a
-- sync pull or a raw insert writes only the column).
INSERT OR IGNORE INTO question_node_key (question_id, node_key, is_primary, ordinal)
SELECT id, node_key, 1, 0 FROM question q
WHERE node_key IS NOT NULL AND node_key <> ''
  AND NOT EXISTS (SELECT 1 FROM question_node_key nk WHERE nk.question_id = q.id);

DROP TABLE legacy_node_key_map;

-- ----------------------------------------------------------------------------
-- 2. Register every node key in use as a node: tag
-- ----------------------------------------------------------------------------

-- Label = the last segment with "_" read as a space. rtrim(s, <s's own
-- non-colon characters>) strips back to the last ":", so replacing that
-- prefix away leaves the leaf. Only keys that pass the grammar create_tag
-- enforces are registered: the slug alphabet, and every separator (":", "_",
-- ".") between two alphanumerics — never doubled, adjacent to another, or at
-- the end.
INSERT OR IGNORE INTO tag (slug, label)
SELECT DISTINCT node_key,
       replace(replace(node_key, rtrim(node_key, replace(node_key, ':', '')), ''), '_', ' ')
FROM question_node_key
WHERE node_key LIKE 'node:%'
  AND node_key NOT GLOB '*[^a-z0-9:._]*'
  AND node_key NOT GLOB '*[:._][:._]*'
  AND node_key NOT GLOB '*[:._]';

-- ----------------------------------------------------------------------------
-- 3. The retention schedule: node half, item half, and the two-key row
-- ----------------------------------------------------------------------------

-- 013's rows were keyed by an identity that could be a tag slug and stored
-- no needs_last_until, so they cannot be carried into a node-keyed,
-- target-dated schedule. Nothing wrote them on canonical (0 rows on
-- 2026-10-03); the table is kept under a new name rather than dropped.
ALTER TABLE retention_schedule RENAME TO retention_schedule_v1;

CREATE TABLE node_retention_target (
    id                TEXT PRIMARY KEY,
    node_key          TEXT NOT NULL,
    retention_target  TEXT NOT NULL,                -- the target's label
    needs_last_until  TEXT NOT NULL,                -- UTC 'YYYY-MM-DD HH:MM:SS'
    set_at            TEXT NOT NULL,                -- the teaching anchor gap 1 is measured from
    first_gap_days    REAL NOT NULL,
    gap1_due_at       TEXT NOT NULL,
    target_source     TEXT NOT NULL CHECK (target_source IN ('engine', 'tutor_direct')),
    -- The first probe. NULL drawn_at = gap 1 has not been reached (or the
    -- node had no items then); the draw is taken once and kept.
    drawn_at          TEXT,
    draw_k            INTEGER,
    probe_result      TEXT CHECK (probe_result IN ('pass', 'fail')),
    probe_resolved_at TEXT,
    gap2_days         REAL,                         -- the node's gap-2 interval, fixed by a passing draw
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (node_key, retention_target)
);

CREATE INDEX node_retention_target_by_node ON node_retention_target (node_key);

-- The item half. SM2 state itself is not stored: it is replayed from the
-- item's graded responses (see domain/retention.ts), so a re-grade, a late
-- sync push or a superseding version can never leave it stale. What is
-- stored is what cannot be replayed: when the item's retention clock
-- starts. first_due_at NULL = held (a reserve item waiting on its draw).
CREATE TABLE retention_item (
    lineage_id       TEXT PRIMARY KEY,
    enrolled_at      TEXT NOT NULL,                 -- the anchor: its node's teaching (target set_at)
    first_due_at     TEXT,
    first_due_source TEXT CHECK (first_due_source IN ('draw', 'reserve_pass', 'reserve_fail'))
);

CREATE TABLE retention_schedule (
    node_key         TEXT NOT NULL,
    lineage_id       TEXT NOT NULL,
    retention_target TEXT NOT NULL,
    role             TEXT NOT NULL CHECK (role IN ('draw', 'reserve')),
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (node_key, lineage_id, retention_target),
    FOREIGN KEY (node_key, retention_target)
        REFERENCES node_retention_target (node_key, retention_target) ON DELETE CASCADE
);

CREATE INDEX retention_schedule_by_lineage ON retention_schedule (lineage_id);

-- ----------------------------------------------------------------------------
-- 4. Templates: how due-ness shapes the draw
-- ----------------------------------------------------------------------------

-- 'weight' (the default, and what every existing template becomes): due
-- items are likelier, nothing is excluded. 'gate': only due items, most
-- overdue first — a homework or review set Osmosis schedules. 'off': due-ness
-- is ignored.
ALTER TABLE template ADD COLUMN due_mode TEXT NOT NULL DEFAULT 'weight'
    CHECK (due_mode IN ('off', 'weight', 'gate'));

-- ----------------------------------------------------------------------------
-- 5. Config
-- ----------------------------------------------------------------------------

INSERT OR IGNORE INTO config (key, value) VALUES
    ('retention_draw_k', '3'),
    ('retention_clamp_floor_hours', '24');
