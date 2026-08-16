-- ----------------------------------------------------------------------------
-- Assets: uploaded/pasted source material (urls, raw text, files) that
-- questions can anchor back to via document_id.
-- ----------------------------------------------------------------------------

CREATE TABLE asset (
    id             TEXT PRIMARY KEY,
    title          TEXT NOT NULL,
    type           TEXT NOT NULL CHECK (type IN ('url','text','file')),
    content        TEXT,
    filename       TEXT,
    mime           TEXT,
    storage_path   TEXT,
    extracted_text TEXT,
    created_by     TEXT NOT NULL DEFAULT 'claude' CHECK (created_by IN ('claude','human')),
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Duplicate/search index. Mirrors question_fts's pattern exactly (see 001_init.sql).
CREATE VIRTUAL TABLE asset_fts USING fts5 (
    title,
    extracted_text,
    content = 'asset',
    content_rowid = 'rowid',
    tokenize = 'porter unicode61'
);

CREATE TRIGGER asset_fts_insert AFTER INSERT ON asset BEGIN
    INSERT INTO asset_fts (rowid, title, extracted_text) VALUES (new.rowid, new.title, new.extracted_text);
END;

CREATE TRIGGER asset_fts_delete AFTER DELETE ON asset BEGIN
    INSERT INTO asset_fts (asset_fts, rowid, title, extracted_text)
    VALUES ('delete', old.rowid, old.title, old.extracted_text);
END;

CREATE TRIGGER asset_fts_update AFTER UPDATE OF title, extracted_text ON asset BEGIN
    INSERT INTO asset_fts (asset_fts, rowid, title, extracted_text)
    VALUES ('delete', old.rowid, old.title, old.extracted_text);
    INSERT INTO asset_fts (rowid, title, extracted_text) VALUES (new.rowid, new.title, new.extracted_text);
END;

-- ----------------------------------------------------------------------------
-- Question graph/desmos/document-anchor support
-- ----------------------------------------------------------------------------

ALTER TABLE question ADD COLUMN graph_spec TEXT;
ALTER TABLE question ADD COLUMN desmos_allowed INTEGER NOT NULL DEFAULT 0 CHECK (desmos_allowed IN (0,1));
ALTER TABLE question ADD COLUMN document_id TEXT REFERENCES asset(id) ON DELETE SET NULL;
ALTER TABLE question ADD COLUMN document_anchor_label TEXT;
ALTER TABLE question ADD COLUMN document_anchor_start INTEGER;
ALTER TABLE question ADD COLUMN document_anchor_end INTEGER;
