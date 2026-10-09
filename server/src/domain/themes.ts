import type { DatabaseSync } from "node:sqlite";
import {
  migrate as migrateTheme, builtinById, normalise, resolve, validate, toLegacyTokens, isBuiltinId, REMOVED_BUILTINS,
  DEFAULT_THEME_ID, RESERVED_THEME_IDS, type ThemeManifest, type Report, type Location,
} from "theme-core";
import { DomainError } from "./errors.js";

// ----------------------------------------------------------------------------
// Themes are stored as manifests (theme-core, migration 024). The legacy
// tokens/custom_css columns are a derived mirror so older readers keep
// working. Built-in themes ("builtin:*") never hit this table; only the
// active-theme pointer can reference them.
// ----------------------------------------------------------------------------

export interface ThemeTokens {
  light: Record<string, string>;
  dark: Record<string, string>;
}

export interface ThemeRow {
  id: string;
  name: string;
  manifest: ThemeManifest;
  layer: "workspace" | "ambience" | null;
  tokens: ThemeTokens;
  custom_css: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SaveResult {
  theme: ThemeRow;
  report: Report;
}

export type ThemeSaveInput =
  | { manifest: ThemeManifest }
  | { id: string; name: string; tokens: ThemeTokens; custom_css?: string };

export interface PulledTheme {
  id: string;
  name: string;
  manifest?: ThemeManifest;
  tokens?: ThemeTokens;
  custom_css?: string;
  updated_at: string;
  deleted_at: string | null;
}

interface RawRow {
  id: string;
  name: string;
  manifest: string | null;
  tokens: string;
  custom_css: string;
  updated_at: string;
  deleted_at: string | null;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const BUILTIN_MSG = "Built-in themes are read-only; duplicate one to edit it.";

const warned = new Set<string>();
function warnOnce(id: string, why: string, payload = ""): void {
  const key = `${id}:${payload.slice(0, 40)}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`theme "${id}" skipped: ${why}`);
}

// Never throws: a row whose manifest cannot be parsed is skipped (null); a bad
// legacy mirror is recomputed from the manifest.
function toRow(r: RawRow, manifest: ThemeManifest): ThemeRow | null {
  let tokens: ThemeTokens;
  try {
    tokens = JSON.parse(r.tokens) as ThemeTokens;
    if (!tokens || typeof tokens !== "object") throw new Error("mirror is not an object");
  } catch {
    try {
      tokens = toLegacyTokens(resolve(manifest));
    } catch (err) {
      warnOnce(r.id, (err as Error).message, r.manifest ?? "");
      return null;
    }
  }
  return {
    id: r.id,
    name: r.name,
    manifest,
    layer: manifest.layer ?? null,
    tokens,
    custom_css: r.custom_css ?? "",
    updated_at: r.updated_at,
    deleted_at: r.deleted_at,
  };
}

function rowFromRaw(r: RawRow): ThemeRow | null {
  let manifest: ThemeManifest | null = null;
  if (r.manifest) {
    try {
      const parsed = JSON.parse(r.manifest) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) manifest = parsed as ThemeManifest;
    } catch {
      // fall through
    }
  }
  if (!manifest) {
    warnOnce(r.id, "manifest cannot be parsed", r.manifest ?? "");
    return null;
  }
  return toRow(r, manifest);
}

function mirror(m: ThemeManifest): { tokens: string; custom_css: string } {
  return { tokens: JSON.stringify(toLegacyTokens(resolve(m))), custom_css: m.css ?? "" };
}

function mapRemoved(id: string | null): string | null {
  return id !== null && (REMOVED_BUILTINS as readonly string[]).includes(id) ? DEFAULT_THEME_ID : id;
}

// Live themes only — tombstones are for sync, not for the app. Rows whose
// legacy conversion failed (manifest NULL) or whose manifest is corrupt are omitted.
export function listThemes(db: DatabaseSync): ThemeRow[] {
  const out: ThemeRow[] = [];
  for (const r of db
    .prepare("SELECT * FROM theme WHERE deleted_at IS NULL AND manifest IS NOT NULL ORDER BY name COLLATE NOCASE, id")
    .all() as unknown as RawRow[]) {
    const row = rowFromRaw(r);
    if (row) out.push(row);
  }
  return out;
}

// Everything, tombstones included, for the pull protocol.
export function listThemesForSync(db: DatabaseSync): ThemeRow[] {
  const out: ThemeRow[] = [];
  for (const r of db.prepare("SELECT * FROM theme ORDER BY id").all() as unknown as RawRow[]) {
    if (r.manifest) {
      const row = rowFromRaw(r);
      if (row) out.push(row);
      continue;
    }
    try {
      const row = toRow(r, migrateTheme({ id: r.id, name: r.name, tokens: JSON.parse(r.tokens), custom_css: r.custom_css }));
      if (row) out.push(row);
    } catch {
      // unconvertible legacy row: skip
    }
  }
  return out;
}

export function getTheme(db: DatabaseSync, id: string): ThemeRow | null {
  const r = db.prepare("SELECT * FROM theme WHERE id = ?").get(id) as unknown as RawRow | undefined;
  if (!r || !r.manifest) return null;
  return rowFromRaw(r);
}

export function getActiveThemeId(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT active_theme_id FROM theme_setting WHERE id = 1").get() as
    | { active_theme_id: string | null }
    | undefined;
  const id = mapRemoved(row?.active_theme_id ?? null);
  if (id === null) return null;
  if (isBuiltinId(id)) return targetLayer(db, id) === "workspace" ? null : id;
  const live = db.prepare("SELECT 1 AS x FROM theme WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!live) return null;
  return targetLayer(db, id) === "workspace" ? null : id;
}

export function getActiveWorkspaceThemeId(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT active_workspace_theme_id FROM theme_setting WHERE id = 1").get() as
    | { active_workspace_theme_id: string | null }
    | undefined;
  const id = row?.active_workspace_theme_id ?? null;
  if (id === null) return null;
  if (isBuiltinId(id)) return builtinById(id) && targetLayer(db, id) !== "ambience" ? id : null;
  const live = db.prepare("SELECT 1 AS x FROM theme WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!live) return null;
  return targetLayer(db, id) === "ambience" ? null : id;
}

function fromLegacy(input: { id: string; name: string; tokens: ThemeTokens; custom_css?: string }): ThemeManifest {
  const t = input.tokens;
  if (!input.name || input.name.trim() === "") throw new DomainError("invalid_name", "A theme needs a name.");
  if (!t || typeof t !== "object" || !t.light || !t.dark || typeof t.light !== "object" || typeof t.dark !== "object") {
    throw new DomainError("invalid_tokens", "tokens must be { light: {...}, dark: {...} }.");
  }
  for (const mode of ["light", "dark"] as const) {
    for (const [k, v] of Object.entries(t[mode])) {
      if (!k.startsWith("--") || typeof v !== "string") {
        throw new DomainError("invalid_tokens", `tokens.${mode}.${k} must map a CSS custom property to a string.`);
      }
    }
  }
  return migrateTheme({ id: input.id, name: input.name.trim(), tokens: t, custom_css: input.custom_css ?? "" });
}

function persist(db: DatabaseSync, manifest: ThemeManifest): SaveResult {
  const report = validate(manifest);
  if (!report.ok) {
    throw new DomainError("invalid_theme", report.errors[0]?.message ?? "Invalid theme.", report);
  }
  const m = mirror(manifest);
  db.prepare(
    `INSERT INTO theme (id, name, tokens, custom_css, manifest, schema_version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, 1, datetime('now'), NULL)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name, tokens = excluded.tokens, custom_css = excluded.custom_css,
       manifest = excluded.manifest, schema_version = 1,
       updated_at = datetime('now'), deleted_at = NULL`
  ).run(manifest.id, manifest.name, m.tokens, m.custom_css, JSON.stringify(manifest));
  // A layer change must not leave the theme in a slot its new layer can't fill
  // (full themes keep both).
  if (manifest.layer === "ambience") {
    db.prepare("UPDATE theme_setting SET active_workspace_theme_id = NULL, updated_at = datetime('now') WHERE id = 1 AND active_workspace_theme_id = ?").run(manifest.id);
  } else if (manifest.layer === "workspace") {
    db.prepare("UPDATE theme_setting SET active_theme_id = NULL, updated_at = datetime('now') WHERE id = 1 AND active_theme_id = ?").run(manifest.id);
  }
  return { theme: getTheme(db, manifest.id)!, report };
}

function assertNotReserved(id: string): void {
  if ((RESERVED_THEME_IDS as readonly string[]).includes(id)) {
    throw new DomainError("invalid_theme_id", `Theme id "${id}" is reserved (it collides with a theme route).`);
  }
}

export function saveTheme(db: DatabaseSync, input: ThemeSaveInput): SaveResult {
  const id = "manifest" in input ? input.manifest?.id : input.id;
  if (typeof id === "string" && isBuiltinId(id)) throw new DomainError("builtin_theme", BUILTIN_MSG);
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new DomainError("invalid_theme_id", `Theme id "${String(id)}" must be 1-64 lowercase letters, digits, "_" or "-".`);
  }
  assertNotReserved(id);
  let manifest: ThemeManifest;
  try {
    manifest = "manifest" in input ? migrateTheme(normalise(input.manifest)) : fromLegacy(input);
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw new DomainError("invalid_theme", (err as Error).message);
  }
  return persist(db, manifest);
}

function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const base: Record<string, unknown> =
    target !== null && typeof target === "object" && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === null) delete base[k];
    else base[k] = mergePatch(base[k], v);
  }
  return base;
}

// RFC 7386 merge patch onto the stored manifest, then the same validation as a save.
export function patchTheme(db: DatabaseSync, id: string, patch: unknown): SaveResult {
  if (isBuiltinId(id)) throw new DomainError("builtin_theme", BUILTIN_MSG);
  assertNotReserved(id);
  const cur = getTheme(db, id);
  if (!cur || cur.deleted_at) throw new DomainError("not_found", `Theme "${id}" does not exist.`);
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    throw new DomainError("invalid_theme", "A theme patch must be an object.");
  }
  const merged = mergePatch(cur.manifest, patch) as Record<string, unknown>;
  merged.id = cur.id;
  merged.schema = 1;
  let manifest: ThemeManifest;
  try {
    manifest = migrateTheme(normalise(merged as unknown as ThemeManifest));
  } catch (err) {
    throw new DomainError("invalid_theme", (err as Error).message);
  }
  return persist(db, manifest);
}

// The layer a patch_theme would leave the theme with (so callers can validate a
// target slot before persisting).
export function patchedLayer(db: DatabaseSync, id: string, patch: unknown): "workspace" | "ambience" | null {
  const cur = getTheme(db, id);
  if (!cur || cur.deleted_at) throw new DomainError("not_found", `Theme "${id}" does not exist.`);
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    throw new DomainError("invalid_theme", "A theme patch must be an object.");
  }
  const l = (mergePatch(cur.manifest, patch) as { layer?: unknown }).layer;
  return l === "workspace" || l === "ambience" ? l : null;
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
    clearActiveIf(db, id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { id };
}

// Nulls the STORED pointer when it names `id` (getActiveThemeId hides tombstones,
// so it cannot be used to detect this).
export function clearActiveIf(db: DatabaseSync, id: string): void {
  db.prepare(
    "UPDATE theme_setting SET active_theme_id = NULL, updated_at = datetime('now') WHERE id = 1 AND active_theme_id = ?"
  ).run(id);
  db.prepare(
    "UPDATE theme_setting SET active_workspace_theme_id = NULL, updated_at = datetime('now') WHERE id = 1 AND active_workspace_theme_id = ?"
  ).run(id);
}

// Layer of a pointer target: builtins from theme-core, custom from the stored manifest.
function targetLayer(db: DatabaseSync, id: string): "workspace" | "ambience" | null {
  if (id.startsWith("builtin:")) return builtinById(id)?.layer ?? null;
  return getTheme(db, id)?.layer ?? null;
}

export function setActiveWorkspaceTheme(db: DatabaseSync, id: string | null): { active_workspace_theme_id: string | null } {
  if (id !== null) {
    if (id.startsWith("builtin:")) {
      if (!builtinById(id)) throw new DomainError("unknown_builtin", `Unknown built-in theme "${id}".`);
    } else {
      const row = db.prepare("SELECT id FROM theme WHERE id = ? AND deleted_at IS NULL").get(id);
      if (!row) throw new DomainError("not_found", `Theme "${id}" does not exist.`);
    }
    if (targetLayer(db, id) === "ambience") {
      throw new DomainError("wrong_layer", "This is an ambience theme; pick a workspace or full theme for the workspace slot.");
    }
  }
  db.prepare("UPDATE theme_setting SET active_workspace_theme_id = ?, updated_at = datetime('now') WHERE id = 1").run(id);
  return { active_workspace_theme_id: id };
}

export function setActiveTheme(db: DatabaseSync, id: string | null): { active_theme_id: string | null } {
  const stored = mapRemoved(id);
  if (stored !== null && stored.startsWith("builtin:") && !builtinById(stored)) {
    throw new DomainError("unknown_builtin", `Unknown built-in theme "${stored}".`);
  }
  if (stored !== null && !stored.startsWith("builtin:")) {
    const row = db.prepare("SELECT id FROM theme WHERE id = ? AND deleted_at IS NULL").get(stored);
    if (!row) throw new DomainError("not_found", `Theme "${stored}" does not exist.`);
  }
  if (stored !== null && targetLayer(db, stored) === "workspace") {
    throw new DomainError("wrong_layer", "This is a workspace theme; pick an ambience or full theme for the ambience slot.");
  }
  db.prepare("UPDATE theme_setting SET active_theme_id = ?, updated_at = datetime('now') WHERE id = 1").run(stored);
  return { active_theme_id: stored };
}

export function getLocation(db: DatabaseSync): Location | null {
  const row = db.prepare("SELECT location FROM theme_setting WHERE id = 1").get() as { location: string | null } | undefined;
  if (!row?.location) return null;
  try {
    return JSON.parse(row.location) as Location;
  } catch {
    return null;
  }
}

export function setLocation(db: DatabaseSync, loc: Location | null): { location: Location | null } {
  let stored: Location | null = null;
  if (loc !== null) {
    const ok =
      typeof loc === "object" &&
      typeof loc.lat === "number" && Number.isFinite(loc.lat) && loc.lat >= -90 && loc.lat <= 90 &&
      typeof loc.lon === "number" && Number.isFinite(loc.lon) && loc.lon >= -180 && loc.lon <= 180 &&
      (loc.label === undefined || typeof loc.label === "string");
    if (!ok) throw new DomainError("invalid_location", "location needs a finite lat in -90..90 and lon in -180..180.");
    stored = loc.label === undefined ? { lat: loc.lat, lon: loc.lon } : { lat: loc.lat, lon: loc.lon, label: loc.label };
  }
  db.prepare("UPDATE theme_setting SET location = ?, updated_at = datetime('now') WHERE id = 1").run(
    stored === null ? null : JSON.stringify(stored)
  );
  return { location: stored };
}

// Pull-side apply: canonical's rows win whenever they are at least as new as
// ours (a local node never edits without canonical accepting first, so a
// strictly-newer local row only exists during the few seconds between a
// forwarded write and its echo). A pulled manifest is trusted as-is (no
// validate); a legacy-only row from an older canonical is migrated.
export function applyThemesFromPull(
  db: DatabaseSync,
  themes: PulledTheme[],
  active: string | null | undefined,
  location?: Location | null,
  activeWorkspace?: string | null
): number {
  const upsert = db.prepare(
    `INSERT INTO theme (id, name, tokens, custom_css, manifest, schema_version, updated_at, deleted_at)
     VALUES (@id, @name, @tokens, @custom_css, @manifest, 1, @updated_at, @deleted_at)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name, tokens = excluded.tokens, custom_css = excluded.custom_css,
       manifest = excluded.manifest, schema_version = 1,
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
     WHERE excluded.updated_at >= theme.updated_at`
  );
  let applied = 0;
  for (const t of themes) {
    if (t === null || typeof t !== "object" || Array.isArray(t)) {
      console.warn("pulled theme skipped: row is not an object");
      continue;
    }
    try {
      const manifest = t.manifest
        ? t.manifest
        : migrateTheme({ id: t.id, name: t.name, tokens: t.tokens, custom_css: t.custom_css ?? "" });
      if (!manifest || typeof manifest !== "object" || typeof manifest.name !== "string") {
        throw new Error("manifest has no name");
      }
      const checked = migrateTheme(manifest);
      const m = mirror(checked);
      const r = upsert.run({
        id: t.id,
        name: checked.name,
        tokens: m.tokens,
        custom_css: m.custom_css,
        manifest: JSON.stringify(checked),
        updated_at: t.updated_at,
        deleted_at: t.deleted_at ?? null,
      });
      applied += Number(r.changes);
    } catch (err) {
      console.warn(`pulled theme "${t?.id}" skipped: ${(err as Error).message}`);
    }
  }
  // Tombstones also clear the raw pointers, so a later re-save of the same id
  // does not silently reactivate it.
  for (const t of themes) {
    if (t && typeof t === "object" && t.deleted_at && typeof t.id === "string") {
      const live = db.prepare("SELECT deleted_at FROM theme WHERE id = ?").get(t.id) as { deleted_at: string | null } | undefined;
      if (live?.deleted_at) clearActiveIf(db, t.id);
    }
  }
  // Pointers are validated by layer AFTER the rows are applied (the target row
  // may arrive in this very pull); a known wrong-layer target is ignored.
  if (active !== undefined) {
    const id = mapRemoved(active);
    if (id === null || targetLayer(db, id) !== "workspace") {
      db.prepare("UPDATE theme_setting SET active_theme_id = ?, updated_at = datetime('now') WHERE id = 1").run(id);
    }
  }
  if (activeWorkspace !== undefined) {
    if (activeWorkspace === null || targetLayer(db, activeWorkspace) !== "ambience") {
      db.prepare("UPDATE theme_setting SET active_workspace_theme_id = ?, updated_at = datetime('now') WHERE id = 1").run(activeWorkspace);
    }
  }
  if (location !== undefined) {
    db.prepare("UPDATE theme_setting SET location = ?, updated_at = datetime('now') WHERE id = 1").run(
      location === null ? null : JSON.stringify(location)
    );
  }
  return applied;
}
