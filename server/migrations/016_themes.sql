-- Themes are a user-level preference, not node-level config: the same
-- palettes should follow Ben to every device. Canonical is authoritative;
-- local nodes forward writes to it and receive the full set on every pull.
-- Rows are soft-deleted (deleted_at) so a deletion is a tombstone that
-- propagates like any other change; updated_at is the newer-wins clock.
CREATE TABLE theme (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    tokens      TEXT NOT NULL,                    -- JSON: { light: {...}, dark: {...} }
    custom_css  TEXT NOT NULL DEFAULT '',
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at  TEXT
);

-- Which theme is active. One row, id = 1. active_theme_id may name a
-- built-in theme (ids the app ships, "builtin:*") that has no theme row,
-- so it is deliberately not a foreign key.
CREATE TABLE theme_setting (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    active_theme_id  TEXT,
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO theme_setting (id) VALUES (1);
