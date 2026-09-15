import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "./errors.js";

// ----------------------------------------------------------------------------
// Themes: named palettes (one token set per light/dark mode plus optional
// custom CSS) that follow the user across devices. See migration 016. The
// app also ships built-in themes with "builtin:" ids that never hit this
// table; only the active-theme pointer can reference them.
// ----------------------------------------------------------------------------

export interface ThemeTokens {
  light: Record<string, string>;
  dark: Record<string, string>;
}

export interface ThemeRow {
  id: string;
  name: string;
  tokens: ThemeTokens;
  custom_css: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ThemeInput {
  id: string;
  name: string;
  tokens: ThemeTokens;
  custom_css?: string;
}

interface RawRow {
  id: string;
  name: string;
  tokens: string;
  custom_css: string;
  updated_at: string;
  deleted_at: string | null;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_CSS = 64 * 1024;

function parse(r: RawRow): ThemeRow {
  return { ...r, tokens: JSON.parse(r.tokens) as ThemeTokens };
}

function validate(input: ThemeInput): void {
  if (!ID_RE.test(input.id)) {
    throw new DomainError("invalid_theme_id", `Theme id "${input.id}" must be 1-64 lowercase letters, digits, "_" or "-".`);
  }
  if (input.id.startsWith("builtin")) {
    throw new DomainError("builtin_theme", "Built-in themes are read-only; duplicate one to edit it.");
  }
  if (!input.name || input.name.trim() === "") throw new DomainError("invalid_name", "A theme needs a name.");
  const t = input.tokens;
  if (!t || typeof t !== "object" || typeof t.light !== "object" || typeof t.dark !== "object") {
    throw new DomainError("invalid_tokens", "tokens must be { light: {...}, dark: {...} }.");
  }
  for (const mode of ["light", "dark"] as const) {
    for (const [k, v] of Object.entries(t[mode])) {
      if (!k.startsWith("--") || typeof v !== "string") {
        throw new DomainError("invalid_tokens", `tokens.${mode}.${k} must map a CSS custom property to a string.`);
      }
    }
  }
  if ((input.custom_css ?? "").length > MAX_CSS) {
    throw new DomainError("css_too_large", `custom_css is capped at ${MAX_CSS} characters.`);
  }
}

// Live themes only — tombstones are for sync, not for the app.
export function listThemes(db: DatabaseSync): ThemeRow[] {
  return (
    db.prepare("SELECT * FROM theme WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, id").all() as unknown as RawRow[]
  ).map(parse);
}

// Everything, tombstones included, for the pull protocol.
export function listThemesForSync(db: DatabaseSync): ThemeRow[] {
  return (db.prepare("SELECT * FROM theme ORDER BY id").all() as unknown as RawRow[]).map(parse);
}

export function getActiveThemeId(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT active_theme_id FROM theme_setting WHERE id = 1").get() as
    | { active_theme_id: string | null }
    | undefined;
  return row?.active_theme_id ?? null;
}

export function saveTheme(db: DatabaseSync, input: ThemeInput): ThemeRow {
  validate(input);
  db.prepare(
    `INSERT INTO theme (id, name, tokens, custom_css, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, datetime('now'), NULL)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name, tokens = excluded.tokens, custom_css = excluded.custom_css,
       updated_at = datetime('now'), deleted_at = NULL`
  ).run(input.id, input.name.trim(), JSON.stringify(input.tokens), input.custom_css ?? "");
  return parse(db.prepare("SELECT * FROM theme WHERE id = ?").get(input.id) as unknown as RawRow);
}

export function deleteTheme(db: DatabaseSync, id: string): { id: string } {
  const row = db.prepare("SELECT id, deleted_at FROM theme WHERE id = ?").get(id) as
    | { id: string; deleted_at: string | null }
    | undefined;
  if (!row || row.deleted_at) throw new DomainError("not_found", `Theme "${id}" does not exist.`);
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE theme SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
    // Deleting the active theme drops back to "mode only".
    db.prepare(
      "UPDATE theme_setting SET active_theme_id = NULL, updated_at = datetime('now') WHERE id = 1 AND active_theme_id = ?"
    ).run(id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { id };
}

export function setActiveTheme(db: DatabaseSync, id: string | null): { active_theme_id: string | null } {
  if (id !== null && !id.startsWith("builtin:")) {
    const row = db.prepare("SELECT id FROM theme WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!row) throw new DomainError("not_found", `Theme "${id}" does not exist.`);
  }
  db.prepare("UPDATE theme_setting SET active_theme_id = ?, updated_at = datetime('now') WHERE id = 1").run(id);
  return { active_theme_id: id };
}

// Pull-side apply: canonical's rows win whenever they are at least as new as
// ours (a local node never edits without canonical accepting first, so a
// strictly-newer local row only exists during the few seconds between a
// forwarded write and its echo). The active pointer is copied as-is.
export function applyThemesFromPull(
  db: DatabaseSync,
  themes: ThemeRow[],
  activeThemeId: string | null | undefined
): number {
  const upsert = db.prepare(
    `INSERT INTO theme (id, name, tokens, custom_css, updated_at, deleted_at)
     VALUES (@id, @name, @tokens, @custom_css, @updated_at, @deleted_at)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name, tokens = excluded.tokens, custom_css = excluded.custom_css,
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
     WHERE excluded.updated_at >= theme.updated_at`
  );
  let applied = 0;
  for (const t of themes) {
    const r = upsert.run({
      id: t.id,
      name: t.name,
      tokens: JSON.stringify(t.tokens),
      custom_css: t.custom_css ?? "",
      updated_at: t.updated_at,
      deleted_at: t.deleted_at ?? null,
    });
    applied += Number(r.changes);
  }
  if (activeThemeId !== undefined) {
    db.prepare("UPDATE theme_setting SET active_theme_id = ?, updated_at = datetime('now') WHERE id = 1").run(activeThemeId);
  }
  return applied;
}
