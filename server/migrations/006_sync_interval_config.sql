-- The sync design (spec §8.5, §12) needs this knob for the periodic sync
-- timer; 001 shipped the sync tables but not this config key.
INSERT INTO config (key, value)
SELECT 'sync_interval_sec', '300'
WHERE NOT EXISTS (SELECT 1 FROM config WHERE key = 'sync_interval_sec');
