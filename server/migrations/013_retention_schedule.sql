CREATE TABLE retention_schedule (
    id               TEXT PRIMARY KEY,
    identity_key     TEXT NOT NULL,
    retention_target TEXT NOT NULL,
    first_gap_days   REAL NOT NULL,
    due_at           TEXT NOT NULL,
    last_result      TEXT NOT NULL DEFAULT 'never_attempted'
                       CHECK (last_result IN ('pass', 'fail', 'never_attempted')),
    target_source    TEXT NOT NULL CHECK (target_source IN ('engine', 'tutor_direct')),
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (identity_key, retention_target)
);
CREATE INDEX retention_schedule_due ON retention_schedule (due_at);
CREATE INDEX retention_schedule_identity ON retention_schedule (identity_key);
