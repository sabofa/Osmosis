import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime, fetchAndApplyDailyDraw } from "../src/sync/client.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";

describe("/sync/daily-draw and POST /api/attempts (daily)", () => {
  let canonicalApp: FastifyInstance;
  let canonicalUrl: string;
  let canonicalDb: ReturnType<typeof openTestDb>;

  beforeAll(async () => {
    canonicalDb = openTestDb();
    insertTag(canonicalDb, "phys");
    for (let i = 0; i < 3; i++) insertQuestion(canonicalDb, { tags: ["phys"] });
    const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:",
                  remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t" };
    const node = bootstrapNode(canonicalDb, env);
    canonicalApp = buildApp({ db: canonicalDb, env, node, runtime: createSyncRuntime() });
    canonicalUrl = await canonicalApp.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => { await canonicalApp.close(); });

  it("canonical: POST /api/attempts with daily_kind generates and creates directly", async () => {
    const res = await canonicalApp.inject({
      method: "POST", url: "/api/attempts", payload: { daily_kind: "question" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.attempt_id).toBeTruthy();
    expect(body.questions.length).toBe(1);
  });

  it("canonical: /sync/daily-draw returns bank content for the resolved questions", async () => {
    const res = await canonicalApp.inject({
      method: "POST", url: "/sync/daily-draw", payload: { kind: "question" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.daily_draw_id).toBeTruthy();
    expect(body.questions.length).toBe(1);
    expect(body.tags.some((t: any) => t.slug === "phys")).toBe(true);
  });

  it("canonical: /sync/daily-draw rejects an invalid kind with a 400, not a 500", async () => {
    const res = await canonicalApp.inject({
      method: "POST", url: "/sync/daily-draw", payload: { kind: "bogus" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_kind");
  });

  it("canonical: POST /api/attempts rejects an invalid daily_kind with a 400", async () => {
    const res = await canonicalApp.inject({
      method: "POST", url: "/api/attempts", payload: { daily_kind: "bogus" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_daily_kind");
  });

  it("local, online: POST /api/attempts rejects an invalid daily_kind with a 400, not the offline-503", async () => {
    const localDb = openTestDb();
    const env = { role: "local" as const, label: "l3", port: 0, dbPath: ":memory:",
                  remoteUrl: canonicalUrl, uploadsDir: "/tmp", mcpAuthToken: null };
    const node = bootstrapNode(localDb, env);
    const runtime = createSyncRuntime();
    runtime.online = true;
    const localApp = buildApp({ db: localDb, env, node, runtime });

    const res = await localApp.inject({
      method: "POST", url: "/api/attempts", payload: { daily_kind: "bogus" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_daily_kind");

    await localApp.close();
  });

  it("local, online: POST /api/attempts with daily_kind proxies to canonical and materializes a local attempt", async () => {
    const localDb = openTestDb();
    const env = { role: "local" as const, label: "l", port: 0, dbPath: ":memory:",
                  remoteUrl: canonicalUrl, uploadsDir: "/tmp", mcpAuthToken: null };
    const node = bootstrapNode(localDb, env);
    const runtime = createSyncRuntime();
    runtime.online = true; // simulate an already-established online state
    const localApp = buildApp({ db: localDb, env, node, runtime });

    const res = await localApp.inject({
      method: "POST", url: "/api/attempts", payload: { daily_kind: "question" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.attempt_id).toBeTruthy();

    // Finding 4: local-proxy response must match the canonical-direct shape,
    // including short_draw/requested/returned (previously silently dropped).
    expect(body).toHaveProperty("short_draw");
    expect(body).toHaveProperty("requested");
    expect(body).toHaveProperty("returned");
    expect(typeof body.requested).toBe("number");
    expect(typeof body.returned).toBe("number");

    // The question that came down must actually exist locally now (mirrored via
    // upsertBankContent), and the local daily_draw/daily_draw_question rows must
    // exist too (the response's question_id FK depends on it).
    const localQuestion = localDb.prepare("SELECT id FROM question WHERE id = ?").get(body.questions[0].id);
    expect(localQuestion).toBeTruthy();
    const localDraw = localDb.prepare("SELECT id FROM daily_draw WHERE id = ?").get(
      (localDb.prepare("SELECT daily_draw_id FROM attempt WHERE id = ?").get(body.attempt_id) as any).daily_draw_id
    );
    expect(localDraw).toBeTruthy();

    await localApp.close();
  });

  it("local, offline: POST /api/attempts with daily_kind 503s with daily_requires_connection", async () => {
    const localDb = openTestDb();
    const env = { role: "local" as const, label: "l2", port: 0, dbPath: ":memory:",
                  remoteUrl: "http://127.0.0.1:1", uploadsDir: "/tmp", mcpAuthToken: null };
    const node = bootstrapNode(localDb, env);
    const runtime = createSyncRuntime();
    runtime.online = false;
    const localApp = buildApp({ db: localDb, env, node, runtime });

    const res = await localApp.inject({
      method: "POST", url: "/api/attempts", payload: { daily_kind: "question" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().reason).toBe("daily_requires_connection");

    await localApp.close();
  });

  // Finding 1 regression: every other daily-draw test seeds only flat,
  // top-level tags. A hierarchical tag (parent_slug set) exposed an FK
  // violation in upsertBankContent's tag insert — tag.parent_slug REFERENCES
  // tag(slug), and /sync/daily-draw used to return only the tags directly on
  // the drawn questions, omitting ancestors a fresh local node doesn't
  // already hold.
  it("local, online: daily draw for a hierarchically-tagged question mirrors both the tag and its ancestor", async () => {
    const hierDb = openTestDb();
    insertTag(hierDb, "math");
    insertTag(hierDb, "math:functions", "math");
    insertQuestion(hierDb, { tags: ["math:functions"] });
    const hierEnv = { role: "canonical" as const, label: "hc", port: 0, dbPath: ":memory:",
                       remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t" };
    const hierNode = bootstrapNode(hierDb, hierEnv);
    const hierApp = buildApp({ db: hierDb, env: hierEnv, node: hierNode, runtime: createSyncRuntime() });
    const hierUrl = await hierApp.listen({ port: 0, host: "127.0.0.1" });

    // A brand new local node holding no slices and no tags at all.
    const localDb = openTestDb();
    const env = { role: "local" as const, label: "hl", port: 0, dbPath: ":memory:",
                  remoteUrl: hierUrl, uploadsDir: "/tmp", mcpAuthToken: null };
    const node = bootstrapNode(localDb, env);
    const runtime = createSyncRuntime();
    runtime.online = true;
    const ctx = { db: localDb, env, node, runtime };

    const result = await fetchAndApplyDailyDraw(ctx, "question");
    expect(result.questions.length).toBe(1);

    const mathTag = localDb.prepare("SELECT slug, parent_slug FROM tag WHERE slug = ?").get("math") as
      | { slug: string; parent_slug: string | null }
      | undefined;
    const mathFunctionsTag = localDb.prepare("SELECT slug, parent_slug FROM tag WHERE slug = ?").get("math:functions") as
      | { slug: string; parent_slug: string | null }
      | undefined;
    expect(mathTag).toBeTruthy();
    expect(mathFunctionsTag).toBeTruthy();
    expect(mathFunctionsTag?.parent_slug).toBe("math");

    await hierApp.close();
  });
});
