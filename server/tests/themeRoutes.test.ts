import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../src/db/migrate.js";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime, runSync } from "../src/sync/client.js";
import { openTestDb } from "./helpers.js";
import { listThemes, getActiveThemeId, getLocation } from "../src/domain/themes.js";
import { buildPullResponse, applyPullResponse } from "../src/domain/sync.js";

const tokens = { light: { "--accent": "#123456" }, dark: { "--accent": "#abcdef" } };

function openFileDb(dir: string, name: string): DatabaseSync {
  const db = new DatabaseSync(join(dir, name));
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

describe("theme routes on canonical", () => {
  it("PUT/GET/active/DELETE round-trip with domain errors mapped to 4xx", async () => {
    const db = openTestDb();
    const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:", remoteUrl: null,
                  uploadsDir: "/tmp", mcpAuthToken: "t", webDistDir: null };
    const app = buildApp({ db, env, node: bootstrapNode(db, env), runtime: createSyncRuntime(), logger: false });
    await app.ready();

    let res = await app.inject({ method: "PUT", url: "/api/themes/ocean", payload: { name: "Ocean", tokens, custom_css: "body{}" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().theme.custom_css).toBe("body{}");
    expect(res.json().report.ok).toBe(true);

    res = await app.inject({ method: "PUT", url: "/api/themes/active", payload: { id: "ocean" } });
    expect(res.json().active_theme_id).toBe("ocean");
    res = await app.inject({ method: "PUT", url: "/api/themes/active", payload: { id: "builtin:paper" } });
    expect(res.statusCode).toBe(200);
    res = await app.inject({ method: "PUT", url: "/api/themes/active", payload: { id: "missing" } });
    expect(res.statusCode).toBe(404);

    res = await app.inject({ method: "GET", url: "/api/themes" });
    expect(res.json().themes.map((t: { id: string }) => t.id)).toEqual(["ocean"]);
    expect(res.json().active_theme_id).toBe("builtin:paper");

    res = await app.inject({ method: "PUT", url: "/api/themes/builtin:x", payload: { name: "x", tokens } });
    expect(res.statusCode).toBe(400);

    res = await app.inject({ method: "DELETE", url: "/api/themes/ocean" });
    expect(res.statusCode).toBe(200);
    expect(res.json().tombstone.deleted_at).not.toBeNull();
    res = await app.inject({ method: "DELETE", url: "/api/themes/ocean" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  async function canonicalApp() {
    const db = openTestDb();
    const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:", remoteUrl: null,
                  uploadsDir: "/tmp", mcpAuthToken: "t", webDistDir: null };
    const app = buildApp({ db, env, node: bootstrapNode(db, env), runtime: createSyncRuntime(), logger: false });
    await app.ready();
    return { db, app };
  }
  const manifest = { schema: 1, id: "ocean", name: "Ocean", seeds: { light: { accent: "#123456" } }, dials: {}, fonts: {} };

  it("GET lists built-ins (not the removed ones), custom themes with mirror fields, and the location", async () => {
    const { app } = await canonicalApp();
    await app.inject({ method: "PUT", url: "/api/themes/ocean", payload: { manifest } });
    const body = (await app.inject({ method: "GET", url: "/api/themes" })).json();
    const ids = body.builtins.map((b: { id: string }) => b.id);
    for (const id of ["osmosis", "forest", "ocean", "ember"]) expect(ids.some((x: string) => x.endsWith(id))).toBe(true);
    expect(ids.some((x: string) => /slate|plum/.test(x))).toBe(false);
    expect(body.builtins[0].manifest.id).toBe(body.builtins[0].id);
    expect(body.themes[0]).toMatchObject({ id: "ocean", name: "Ocean" });
    expect(body.themes[0].manifest.id).toBe("ocean");
    expect(body.themes[0].tokens.light["--accent"]).toBeTruthy();
    expect(typeof body.themes[0].custom_css).toBe("string");
    expect(body.location).toBeNull();
    await app.close();
  });

  it("PUT manifest round-trips with a report; id mismatch and invalid dials are 400", async () => {
    const { app } = await canonicalApp();
    let res = await app.inject({ method: "PUT", url: "/api/themes/ocean", payload: { manifest } });
    expect(res.statusCode).toBe(200);
    expect(res.json().theme.manifest.id).toBe("ocean");
    expect(res.json().report).toMatchObject({ ok: true });

    res = await app.inject({ method: "PUT", url: "/api/themes/other", payload: { manifest } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("id_mismatch");

    res = await app.inject({ method: "PUT", url: "/api/themes/ocean", payload: { manifest: { ...manifest, dials: { contrast: 5 } } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().reason).toBe("invalid_theme");
    expect(res.json().detail.errors[0].path).toBeTruthy();
    await app.close();
  });

  it("PATCH merges and returns the report; a missing theme is 404", async () => {
    const { app } = await canonicalApp();
    await app.inject({ method: "PUT", url: "/api/themes/ocean", payload: { manifest } });
    let res = await app.inject({ method: "PATCH", url: "/api/themes/ocean", payload: { dials: { warmth: 0.7 }, name: "Ocean 2" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().theme.manifest.dials.warmth).toBe(0.7);
    expect(res.json().theme.name).toBe("Ocean 2");
    expect(res.json().report.ok).toBe(true);
    res = await app.inject({ method: "PATCH", url: "/api/themes/missing", payload: { name: "x" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("validate reports low contrast, stores nothing, and rejects a non-object body", async () => {
    const { db, app } = await canonicalApp();
    const bad = { ...manifest, overrides: { light: { "color-ink": "#fafafa", "color-canvas": "#ffffff" } } };
    const res = await app.inject({ method: "POST", url: "/api/themes/validate", payload: { manifest: bad } });
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings.length + res.json().errors.length).toBeGreaterThan(0);
    expect(listThemes(db)).toEqual([]);
    const ok = await app.inject({ method: "POST", url: "/api/themes/validate", payload: { manifest } });
    expect(ok.json().ok).toBe(true);
    const notObj = await app.inject({ method: "POST", url: "/api/themes/validate", payload: [1] });
    expect(notObj.statusCode).toBe(400);
    await app.close();
  });

  it("location PUT/GET round-trip and invalid is 400", async () => {
    const { db, app } = await canonicalApp();
    let res = await app.inject({ method: "PUT", url: "/api/themes/location", payload: { lat: 40.1, lon: -88.2, label: "Urbana" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().location).toEqual({ lat: 40.1, lon: -88.2, label: "Urbana" });
    expect((await app.inject({ method: "GET", url: "/api/themes" })).json().location).toEqual({ lat: 40.1, lon: -88.2, label: "Urbana" });
    res = await app.inject({ method: "PUT", url: "/api/themes/location", payload: { lat: 99, lon: 0 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().reason).toBe("invalid_location");
    res = await app.inject({ method: "PUT", url: "/api/themes/location", payload: "null", headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(200);
    expect(getLocation(db)).toBeNull();
    await app.close();
  });
});

describe("theme writes from a local node", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "osmosis-themes-")); });

  it("forward to canonical when online, mirror canonical's row locally, refuse offline, and pull converges", async () => {
    const canonicalDb = openFileDb(dir, "c.db");
    const cEnv = { role: "canonical" as const, label: "c", port: 0, dbPath: join(dir, "c.db"), remoteUrl: null,
                   uploadsDir: dir, mcpAuthToken: "t", webDistDir: null };
    const canonicalApp = buildApp({ db: canonicalDb, env: cEnv, node: bootstrapNode(canonicalDb, cEnv), runtime: createSyncRuntime(), logger: false });
    const canonicalUrl = await canonicalApp.listen({ port: 0, host: "127.0.0.1" });

    const localDb = openFileDb(dir, "l.db");
    const env = { role: "local" as const, label: "l", port: 0, dbPath: join(dir, "l.db"), remoteUrl: canonicalUrl,
                  uploadsDir: dir, mcpAuthToken: null, webDistDir: null };
    const runtime = createSyncRuntime();
    const ctx = { db: localDb, env, node: bootstrapNode(localDb, env), runtime };
    const app = buildApp({ ...ctx, logger: false });

    runtime.online = false;
    let res = await app.inject({ method: "PUT", url: "/api/themes/ocean", payload: { name: "Ocean", tokens } });
    expect(res.statusCode).toBe(503);
    expect(res.json().reason).toBe("theme_requires_connection");

    runtime.online = true;
    res = await app.inject({ method: "PUT", url: "/api/themes/ocean", payload: { name: "Ocean", tokens, custom_css: ".x{}" } });
    expect(res.statusCode).toBe(200);
    const canonicalRow = listThemes(canonicalDb)[0];
    const localRow = listThemes(localDb)[0];
    expect(canonicalRow.name).toBe("Ocean");
    expect(localRow.updated_at).toBe(canonicalRow.updated_at);

    res = await app.inject({ method: "PUT", url: "/api/themes/active", payload: { id: "ocean" } });
    expect(res.statusCode).toBe(200);
    expect(getActiveThemeId(canonicalDb)).toBe("ocean");
    expect(getActiveThemeId(localDb)).toBe("ocean");

    // A canonical-side error is passed through, not turned into 503.
    res = await app.inject({ method: "DELETE", url: "/api/themes/nope" });
    expect(res.statusCode).toBe(404);

    res = await app.inject({ method: "DELETE", url: "/api/themes/ocean" });
    expect(res.statusCode).toBe(200);
    expect(listThemes(localDb)).toEqual([]);
    expect(getActiveThemeId(localDb)).toBeNull();

    // Another device's change reaches this node on the next pull.
    await canonicalApp.inject({ method: "PUT", url: "/api/themes/forest", payload: { name: "Forest", tokens } });
    await canonicalApp.inject({ method: "PUT", url: "/api/themes/active", payload: { id: "forest" } });
    await runSync(ctx, runtime);
    expect(listThemes(localDb).map((t) => t.id)).toEqual(["forest"]);
    expect(getActiveThemeId(localDb)).toBe("forest");

    await app.close();
    await canonicalApp.close();
  });

  it("PATCH and location forward and mirror; offline refuses writes but validate still works", async () => {
    const canonicalDb = openFileDb(dir, "c2.db");
    const cEnv = { role: "canonical" as const, label: "c", port: 0, dbPath: join(dir, "c2.db"), remoteUrl: null,
                   uploadsDir: dir, mcpAuthToken: "t", webDistDir: null };
    const canonicalApp = buildApp({ db: canonicalDb, env: cEnv, node: bootstrapNode(canonicalDb, cEnv), runtime: createSyncRuntime(), logger: false });
    const canonicalUrl = await canonicalApp.listen({ port: 0, host: "127.0.0.1" });
    const localDb = openFileDb(dir, "l2.db");
    const env = { role: "local" as const, label: "l", port: 0, dbPath: join(dir, "l2.db"), remoteUrl: canonicalUrl,
                  uploadsDir: dir, mcpAuthToken: null, webDistDir: null };
    const runtime = createSyncRuntime();
    const ctx = { db: localDb, env, node: bootstrapNode(localDb, env), runtime };
    const app = buildApp({ ...ctx, logger: false });
    const manifest = { schema: 1, id: "ocean", name: "Ocean", seeds: { light: { accent: "#123456" } }, dials: {}, fonts: {} };

    runtime.online = true;
    let res = await app.inject({ method: "PUT", url: "/api/themes/ocean", payload: { manifest } });
    expect(res.statusCode).toBe(200);
    expect(listThemes(localDb)[0].manifest.id).toBe("ocean");
    res = await app.inject({ method: "PATCH", url: "/api/themes/ocean", payload: { dials: { warmth: 0.6 } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().report.ok).toBe(true);
    expect(listThemes(canonicalDb)[0].manifest.dials.warmth).toBe(0.6);
    expect(listThemes(localDb)[0].manifest.dials.warmth).toBe(0.6);
    res = await app.inject({ method: "PATCH", url: "/api/themes/nope", payload: { name: "x" } });
    expect(res.statusCode).toBe(404);
    res = await app.inject({ method: "PUT", url: "/api/themes/location", payload: { lat: 1, lon: 2 } });
    expect(res.statusCode).toBe(200);
    expect(getLocation(canonicalDb)).toEqual({ lat: 1, lon: 2 });
    expect(getLocation(localDb)).toEqual({ lat: 1, lon: 2 });

    // The pull carries manifests and the location to another local DB.
    const other = openFileDb(dir, "l3.db");
    const pull = buildPullResponse(canonicalDb, { node_id: "x", protocol_version: 1, slices: [], since: null, include_grades_for_node: false });
    applyPullResponse(other, pull);
    expect(listThemes(other)[0].manifest.dials.warmth).toBe(0.6);
    expect(getLocation(other)).toEqual({ lat: 1, lon: 2 });

    runtime.online = false;
    for (const [method, url, payload] of [
      ["PUT", "/api/themes/ocean", { manifest }],
      ["PATCH", "/api/themes/ocean", { name: "z" }],
      ["PUT", "/api/themes/location", { lat: 3, lon: 4 }],
    ] as const) {
      res = await app.inject({ method, url, payload });
      expect(res.statusCode).toBe(503);
      expect(res.json().reason).toBe("theme_requires_connection");
    }
    res = await app.inject({ method: "POST", url: "/api/themes/validate", payload: { manifest } });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    await app.close();
    await canonicalApp.close();
  });
});
