import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openTestDb } from "./helpers.js";
import { migrate } from "../src/db/migrate.js";
import {
  listThemes, listThemesForSync, saveTheme, deleteTheme, setActiveTheme, getActiveThemeId,
  getTheme, clearActiveIf, getActiveWorkspaceThemeId, setActiveWorkspaceTheme, applyThemesFromPull,
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

describe("layer changes and pointer integrity", () => {
  const rawAmb = (db: DatabaseSync) =>
    (db.prepare("SELECT active_theme_id AS a FROM theme_setting WHERE id = 1").get() as { a: string | null }).a;

  it("re-saving the active workspace theme as ambience drops the workspace pointer", () => {
    const db = openTestDb();
    saveTheme(db, { manifest: mk("t", "workspace") });
    setActiveWorkspaceTheme(db, "t");
    saveTheme(db, { manifest: mk("t", "ambience") });
    expect(raw(db)).toBeNull();
    expect(getActiveWorkspaceThemeId(db)).toBeNull();
  });

  it("re-saving the active ambience theme as workspace drops the ambience pointer", () => {
    const db = openTestDb();
    saveTheme(db, { manifest: mk("t", "ambience") });
    setActiveTheme(db, "t");
    saveTheme(db, { manifest: mk("t", "workspace") });
    expect(rawAmb(db)).toBeNull();
    expect(getActiveThemeId(db)).toBeNull();
  });

  it("a full theme keeps both pointers across a re-save", () => {
    const db = openTestDb();
    saveTheme(db, { manifest: mk("t") });
    setActiveTheme(db, "t");
    setActiveWorkspaceTheme(db, "t");
    saveTheme(db, { manifest: mk("t") });
    expect(getActiveThemeId(db)).toBe("t");
    expect(getActiveWorkspaceThemeId(db)).toBe("t");
  });

  it("getters hide a wrong-layer pointer even when stored raw", () => {
    const db = openTestDb();
    db.prepare("UPDATE theme_setting SET active_theme_id = 'builtin:ws-clean' WHERE id = 1").run();
    expect(getActiveThemeId(db)).toBeNull();
    db.prepare("UPDATE theme_setting SET active_workspace_theme_id = 'builtin:forest' WHERE id = 1").run();
    expect(getActiveWorkspaceThemeId(db)).toBe("builtin:forest");
    saveTheme(db, { manifest: mk("amb", "ambience") });
    db.prepare("UPDATE theme_setting SET active_workspace_theme_id = 'amb' WHERE id = 1").run();
    expect(getActiveWorkspaceThemeId(db)).toBeNull();
  });

  const row = (m: ReturnType<typeof mk>, deleted: string | null = null) =>
    ({ id: m.id, name: m.name, manifest: m, updated_at: "2999-01-01 00:00:00", deleted_at: deleted });

  it("a pull cannot put a wrong-layer theme in a slot", () => {
    const db = openTestDb();
    setActiveTheme(db, "builtin:forest");
    applyThemesFromPull(db, [row(mk("w", "workspace")), row(mk("a", "ambience"))], "w", undefined, "a");
    expect(getActiveThemeId(db)).toBe("builtin:forest");
    expect(getActiveWorkspaceThemeId(db)).toBeNull();
    applyThemesFromPull(db, [], "a", undefined, "w");
    expect(getActiveThemeId(db)).toBe("a");
    expect(getActiveWorkspaceThemeId(db)).toBe("w");
  });

  it("a pull may point at a theme whose row arrives in the same pull, and wrong layers there are rejected", () => {
    const db = openTestDb();
    applyThemesFromPull(db, [row(mk("a", "ambience"))], "a", undefined, null);
    expect(getActiveThemeId(db)).toBe("a");
  });

  it("a pulled tombstone clears raw pointers so a re-save does not reactivate", () => {
    const db = openTestDb();
    saveTheme(db, { manifest: mk("t") });
    setActiveTheme(db, "t");
    setActiveWorkspaceTheme(db, "t");
    applyThemesFromPull(db, [row(mk("t"), "2999-01-01 00:00:00")], undefined);
    expect(raw(db)).toBeNull();
    expect(rawAmb(db)).toBeNull();
    saveTheme(db, { manifest: mk("t") });
    expect(getActiveThemeId(db)).toBeNull();
    expect(getActiveWorkspaceThemeId(db)).toBeNull();
  });
});
