-- Model grading (spec 2026-08-20) needs a hard, user-adjustable cap on
-- how many DeepSeek calls the sweep makes per rolling 24h. Not a secret --
-- safe to read/write over /api/config, unlike DEEPSEEK_API_KEY (env-only).
INSERT INTO config (key, value)
SELECT 'model_grader_daily_limit', '20'
WHERE NOT EXISTS (SELECT 1 FROM config WHERE key = 'model_grader_daily_limit');

-- 001_init.sql seeded written_grader to "model_when_online", inert until
-- this plan built actual model grading. The user explicitly wants this
-- opt-in, not on-by-default the moment DEEPSEEK_API_KEY is set -- correct
-- the existing row rather than leaving a silent behavior change waiting.
-- Only touches installs that never explicitly changed it themselves.
UPDATE config SET value = '"self_only"' WHERE key = 'written_grader' AND value = '"model_when_online"';
