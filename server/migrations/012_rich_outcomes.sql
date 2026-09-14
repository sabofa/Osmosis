ALTER TABLE choice ADD COLUMN misconception TEXT;

ALTER TABLE response ADD COLUMN confidence TEXT
  CHECK (confidence IN ('unsure','somewhat','confident') OR confidence IS NULL);
ALTER TABLE response ADD COLUMN idk INTEGER NOT NULL DEFAULT 0 CHECK (idk IN (0, 1));
ALTER TABLE response ADD COLUMN misapplied_method TEXT;
