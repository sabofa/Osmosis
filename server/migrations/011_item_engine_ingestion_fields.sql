ALTER TABLE question ADD COLUMN claim_rung TEXT
  CHECK (claim_rung IN ('can_state','can_apply','can_discriminate','can_explain_why','can_transfer') OR claim_rung IS NULL);
ALTER TABLE question ADD COLUMN tests_error TEXT;
ALTER TABLE question ADD COLUMN provenance TEXT
  CHECK (provenance IN ('tutor_authored','textbook_sourced') OR provenance IS NULL);
ALTER TABLE question ADD COLUMN node_key TEXT;

CREATE INDEX question_node_key ON question(node_key) WHERE node_key IS NOT NULL;
