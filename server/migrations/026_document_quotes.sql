-- Anchors carry their quoted text so they can re-find themselves.
-- Nullable: rows created before this migration keep NULL quotes.
ALTER TABLE question ADD COLUMN document_anchor_quote TEXT;
ALTER TABLE question ADD COLUMN document_marker_quote TEXT;
