import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import {
  listThemes, listThemesForSync, saveTheme, deleteTheme, setActiveTheme, getActiveThemeId, applyThemesFromPull,
  patchTheme, getTheme, getLocation, setLocation,
} from "../src/domain/themes.js";
import { buildPullResponse, applyPullResponse } from "../src/domain/sync.js";
import { DomainError } from "../src/domain/errors.js";

const tokens = { light: { "--accent": "#123456" }, dark: { "--accent": "#abcdef" } };

describe("themes domain", () => {
  it("saves, lists, updates in place, and soft-deletes", () => {
    const db = openTestDb();
    const { theme: t } = saveTheme(db, { id: "ocean", name: "Ocean", tokens, custom_css: ".panel{}" });
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
    setActiveTheme(db, "builtin:paper");
    expect(getActiveThemeId(db)).toBe("builtin:paper");
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

describe("themes as manifests", () => {
  const manifest = { schema: 1 as const, id: "ocean", name: "Ocean", seeds: { light: { accent: "#123456" } }, dials: {}, fonts: {} };

  it("legacy input and manifest input store the same manifest; mirror columns follow", () => {
    const a = openTestDb();
    const b = openTestDb();
    const legacy = saveTheme(a, { id: "ocean", name: "Ocean", tokens: { light: { "--accent": "#123456" }, dark: {} } }).theme;
    const viaManifest = saveTheme(b, { manifest: legacy.manifest }).theme;
    expect(viaManifest.manifest).toEqual(legacy.manifest);
    expect(legacy.tokens.light["--accent"]).toBe("#123456");
  });

  it("an accent seed writes the legacy mirror tokens", () => {
    const db = openTestDb();
    const { theme, report } = saveTheme(db, { manifest });
    expect(report.ok).toBe(true);
    expect(theme.tokens.light["--accent"]).toBeTruthy();
    expect(theme.name).toBe("Ocean");
  });

  it("rejects an invalid manifest with the full report, and builtin ids before validating", () => {
    const db = openTestDb();
    try {
      saveTheme(db, { manifest: { ...manifest, dials: { contrast: 5 } } });
      expect.unreachable();
    } catch (e) {
      expect((e as DomainError).code).toBe("invalid_theme");
      expect(((e as DomainError).detail as { ok: boolean }).ok).toBe(false);
    }
    try {
      saveTheme(db, { manifest: { ...manifest, id: "builtin:osmosis", dials: { contrast: 5 } } });
      expect.unreachable();
    } catch (e) {
      expect((e as DomainError).code).toBe("builtin_theme");
    }
  });

  it("merge patch: adds a dial, null deletes, id cannot change", () => {
    const db = openTestDb();
    saveTheme(db, { manifest: { ...manifest, overrides: { light: { "color-accent": "#112233" } } } });
    const r = patchTheme(db, "ocean", { dials: { warmth: 0.8 }, overrides: { light: { "color-accent": null } }, id: "other", name: "Ocean 2" });
    expect(r.theme.id).toBe("ocean");
    expect(r.theme.name).toBe("Ocean 2");
    expect(r.theme.manifest.dials.warmth).toBe(0.8);
    expect(r.theme.manifest.overrides?.light?.["color-accent"]).toBeUndefined();
    expect(getTheme(db, "other")).toBeNull();
    expect(() => patchTheme(db, "nope", {})).toThrow(DomainError);
  });

  it("removed built-ins map to builtin:osmosis on write and read", () => {
    const db = openTestDb();
    expect(setActiveTheme(db, "builtin:plum").active_theme_id).toBe("builtin:osmosis");
    expect(getActiveThemeId(db)).toBe("builtin:osmosis");
    db.prepare("UPDATE theme_setting SET active_theme_id = 'builtin:slate' WHERE id = 1").run();
    expect(getActiveThemeId(db)).toBe("builtin:osmosis");
  });

  it("location round trip and validation", () => {
    const db = openTestDb();
    expect(getLocation(db)).toBeNull();
    expect(setLocation(db, { lat: 40.1, lon: -88.2, label: "Urbana" }).location).toEqual({ lat: 40.1, lon: -88.2, label: "Urbana" });
    expect(getLocation(db)).toEqual({ lat: 40.1, lon: -88.2, label: "Urbana" });
    for (const bad of [{ lat: 91, lon: 0 }, { lat: 0, lon: 181 }, { lat: NaN, lon: 0 }]) {
      expect(() => setLocation(db, bad)).toThrow(/location/);
    }
    setLocation(db, null);
    expect(getLocation(db)).toBeNull();
  });

  it("pull applies manifest rows as-is, legacy-only rows via migration, and the location", () => {
    const canonical = openTestDb();
    const m = saveTheme(canonical, { manifest }).theme;
    const local = openTestDb();
    const legacyOnly = { id: "old", name: "Old", tokens, custom_css: ".x{}", updated_at: "2020-01-01 00:00:00", deleted_at: null };
    const n = applyThemesFromPull(local, [m, legacyOnly], "ocean", { lat: 1, lon: 2 });
    expect(n).toBe(2);
    expect(getTheme(local, "ocean")?.manifest).toEqual(m.manifest);
    expect(getTheme(local, "ocean")?.tokens).toEqual(m.tokens);
    expect(getTheme(local, "old")?.manifest.css).toContain(".x{}");
    expect(getLocation(local)).toEqual({ lat: 1, lon: 2 });
    expect(getActiveThemeId(local)).toBe("ocean");
    applyThemesFromPull(local, [], undefined, undefined);
    expect(getLocation(local)).toEqual({ lat: 1, lon: 2 });
  });
});
