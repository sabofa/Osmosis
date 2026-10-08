-- Themes become manifests (theme-core). The legacy tokens/custom_css columns
-- stay as a derived mirror so older readers keep working.
ALTER TABLE theme ADD COLUMN manifest TEXT;
ALTER TABLE theme ADD COLUMN schema_version INTEGER;
ALTER TABLE theme_setting ADD COLUMN location TEXT;
