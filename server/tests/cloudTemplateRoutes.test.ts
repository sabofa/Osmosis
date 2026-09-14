import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../src/db/migrate.js";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime, runSync } from "../src/sync/client.js";
import { createTemplate, isTemplateDownloaded } from "../src/domain/templates.js";
import { addSlice } from "../src/domain/sync.js";
import { insertTag, insertQuestion } from "./helpers.js";

function openFileDb(dir: string, name: string): DatabaseSync {
  const db = new DatabaseSync(join(dir, name));
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

describe("cloud tests: a local node runs a non-downloaded template via canonical", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "osmosis-cloud-")); });

  it("online → draws from canonical and mirrors the questions; offline → 503; downloaded → local draw", async () => {
    const canonicalDb = openFileDb(dir, "c.db");
    insertTag(canonicalDb, "geo");
    for (let i = 0; i < 4; i++) insertQuestion(canonicalDb, { tags: ["geo"] });
    const template = createTemplate(canonicalDb, { name: "geo test", tag_query: { all: ["geo"] }, question_count: 2 });
    const cEnv = { role: "canonical" as const, label: "c", port: 0, dbPath: join(dir, "c.db"), remoteUrl: null,
                   uploadsDir: dir, mcpAuthToken: "t", deepseekApiKey: null, webDistDir: null };
    const canonicalApp = buildApp({ db: canonicalDb, env: cEnv, node: bootstrapNode(canonicalDb, cEnv), runtime: createSyncRuntime() });
    const canonicalUrl = await canonicalApp.listen({ port: 0, host: "127.0.0.1" });

    const localDb = openFileDb(dir, "l.db");
    const env = { role: "local" as const, label: "l", port: 0, dbPath: join(dir, "l.db"), remoteUrl: canonicalUrl,
                  uploadsDir: dir, mcpAuthToken: null, deepseekApiKey: null, webDistDir: null };
    const node = bootstrapNode(localDb, env);
    const runtime = createSyncRuntime();
    const ctx = { db: localDb, env, node, runtime };
    const app = buildApp(ctx);

    // The template row itself arrives with an ordinary pull (templates always sync);
    // no slice for "geo" is held, so it is a cloud test.
    runtime.online = true;
    await runSync(ctx, runtime);
    expect(localDb.prepare("SELECT id FROM template WHERE id = ?").get(template.id)).toBeTruthy();
    expect(isTemplateDownloaded(localDb, template.id)).toBe(false);
    expect((localDb.prepare("SELECT COUNT(*) AS n FROM question").get() as { n: number }).n).toBe(0);

    // Offline: refused with a reason the app can render.
    runtime.online = false;
    const offline = await app.inject({ method: "POST", url: "/api/attempts", payload: { source: "template", template_id: template.id } });
    expect(offline.statusCode).toBe(503);
    expect(offline.json().reason).toBe("template_requires_connection");

    // Online: canonical draws, the local node mirrors exactly those questions and takes the attempt.
    runtime.online = true;
    const online = await app.inject({ method: "POST", url: "/api/attempts", payload: { source: "template", template_id: template.id } });
    expect(online.statusCode).toBe(200);
    const body = online.json();
    expect(body.questions).toHaveLength(2);
    expect(body.requested).toBe(2);
    const mirrored = (localDb.prepare("SELECT id FROM question").all() as { id: string }[]).map((r) => r.id).sort();
    expect(mirrored).toEqual(body.questions.map((q: { id: string }) => q.id).sort());
    const detail = await app.inject({ method: "GET", url: `/api/attempts/${body.attempt_id}` });
    expect(detail.json().responses).toHaveLength(2);
    expect(detail.json().source).toBe("template");

    // Downloaded: after adding the slice and pulling, the draw is local and works offline.
    addSlice(localDb, "geo");
    await runSync(ctx, runtime);
    expect(isTemplateDownloaded(localDb, template.id)).toBe(true);
    runtime.online = false;
    const local = await app.inject({ method: "POST", url: "/api/attempts", payload: { source: "template", template_id: template.id } });
    expect(local.statusCode).toBe(200);
    expect(local.json().questions).toHaveLength(2);

    await app.close();
    await canonicalApp.close();
  });

  it("a connection error while online (not just a non-OK response) still returns 503, not 500", async () => {
    const canonicalDb = openFileDb(dir, "c2.db");
    insertTag(canonicalDb, "geo2");
    insertQuestion(canonicalDb, { tags: ["geo2"] });
    const template = createTemplate(canonicalDb, { name: "geo2 test", tag_query: { all: ["geo2"] }, question_count: 1 });
    const cEnv = { role: "canonical" as const, label: "c", port: 0, dbPath: join(dir, "c2.db"), remoteUrl: null,
                   uploadsDir: dir, mcpAuthToken: "t", deepseekApiKey: null, webDistDir: null };
    const canonicalApp = buildApp({ db: canonicalDb, env: cEnv, node: bootstrapNode(canonicalDb, cEnv), runtime: createSyncRuntime() });
    const canonicalUrl = await canonicalApp.listen({ port: 0, host: "127.0.0.1" });

    const localDb = openFileDb(dir, "l2.db");
    // remoteUrl points at a closed port: `runtime.online = true` below fakes the
    // connectivity check having passed, but every actual fetch (template-draw
    // included) hits a real connection refusal, not an HTTP error response.
    const env = { role: "local" as const, label: "l", port: 0, dbPath: join(dir, "l2.db"), remoteUrl: "http://127.0.0.1:1",
                  uploadsDir: dir, mcpAuthToken: null, deepseekApiKey: null, webDistDir: null };
    const node = bootstrapNode(localDb, env);
    const runtime = createSyncRuntime();
    const ctx = { db: localDb, env, node, runtime };
    const app = buildApp(ctx);

    // Mirror the template row locally the way an ordinary pull against the
    // real canonical would, without going through the unreachable remoteUrl.
    const realCtx = { db: localDb, env: { ...env, remoteUrl: canonicalUrl }, node, runtime };
    await runSync(realCtx, runtime);
    expect(localDb.prepare("SELECT id FROM template WHERE id = ?").get(template.id)).toBeTruthy();
    expect(isTemplateDownloaded(localDb, template.id)).toBe(false);

    runtime.online = true;
    const res = await app.inject({ method: "POST", url: "/api/attempts", payload: { source: "template", template_id: template.id } });
    expect(res.statusCode).toBe(503);
    expect(res.json().reason).toBe("template_requires_connection");

    await app.close();
    await canonicalApp.close();
  });
});
