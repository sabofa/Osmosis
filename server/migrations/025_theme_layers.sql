-- Two-slot theming: a workspace-layer theme pointer beside the ambience one.
ALTER TABLE theme_setting ADD COLUMN active_workspace_theme_id TEXT;
