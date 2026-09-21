import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { openTestDb } from "./helpers.js";
import type { EnvConfig } from "../src/env.js";

const dist = mkdtempSync(join(tmpdir(), "osmosis-webdist-"));
afterAll(() => rmSync(dist, { recursive: true, force: true }));

function envFor(webDistDir: string | null): EnvConfig {
  return {
    role: "canonical", label: "c", port: 0, dbPath: ":memory:", remoteUrl: null,
    uploadsDir: "/tmp", mcpAuthToken: "t", webDistDir,
  };
}

describe("serving the built web app", () => {
  it("serves index.html at / when WEB_DIST_DIR is set, and /api still wins", async () => {
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>Osmosis</title>");
    const db = openTestDb();
    const env = envFor(dist);
    const app = buildApp({ db, env, node: bootstrapNode(db, env), runtime: createSyncRuntime(), logger: false });
    await app.ready();

    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain("<title>Osmosis</title>");

    const api = await app.inject({ method: "GET", url: "/api/status" });
    expect(api.statusCode).toBe(200);
    expect(api.json().canonical).toBe(true);

    await app.close();
  });

  it("does not serve anything at / when WEB_DIST_DIR is unset (dev: Vite owns the app)", async () => {
    const db = openTestDb();
    const env = envFor(null);
    const app = buildApp({ db, env, node: bootstrapNode(db, env), runtime: createSyncRuntime(), logger: false });
    await app.ready();
    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(404);
    await app.close();
  });

  it("refuses to start when WEB_DIST_DIR points at a directory without a build", () => {
    const empty = mkdtempSync(join(tmpdir(), "osmosis-webdist-empty-"));
    const db = openTestDb();
    const env = envFor(empty);
    expect(() => buildApp({ db, env, node: bootstrapNode(db, env), runtime: createSyncRuntime(), logger: false })).toThrow(/index.html/);
    rmSync(empty, { recursive: true, force: true });
  });
});
