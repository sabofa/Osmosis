-- Phase 3 needs this knob for the abandonment sweep; 001 shipped without it.
INSERT INTO config (key, value)
SELECT 'abandon_after_hours', '24'
WHERE NOT EXISTS (SELECT 1 FROM config WHERE key = 'abandon_after_hours');
