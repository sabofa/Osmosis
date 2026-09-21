-- The DeepSeek model grader is gone: written answers are graded by the
-- learner (self) or by a tutor over MCP (grade_response). Its two config
-- keys go with it so get_config no longer advertises a grader that does
-- not exist. Historical grade rows with grader = 'model' are kept as data.
DELETE FROM config WHERE key IN ('written_grader', 'model_grader_daily_limit');
