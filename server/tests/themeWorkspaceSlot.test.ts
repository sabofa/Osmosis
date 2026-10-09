import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openTestDb } from "./helpers.js";
import { migrate } from "../src/db/migrate.js";
import {
  listThemes, listThemesForSync, saveTheme, deleteTheme, setActiveTheme, getActiveThemeId,
  getTheme, clearActiveIf, getActiveWorkspaceThemeId, setActiveWorkspaceTheme,
} from "../src/domain/themes.js";
import { buildPullResponse, applyPullResponse } from "../src/domain/sync.js";
import { DomainError } from "../src/domain/errors.js";

const mk = (id: string, layer?: "workspace" | "ambience") => ({
  schema: 1 as const, id, name: id, seeds: { light: { accent: "#123456" } }, dials: {}, fonts: {}, ...(layer ? { layer } : {}),
});
const raw = (db: DatabaseSync) =>
  (db.prepare("SELECT active_workspace_theme_id AS a FROM theme_setting WHERE id = 1").get() as { a: string | null }).a;
const code = (fn: () => unknown): string | undefined => {
  try { fn(); } catch (e) { return (e as DomainError).code; }
  return undefined;
};
const req = { node_id: "l", protocol_version: 1, slices: [], since: null, include_grades_for_node: false };

describe("workspace theme slot", () => {
  it("sets, clears, and accepts builtin ws-clean", () => {
    const db = openTestDb();
    expect(getActiveWorkspaceThemeId(db)).toBeNull();
    expect(setActiveWorkspaceTheme(db, "builtin:ws-clean")).toEqual({ active_workspace_theme_id: "builtin:ws-clean" });
    expect(getActiveWorkspaceThemeId(db)).toBe("builtin:ws-clean");
    setActiveWorkspaceTheme(db, null);
    expect(getActiveWorkspaceThemeId(db)).toBeNull();
  });

  it("validates targets and layers on both slots", () => {
    const db = openTestDb();
    expect(code(() => setActiveWorkspaceTheme(db, "builtin:nope"))).toBe("unknown_builtin");
    expect(code(() => setActiveWorkspaceTheme(db, "missing"))).toBe("not_found");
    saveTheme(db, { manifest: mk("amb", "ambience") });
    saveTheme(db, { manifest: mk("wsx", "workspace") });
    saveTheme(db, { manifest: mk("full") });
    expect(code(() => setActiveWorkspaceTheme(db, "amb"))).toBe("wrong_layer");
    expect(code(() => setActiveTheme(db, "wsx"))).toBe("wrong_layer");
    expect(code(() => setActiveTheme(db, "builtin:ws-clean"))).toBe("wrong_layer");
    expect(setActiveWorkspaceTheme(db, "wsx").active_workspace_theme_id).toBe("wsx");
    expect(setActiveWorkspaceTheme(db, "full").active_workspace_theme_id).toBe("full");
    expect(setActiveTheme(db, "full").active_theme_id).toBe("full");
    expect(setActiveTheme(db, "amb").active_theme_id).toBe("amb");
  });

  it("deleting clears the raw column and a re-save does not reactivate", () => {
    const db = openTestDb();
    saveTheme(db, { manifest: mk("wsx", "workspace") });
    setActiveWorkspaceTheme(db, "wsx");
    deleteTheme(db, "wsx");
    expect(raw(db)).toBeNull();
    saveTheme(db, { manifest: mk("wsx", "workspace") });
    expect(getActiveWorkspaceThemeId(db)).toBeNull();
  });

  it("clearActiveIf clears both pointers", () => {
    const db = openTestDb();
    saveTheme(db, { manifest: mk("full") });
    setActiveTheme(db, "full");
    setActiveWorkspaceTheme(db, "full");
    clearActiveIf(db, "full");
    expect(getActiveThemeId(db)).toBeNull();
    expect(raw(db)).toBeNull();
  });

  it("read guards: tombstoned custom and unknown builtin read as null", () => {
    const db = openTestDb();
    saveTheme(db, { manifest: mk("wsx") });
    db.prepare("UPDATE theme_setting SET active_workspace_theme_id = 'wsx' WHERE id = 1").run();
    db.prepare("UPDATE theme SET deleted_at = datetime('now') WHERE id = 'wsx'").run();
    expect(getActiveWorkspaceThemeId(db)).toBeNull();
    db.prepare("UPDATE theme_setting SET active_workspace_theme_id = 'builtin:gone' WHERE id = 1").run();
    expect(getActiveWorkspaceThemeId(db)).toBeNull();
  });

  it("ThemeRow.layer is populated", () => {
    const db = openTestDb();
    saveTheme(db, { manifest: mk("wsx", "workspace") });
    saveTheme(db, { manifest: mk("full") });
    expect(getTheme(db, "wsx")?.layer).toBe("workspace");
    expect(getTheme(db, "full")?.layer).toBeNull();
    expect(Object.fromEntries(listThemes(db).map((t) => [t.id, t.layer]))).toEqual({ full: null, wsx: "workspace" });
    expect(listThemesForSync(db).find((t) => t.id === "wsx")?.layer).toBe("workspace");
  });

  it("sync round trip carries the workspace pointer; an old canonical leaves it alone", () => {
    const canonical = openTestDb();
    setActiveWorkspaceTheme(canonical, "builtin:ws-clean");
    const pull = buildPullResponse(canonical, req);
    expect(pull.active_workspace_theme_id).toBe("builtin:ws-clean");
    const local = openTestDb();
    applyPullResponse(local, pull);
    expect(getActiveWorkspaceThemeId(local)).toBe("builtin:ws-clean");
    const old = { ...pull } as Record<string, unknown>;
    delete old.active_workspace_theme_id;
    applyPullResponse(local, old as typeof pull);
    expect(getActiveWorkspaceThemeId(local)).toBe("builtin:ws-clean");
    applyPullResponse(local, { ...pull, active_workspace_theme_id: null });
    expect(raw(local)).toBeNull();
  });
});

describe("migration 025", () => {
  it("adds the column and is idempotent", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    const cols = (db.prepare("PRAGMA table_info(theme_setting)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("active_workspace_theme_id");
    expect(raw(db)).toBeNull();
    expect(migrate(db).applied).toEqual([]);
  });

  it("applies on a DB that is at 024", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    db.exec("ALTER TABLE theme_setting DROP COLUMN active_workspace_theme_id");
    db.prepare("DELETE FROM schema_migrations WHERE name = '025_theme_layers.sql'").run();
    expect(migrate(db).applied).toEqual(["025_theme_layers.sql"]);
    expect(raw(db)).toBeNull();
  });
});
