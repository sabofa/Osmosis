-- A response with no live grade is *ungraded*, not wrong. 001's view folded
-- NULL scores into the mean as 0 (AVG(COALESCE(score, 0))), which pulls every
-- tag with an un-self-graded written answer toward zero and would poison any
-- later difficulty statistics. AVG() already ignores NULL; `graded` says how
-- many responses the mean actually covers. Views can't be altered in place.
DROP VIEW tag_performance;

CREATE VIEW tag_performance AS
SELECT qt.tag_slug,
       COUNT(*)                                    AS responses,
       COUNT(rs.score)                             AS graded,
       AVG(rs.score)                               AS mean_score,
       SUM(CASE WHEN rs.score < 0.5 THEN 1 ELSE 0 END) AS misses,
       MAX(a.submitted_at)                         AS last_seen
FROM response_score rs
JOIN attempt a      ON a.id = rs.attempt_id AND a.submitted_at IS NOT NULL
JOIN question_tag qt ON qt.question_id = rs.question_id
GROUP BY qt.tag_slug;
