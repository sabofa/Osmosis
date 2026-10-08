import { describe, it, expect, vi } from "vitest";
import { openTestDb } from "./helpers.js";
import {
  listThemes, listThemesForSync, saveTheme, deleteTheme, setActiveTheme, getActiveThemeId, applyThemesFromPull,
  patchTheme, getTheme, clearActiveIf, getLocation, setLocation,
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
    expect(() => saveTheme(db, { id: "builtin:forest", name: "x", tokens })).toThrow(DomainError);
    expect(() => saveTheme(db, { id: "a", name: " ", tokens })).toThrow(DomainError);
    expect(() => saveTheme(db, { id: "a", name: "x", tokens: { light: { accent: "#fff" }, dark: {} } })).toThrow(DomainError);
  });

  it("active theme: custom must exist, builtin ids are accepted, deleting the active one clears it", () => {
    const db = openTestDb();
    expect(getActiveThemeId(db)).toBeNull();
    expect(() => setActiveTheme(db, "nope")).toThrow(DomainError);
    setActiveTheme(db, "builtin:forest");
    expect(getActiveThemeId(db)).toBe("builtin:forest");
    saveTheme(db, { id: "mine", name: "Mine", tokens });
    setActiveTheme(db, "mine");
    deleteTheme(db, "mine");
    expect(getActiveThemeId(db)).toBeNull();
  });
});

describe("themes cleanup", () => {
  it("pull skips null/non-object rows and applies the good one", () => {
    const db = openTestDb();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = { id: "good", name: "Good", tokens, custom_css: "", updated_at: "2020-01-01 00:00:00", deleted_at: null };
    const n = applyThemesFromPull(db, [null, "x", good] as never, undefined);
    warn.mockRestore();
    expect(n).toBe(1);
    expect(listThemes(db).map((t) => t.id)).toEqual(["good"]);
  });

  it("deleting the active theme nulls the stored pointer; re-saving does not reactivate", () => {
    const db = openTestDb();
    saveTheme(db, { id: "old", name: "Old", tokens });
    setActiveTheme(db, "old");
    deleteTheme(db, "old");
    const raw = () => (db.prepare("SELECT active_theme_id FROM theme_setting WHERE id = 1").get() as { active_theme_id: string | null }).active_theme_id;
    expect(raw()).toBeNull();
    saveTheme(db, { id: "old", name: "Old", tokens });
    expect(getActiveThemeId(db)).toBeNull();
  });

  it("clearActiveIf nulls a stale pointer to a tombstoned theme", () => {
    const db = openTestDb();
    saveTheme(db, { id: "old", name: "Old", tokens });
    setActiveTheme(db, "old");
    db.prepare("UPDATE theme SET deleted_at = datetime('now') WHERE id = 'old'").run();
    clearActiveIf(db, "old");
    saveTheme(db, { id: "old", name: "Old", tokens });
    expect(getActiveThemeId(db)).toBeNull();
  });

  it("a re-corrupted row logs again (warn keyed on id + payload)", () => {
    const db = openTestDb();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    saveTheme(db, { id: "recorrupt", name: "R", tokens });
    db.prepare("UPDATE theme SET manifest = ? WHERE id = 'recorrupt'").run("{not json one");
    listThemes(db); listThemes(db);
    db.prepare("UPDATE theme SET manifest = ? WHERE id = 'recorrupt'").run("{not json two");
    listThemes(db);
    const n = warn.mock.calls.filter((c) => String(c[0]).includes("recorrupt")).length;
    warn.mockRestore();
    expect(n).toBe(2);
  });

  it("setActiveTheme rejects unknown builtins but maps removed ones to osmosis", () => {
    const db = openTestDb();
    expect(() => setActiveTheme(db, "builtin:nope")).toThrow(/unknown_builtin|builtin/);
    try { setActiveTheme(db, "builtin:nope"); } catch (e) { expect((e as DomainError).code).toBe("unknown_builtin"); }
    expect(setActiveTheme(db, "builtin:slate").active_theme_id).toBe("builtin:osmosis");
    expect(setActiveTheme(db, "builtin:plum").active_theme_id).toBe("builtin:osmosis");
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

describe("themes survive corrupt rows", () => {
  const mk = (id: string) => ({ schema: 1 as const, id, name: id, seeds: { light: { accent: "#123456" } }, dials: {}, fonts: {} });

  it("a corrupt manifest is skipped by list/sync/get without throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = openTestDb();
    saveTheme(db, { manifest: mk("good") });
    saveTheme(db, { manifest: mk("bad") });
    db.prepare("UPDATE theme SET manifest = '{oops' WHERE id = 'bad'").run();
    expect(listThemes(db).map((t) => t.id)).toEqual(["good"]);
    expect(listThemesForSync(db).map((t) => t.id)).toEqual(["good"]);
    expect(getTheme(db, "bad")).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a corrupt mirror is recomputed from the manifest", () => {
    const db = openTestDb();
    const good = saveTheme(db, { manifest: mk("mir") }).theme;
    db.prepare("UPDATE theme SET tokens = 'nope' WHERE id = 'mir'").run();
    expect(listThemes(db)[0].tokens).toEqual(good.tokens);
    expect(listThemesForSync(db)[0].tokens).toEqual(good.tokens);
    expect(getTheme(db, "mir")?.tokens).toEqual(good.tokens);
  });

  it("a pull with one poisoned row still applies the good ones", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const src = openTestDb();
    const a = saveTheme(src, { manifest: mk("a") }).theme;
    const b = saveTheme(src, { manifest: mk("b") }).theme;
    const local = openTestDb();
    const stamp = { updated_at: "2999-01-01 00:00:00", deleted_at: null };
    const bad1 = { id: "p1", name: "p1", manifest: { id: "p1", name: "p1" }, ...stamp } as never;
    const bad2 = { id: "p2", name: "p2", manifest: "garbage", ...stamp } as never;
    expect(applyThemesFromPull(local, [a, bad1, bad2, b], undefined)).toBe(2);
    expect(listThemes(local).map((t) => t.id)).toEqual(["a", "b"]);
    warn.mockRestore();
  });

  it("getActiveThemeId is null for a tombstoned or missing active theme; builtins still return", () => {
    const db = openTestDb();
    saveTheme(db, { manifest: mk("mine") });
    setActiveTheme(db, "mine");
    db.prepare("UPDATE theme SET deleted_at = datetime('now') WHERE id = 'mine'").run();
    expect(getActiveThemeId(db)).toBeNull();
    db.prepare("UPDATE theme_setting SET active_theme_id = 'ghost' WHERE id = 1").run();
    expect(getActiveThemeId(db)).toBeNull();
    setActiveTheme(db, "builtin:forest");
    expect(getActiveThemeId(db)).toBe("builtin:forest");
  });
});

describe("reserved theme ids", () => {
  const manifest = (id: string) => ({
    id, name: "X", schema: 1 as const,
    seeds: { light: { accent: "#2a5db0", canvas: "#f4f1ea", ink: "#1b1b1b" } }, dials: {}, fonts: {},
  });

  it("saveTheme and patchTheme reject ids that collide with static routes", () => {
    const db = openTestDb();
    for (const id of ["active", "location", "validate"]) {
      expect(() => saveTheme(db, { manifest: manifest(id) } as never)).toThrow(/invalid_theme_id|reserved/i);
      try { saveTheme(db, { id, name: "X", tokens }); expect.unreachable(); }
      catch (e) { expect((e as DomainError).code).toBe("invalid_theme_id"); }
      try { patchTheme(db, id, { name: "Y" }); expect.unreachable(); }
      catch (e) { expect((e as DomainError).code).toBe("invalid_theme_id"); }
    }
    expect(listThemes(db)).toEqual([]);
  });

  it("the save_theme MCP tool returns an error for id 'active'", async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { registerTools } = await import("../src/mcp/tools.js");
    const db = openTestDb();
    const server = new McpServer({ name: "t", version: "1.0.0" });
    registerTools(server, db, "/tmp/osmosis-test-uploads", "test-node");
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "1.0.0" });
    await Promise.all([client.connect(ct), server.connect(st)]);
    const r = await client.callTool({ name: "save_theme", arguments: { manifest: manifest("active") } });
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect(listThemes(db)).toEqual([]);
  });

  it("PUT /api/themes/active stays the active-theme route", async () => {
    const { buildApp } = await import("../src/http/app.js");
    const { bootstrapNode } = await import("../src/node.js");
    const { createSyncRuntime } = await import("../src/sync/client.js");
    const db = openTestDb();
    const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:", remoteUrl: null,
                  uploadsDir: "/tmp", mcpAuthToken: "t", webDistDir: null };
    const app = buildApp({ db, env, node: bootstrapNode(db, env), runtime: createSyncRuntime(), logger: false });
    await app.ready();
    const res = await app.inject({ method: "PUT", url: "/api/themes/active", payload: { id: "builtin:forest" } });
    expect(res.json().active_theme_id).toBe("builtin:forest");
  });
});
