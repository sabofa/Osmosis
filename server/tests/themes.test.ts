import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import {
  listThemes, listThemesForSync, saveTheme, deleteTheme, setActiveTheme, getActiveThemeId, applyThemesFromPull,
} from "../src/domain/themes.js";
import { buildPullResponse, applyPullResponse } from "../src/domain/sync.js";
import { DomainError } from "../src/domain/errors.js";

const tokens = { light: { "--accent": "#123456" }, dark: { "--accent": "#abcdef" } };

describe("themes domain", () => {
  it("saves, lists, updates in place, and soft-deletes", () => {
    const db = openTestDb();
    const t = saveTheme(db, { id: "ocean", name: "Ocean", tokens, custom_css: ".panel{}" });
    expect(t.custom_css).toBe(".panel{}");
    expect(listThemes(db).map((x) => x.id)).toEqual(["ocean"]);

    saveTheme(db, { id: "ocean", name: "Ocean 2", tokens });
    expect(listThemes(db)[0].name).toBe("Ocean 2");

    deleteTheme(db, "ocean");
    expect(listThemes(db)).toEqual([]);
    expect(listThemesForSync(db)[0].deleted_at).not.toBeNull();
    expect(() => deleteTheme(db, "ocean")).toThrow(DomainError);
  });

  it("validates ids, names, tokens, and refuses builtin ids", () => {
    const db = openTestDb();
    expect(() => saveTheme(db, { id: "Bad Id", name: "x", tokens })).toThrow(/invalid_theme_id|must be/);
    expect(() => saveTheme(db, { id: "builtin:paper", name: "x", tokens })).toThrow(DomainError);
    expect(() => saveTheme(db, { id: "a", name: " ", tokens })).toThrow(DomainError);
    expect(() => saveTheme(db, { id: "a", name: "x", tokens: { light: { accent: "#fff" }, dark: {} } })).toThrow(DomainError);
  });

  it("active theme: custom must exist, builtin ids are accepted, deleting the active one clears it", () => {
    const db = openTestDb();
    expect(getActiveThemeId(db)).toBeNull();
    expect(() => setActiveTheme(db, "nope")).toThrow(DomainError);
    setActiveTheme(db, "builtin:slate");
    expect(getActiveThemeId(db)).toBe("builtin:slate");
    saveTheme(db, { id: "mine", name: "Mine", tokens });
    setActiveTheme(db, "mine");
    deleteTheme(db, "mine");
    expect(getActiveThemeId(db)).toBeNull();
  });
});

describe("themes sync", () => {
  it("pull carries themes (tombstones included) and the active id; apply converges a local node", () => {
    const canonical = openTestDb();
    saveTheme(canonical, { id: "ocean", name: "Ocean", tokens, custom_css: "body{}" });
    saveTheme(canonical, { id: "gone", name: "Gone", tokens });
    deleteTheme(canonical, "gone");
    setActiveTheme(canonical, "ocean");

    const local = openTestDb();
    saveTheme(local, { id: "stale", name: "Stale local-only", tokens });
    const pull = buildPullResponse(canonical, { node_id: "l", protocol_version: 1, slices: [], since: null, include_grades_for_node: false });
    expect(pull.themes?.map((t) => t.id).sort()).toEqual(["gone", "ocean"]);
    expect(pull.active_theme_id).toBe("ocean");

    applyPullResponse(local, pull);
    const ids = listThemes(local).map((t) => t.id).sort();
    expect(ids).toEqual(["ocean", "stale"]); // "gone" arrived as a tombstone
    expect(listThemes(local).find((t) => t.id === "ocean")?.custom_css).toBe("body{}");
    expect(getActiveThemeId(local)).toBe("ocean");
  });

  it("apply is newer-wins and idempotent", () => {
    const db = openTestDb();
    saveTheme(db, { id: "x", name: "Local newer", tokens });
    const older = { id: "x", name: "Older", tokens, custom_css: "", updated_at: "2020-01-01 00:00:00", deleted_at: null };
    expect(applyThemesFromPull(db, [older], undefined)).toBe(0);
    expect(listThemes(db)[0].name).toBe("Local newer");
    const newer = { ...older, name: "Newer", updated_at: "2999-01-01 00:00:00" };
    expect(applyThemesFromPull(db, [newer], undefined)).toBe(1);
    expect(applyThemesFromPull(db, [newer], undefined)).toBe(1); // same row again: harmless
    expect(listThemes(db)[0].name).toBe("Newer");
  });
});
