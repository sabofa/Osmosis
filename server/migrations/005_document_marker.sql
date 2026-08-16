-- Many-questions-to-one-document marker support: each question can point at
-- one char offset inside its linked document's extracted_text (e.g. the
-- "(A)" in an ACT-English-style passage), distinct from document_anchor_*
-- (one highlighted range per question, added in 004).
ALTER TABLE question ADD COLUMN document_marker_offset INTEGER;
