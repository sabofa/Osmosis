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
import { listThemes, getActiveThemeId } from "../src/domain/themes.js";

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
                  uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: null, webDistDir: null };
    const app = buildApp({ db, env, node: bootstrapNode(db, env), runtime: createSyncRuntime(), logger: false });
    await app.ready();

    let res = await app.inject({ method: "PUT", url: "/api/themes/ocean", payload: { name: "Ocean", tokens, custom_css: "body{}" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().custom_css).toBe("body{}");

    res = await app.inject({ method: "PUT", url: "/api/themes/active", payload: { id: "ocean" } });
    expect(res.json().active_theme_id).toBe("ocean");
    res = await app.inject({ method: "PUT", url: "/api/themes/active", payload: { id: "builtin:slate" } });
    expect(res.statusCode).toBe(200);
    res = await app.inject({ method: "PUT", url: "/api/themes/active", payload: { id: "missing" } });
    expect(res.statusCode).toBe(404);

    res = await app.inject({ method: "GET", url: "/api/themes" });
    expect(res.json().themes.map((t: { id: string }) => t.id)).toEqual(["ocean"]);
    expect(res.json().active_theme_id).toBe("builtin:slate");

    res = await app.inject({ method: "PUT", url: "/api/themes/builtin:x", payload: { name: "x", tokens } });
    expect(res.statusCode).toBe(400);

    res = await app.inject({ method: "DELETE", url: "/api/themes/ocean" });
    expect(res.statusCode).toBe(200);
    expect(res.json().tombstone.deleted_at).not.toBeNull();
    res = await app.inject({ method: "DELETE", url: "/api/themes/ocean" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("theme writes from a local node", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "osmosis-themes-")); });

  it("forward to canonical when online, mirror canonical's row locally, refuse offline, and pull converges", async () => {
    const canonicalDb = openFileDb(dir, "c.db");
    const cEnv = { role: "canonical" as const, label: "c", port: 0, dbPath: join(dir, "c.db"), remoteUrl: null,
                   uploadsDir: dir, mcpAuthToken: "t", deepseekApiKey: null, webDistDir: null };
    const canonicalApp = buildApp({ db: canonicalDb, env: cEnv, node: bootstrapNode(canonicalDb, cEnv), runtime: createSyncRuntime(), logger: false });
    const canonicalUrl = await canonicalApp.listen({ port: 0, host: "127.0.0.1" });

    const localDb = openFileDb(dir, "l.db");
    const env = { role: "local" as const, label: "l", port: 0, dbPath: join(dir, "l.db"), remoteUrl: canonicalUrl,
                  uploadsDir: dir, mcpAuthToken: null, deepseekApiKey: null, webDistDir: null };
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
});
