import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime, fetchAndApplyDailyDraw } from "../src/sync/client.js";
import { computeDrawDate } from "../src/domain/dailyDraw.js";
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
                  remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: null };
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
                  remoteUrl: canonicalUrl, uploadsDir: "/tmp", mcpAuthToken: null, deepseekApiKey: null };
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
                  remoteUrl: canonicalUrl, uploadsDir: "/tmp", mcpAuthToken: null, deepseekApiKey: null };
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
                  remoteUrl: "http://127.0.0.1:1", uploadsDir: "/tmp", mcpAuthToken: null, deepseekApiKey: null };
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
                       remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: null };
    const hierNode = bootstrapNode(hierDb, hierEnv);
    const hierApp = buildApp({ db: hierDb, env: hierEnv, node: hierNode, runtime: createSyncRuntime() });
    const hierUrl = await hierApp.listen({ port: 0, host: "127.0.0.1" });

    // A brand new local node holding no slices and no tags at all.
    const localDb = openTestDb();
    const env = { role: "local" as const, label: "hl", port: 0, dbPath: ":memory:",
                  remoteUrl: hierUrl, uploadsDir: "/tmp", mcpAuthToken: null, deepseekApiKey: null };
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

  // Residual-bug regression: fetchTagAncestorClosure used to order the
  // shipped tags by BFS-discovery LEVEL, not true tree depth. That's only
  // safe when every directly-used tag sits at the same depth. Here two
  // DIRECTLY-used tags are themselves in an ancestor/descendant relationship
  // (math:functions is the parent of math:functions:quadratic) and both are
  // used by different questions pulled into the SAME daily quiz. The
  // question ids are pinned so buildQuestionPayloads's `ORDER BY q.id` lists
  // the leaf-tagged (quadratic) question before the mid-tagged (functions)
  // question, which is exactly the ordering that made the old BFS-level sort
  // place "math:functions:quadratic" ahead of its own parent
  // "math:functions" in the shipped `tags` array, violating
  // tag.parent_slug's FK in upsertBankContent.
  it("local, online: daily quiz mixing tag depths in one draw mirrors ancestors in true depth order", async () => {
    const hierDb = openTestDb();

    // Decoy, unrelated to the math hierarchy, used only so the day's single
    // "question" draw (which /sync/daily-draw's "quiz" kind always resolves
    // first and excludes from the quiz pool) is pinned deterministically —
    // otherwise a random pick could exclude one of our two target math
    // questions from the quiz and this test would only exercise one depth.
    insertTag(hierDb, "phys");
    const decoy = insertQuestion(hierDb, { tags: ["phys"] });

    insertTag(hierDb, "math");
    insertTag(hierDb, "math:functions", "math");
    insertTag(hierDb, "math:functions:quadratic", "math:functions");

    const quadraticId = "00000000-0000-4000-8000-000000000001";
    const functionsId = "00000000-0000-4000-8000-000000000002";
    const insertQuestionWithId = (id: string, tags: string[]) => {
      hierDb
        .prepare(
          `INSERT INTO question (id, lineage_id, version, type, prompt, model_answer, difficulty, calculator_policy)
           VALUES (?, ?, 1, 'written', ?, 'model answer', 3, 'n_a')`
        )
        .run(id, id, `question ${id}`);
      for (const tag of tags) {
        hierDb.prepare("INSERT INTO question_tag (question_id, tag_slug) VALUES (?, ?)").run(id, tag);
      }
    };
    // quadraticId < functionsId lexically, so it sorts first under
    // buildQuestionPayloads's ORDER BY q.id, putting the child tag ahead of
    // its parent in the BFS frontier that fetchTagAncestorClosure starts from.
    insertQuestionWithId(quadraticId, ["math:functions:quadratic"]);
    insertQuestionWithId(functionsId, ["math:functions"]);

    // Pin today's "question" draw to the decoy so the quiz's own draw is left
    // with exactly {quadraticId, functionsId} as its eligible pool.
    const drawDate = computeDrawDate(hierDb);
    const dailyDrawId = uuidv4();
    hierDb
      .prepare("INSERT INTO daily_draw (id, draw_date, kind) VALUES (?, ?, 'question')")
      .run(dailyDrawId, drawDate);
    hierDb
      .prepare("INSERT INTO daily_draw_question (daily_draw_id, question_id, ordinal) VALUES (?, ?, 0)")
      .run(dailyDrawId, decoy.id);

    const hierEnv = { role: "canonical" as const, label: "hc2", port: 0, dbPath: ":memory:",
                       remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: null };
    const hierNode = bootstrapNode(hierDb, hierEnv);
    const hierApp = buildApp({ db: hierDb, env: hierEnv, node: hierNode, runtime: createSyncRuntime() });
    const hierUrl = await hierApp.listen({ port: 0, host: "127.0.0.1" });

    const localDb = openTestDb();
    const env = { role: "local" as const, label: "hl2", port: 0, dbPath: ":memory:",
                  remoteUrl: hierUrl, uploadsDir: "/tmp", mcpAuthToken: null, deepseekApiKey: null };
    const node = bootstrapNode(localDb, env);
    const runtime = createSyncRuntime();
    runtime.online = true;
    const ctx = { db: localDb, env, node, runtime };

    const result = await fetchAndApplyDailyDraw(ctx, "quiz");
    expect(result.questions.length).toBe(2);
    expect(new Set(result.questions.map((q: any) => q.id))).toEqual(new Set([quadraticId, functionsId]));

    const getTag = (slug: string) =>
      localDb.prepare("SELECT slug, parent_slug FROM tag WHERE slug = ?").get(slug) as
        | { slug: string; parent_slug: string | null }
        | undefined;
    const math = getTag("math");
    const mathFunctions = getTag("math:functions");
    const mathFunctionsQuadratic = getTag("math:functions:quadratic");
    expect(math).toBeTruthy();
    expect(mathFunctions).toBeTruthy();
    expect(mathFunctionsQuadratic).toBeTruthy();
    expect(math?.parent_slug).toBe(null);
    expect(mathFunctions?.parent_slug).toBe("math");
    expect(mathFunctionsQuadratic?.parent_slug).toBe("math:functions");

    await hierApp.close();
  });

  // Residual-bug regression #2: fetchTagAncestorClosure's depthOf memoization
  // had an arithmetic error — when the walk from a starting slug hit an
  // already-memoized ancestor partway through, it set
  // `depth = parentCached + 1` instead of `depth = parentCached + depth + 1`,
  // discarding however many steps had already been walked before the
  // memoized hit. The prior regression test (root=math, mid=math:functions,
  // leaf=math:functions:quadratic; mid+leaf directly used) doesn't trigger
  // this because the walk from the mid tag never hits a memoized node
  // mid-walk. Directly using the ROOT and the LEAF of the same chain does:
  // once math's depth (0) is memoized, the leaf's walk
  // (quadratic -> functions -> math) hits that memoized entry after 1 step
  // already taken, so the bug computes depth 1 instead of the correct 2,
  // tying the leaf's depth with "math:functions"'s and — because sort() is
  // stable — leaving discovery order (which can place the leaf before its
  // own parent) to decide the tie, reproducing the FK violation.
  it("local, online: daily quiz using a chain's root and leaf tags mirrors ancestors in true depth order", async () => {
    const hierDb = openTestDb();

    insertTag(hierDb, "phys");
    const decoy = insertQuestion(hierDb, { tags: ["phys"] });

    insertTag(hierDb, "math");
    insertTag(hierDb, "math:functions", "math");
    insertTag(hierDb, "math:functions:quadratic", "math:functions");

    // leafId sorts before rootId (lexically smaller) so that
    // buildQuestionPayloads's ORDER BY q.id lists the leaf-tagged question
    // first, putting "math:functions:quadratic" ahead of "math" in
    // fetchTagAncestorClosure's initialSlugs/allSlugs. That ordering is what
    // makes the depth-memoization sort resolve depthOf("math") (root, cached
    // as 0) before depthOf("math:functions:quadratic") walks up through the
    // still-uncached "math:functions" and then hits the cached root two hops
    // in — exactly the case the old `parentCached + 1` formula understated.
    const leafId = "00000000-0000-4000-8000-000000000003";
    const rootId = "00000000-0000-4000-8000-000000000004";
    const insertQuestionWithId = (id: string, tags: string[]) => {
      hierDb
        .prepare(
          `INSERT INTO question (id, lineage_id, version, type, prompt, model_answer, difficulty, calculator_policy)
           VALUES (?, ?, 1, 'written', ?, 'model answer', 3, 'n_a')`
        )
        .run(id, id, `question ${id}`);
      for (const tag of tags) {
        hierDb.prepare("INSERT INTO question_tag (question_id, tag_slug) VALUES (?, ?)").run(id, tag);
      }
    };
    insertQuestionWithId(rootId, ["math"]);
    insertQuestionWithId(leafId, ["math:functions:quadratic"]);

    const drawDate = computeDrawDate(hierDb);
    const dailyDrawId = uuidv4();
    hierDb
      .prepare("INSERT INTO daily_draw (id, draw_date, kind) VALUES (?, ?, 'question')")
      .run(dailyDrawId, drawDate);
    hierDb
      .prepare("INSERT INTO daily_draw_question (daily_draw_id, question_id, ordinal) VALUES (?, ?, 0)")
      .run(dailyDrawId, decoy.id);

    const hierEnv = { role: "canonical" as const, label: "hc3", port: 0, dbPath: ":memory:",
                       remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: null };
    const hierNode = bootstrapNode(hierDb, hierEnv);
    const hierApp = buildApp({ db: hierDb, env: hierEnv, node: hierNode, runtime: createSyncRuntime() });
    const hierUrl = await hierApp.listen({ port: 0, host: "127.0.0.1" });

    const localDb = openTestDb();
    const env = { role: "local" as const, label: "hl3", port: 0, dbPath: ":memory:",
                  remoteUrl: hierUrl, uploadsDir: "/tmp", mcpAuthToken: null, deepseekApiKey: null };
    const node = bootstrapNode(localDb, env);
    const runtime = createSyncRuntime();
    runtime.online = true;
    const ctx = { db: localDb, env, node, runtime };

    const result = await fetchAndApplyDailyDraw(ctx, "quiz");
    expect(result.questions.length).toBe(2);
    expect(new Set(result.questions.map((q: any) => q.id))).toEqual(new Set([rootId, leafId]));

    const getTag = (slug: string) =>
      localDb.prepare("SELECT slug, parent_slug FROM tag WHERE slug = ?").get(slug) as
        | { slug: string; parent_slug: string | null }
        | undefined;
    const math = getTag("math");
    const mathFunctions = getTag("math:functions");
    const mathFunctionsQuadratic = getTag("math:functions:quadratic");
    expect(math).toBeTruthy();
    expect(mathFunctions).toBeTruthy();
    expect(mathFunctionsQuadratic).toBeTruthy();
    expect(math?.parent_slug).toBe(null);
    expect(mathFunctions?.parent_slug).toBe("math");
    expect(mathFunctionsQuadratic?.parent_slug).toBe("math:functions");

    await hierApp.close();
  });
});
