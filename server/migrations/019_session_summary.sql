-- The tutor's own closing words for a session: the same markdown it said in
-- the conversation when it wrapped up, stored so the app can show it above
-- the session's attempt history instead of the learner having to scroll back
-- through a chat they may no longer have. Distinct from end_session's counts,
-- which are computed, not written.
ALTER TABLE tutor_session ADD COLUMN summary TEXT;
