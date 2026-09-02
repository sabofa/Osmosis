import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { createTemplate } from "../src/domain/templates.js";
import { addSlice, NEVER_PULLED } from "../src/domain/sync.js";
import { presentItem, createAttempt } from "../src/domain/attempts.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";

// ----------------------------------------------------------------------------
// Finding 2 — canonical nodes must never reach the slice-removal / template
// download-removal paths, which prune real bank questions.
// ----------------------------------------------------------------------------

describe("canonical-node guards on slice and template-download routes", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof openTestDb>;
  let templateId: string;
  let questionId: string;

  beforeAll(async () => {
    db = openTestDb();
    const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:",
                  remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: null };
    const node = bootstrapNode(db, env);
    app = buildApp({ db, env, node, runtime: createSyncRuntime() });
    await app.ready();

    insertTag(db, "bank");
    questionId = insertQuestion(db, { tags: ["bank"] }).id;
    templateId = createTemplate(db, { name: "t", tag_query: { all: ["bank"] }, question_count: 1 }).id;
  });

  afterAll(async () => { await app.close(); });

  it("DELETE /api/slices/:slug is rejected with 400 canonical_node and deletes nothing", async () => {
    // Pretend a slice row somehow exists — the guard must fire before any
    // domain call regardless.
    addSlice(db, "bank");

    const res = await app.inject({ method: "DELETE", url: "/api/slices/bank" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("canonical_node");
    // The bank question is untouched — this is the data-loss path.
    expect(db.prepare("SELECT id FROM question WHERE id = ?").get(questionId)).toBeTruthy();
    expect(db.prepare("SELECT tag_slug FROM local_slice WHERE tag_slug = 'bank'").get()).toBeTruthy();

    db.prepare("DELETE FROM local_slice WHERE tag_slug = 'bank'").run();
  });

  it("DELETE /api/templates/:id/download is rejected with 400 canonical_node and deletes nothing", async () => {
    const res = await app.inject({ method: "DELETE", url: `/api/templates/${templateId}/download` });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("canonical_node");
    expect(db.prepare("SELECT id FROM question WHERE id = ?").get(questionId)).toBeTruthy();
  });

  it("POST /api/templates/:id/download is rejected with 400 canonical_node", async () => {
    const res = await app.inject({ method: "POST", url: `/api/templates/${templateId}/download` });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("canonical_node");
    const sliceCount = (db.prepare("SELECT COUNT(*) AS n FROM local_slice").get() as { n: number }).n;
    expect(sliceCount).toBe(0);
  });

  it("POST /api/slices is rejected with 400 canonical_node", async () => {
    const res = await app.inject({ method: "POST", url: "/api/slices", payload: { tag_slug: "bank" } });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("canonical_node");
    const sliceCount = (db.prepare("SELECT COUNT(*) AS n FROM local_slice").get() as { n: number }).n;
    expect(sliceCount).toBe(0);
  });
});

// ----------------------------------------------------------------------------
// Findings 10, 11, 13 — local-node route behaviour against a real canonical.
// ----------------------------------------------------------------------------

describe("local-node sync-triggering routes", () => {
  let canonicalApp: FastifyInstance;
  let canonicalUrl: string;
  let canonicalDb: ReturnType<typeof openTestDb>;

  beforeAll(async () => {
    canonicalDb = openTestDb();
    const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:",
                  remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: null };
    const node = bootstrapNode(canonicalDb, env);
    canonicalApp = buildApp({ db: canonicalDb, env, node, runtime: createSyncRuntime() });
    canonicalUrl = await canonicalApp.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => { await canonicalApp.close(); });

  function buildLocal(label: string, remoteUrl: string | null) {
    const db = openTestDb();
    const env = { role: "local" as const, label, port: 0, dbPath: ":memory:",
                  remoteUrl, uploadsDir: "/tmp", mcpAuthToken: null, deepseekApiKey: null };
    const node = bootstrapNode(db, env);
    const runtime = createSyncRuntime();
    const app = buildApp({ db, env, node, runtime });
    return { db, env, node, runtime, app };
  }

  // Polls a condition instead of sleeping a fixed amount: the submit trigger
  // is deliberately fire-and-forget, so the only non-flaky way to assert on it
  // is to wait for the observable effect with a generous bound.
  async function eventually(check: () => boolean, timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (check()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return check();
  }

  // Finding 10 — 5th sync trigger: on submit, when online.
  it("POST /api/attempts/:id/submit fire-and-forget syncs to canonical when online", async () => {
    insertTag(canonicalDb, "trig");
    insertQuestion(canonicalDb, { tags: ["trig"] });
    const template = createTemplate(canonicalDb, {
      name: "trig t", tag_query: { all: ["trig"] }, question_count: 1,
    });

    const local = buildLocal("l-submit", canonicalUrl);
    await local.app.ready();

    // Pull the slice so the local node has the question and template.
    const addRes = await local.app.inject({
      method: "POST", url: "/api/slices", payload: { tag_slug: "trig" },
    });
    expect(addRes.statusCode).toBe(200);
    local.runtime.online = true;

    const createRes = await local.app.inject({
      method: "POST", url: "/api/attempts", payload: { source: "template", template_id: template.id },
    });
    expect(createRes.statusCode).toBe(200);
    const attemptId = createRes.json().attempt_id;

    const submitRes = await local.app.inject({ method: "POST", url: `/api/attempts/${attemptId}/submit` });
    expect(submitRes.statusCode).toBe(200);

    // No manual POST /api/sync anywhere — the attempt must arrive on its own.
    const arrived = await eventually(
      () => !!canonicalDb.prepare("SELECT id FROM attempt WHERE id = ?").get(attemptId)
    );
    expect(arrived).toBe(true);

    await local.app.close();
  });

  it("does not fire the submit trigger when the node is offline", async () => {
    insertTag(canonicalDb, "trigoff");
    insertQuestion(canonicalDb, { tags: ["trigoff"] });
    const template = createTemplate(canonicalDb, {
      name: "trigoff t", tag_query: { all: ["trigoff"] }, question_count: 1,
    });

    const local = buildLocal("l-offline", canonicalUrl);
    await local.app.ready();
    await local.app.inject({ method: "POST", url: "/api/slices", payload: { tag_slug: "trigoff" } });

    local.runtime.online = false; // explicitly offline

    const createRes = await local.app.inject({
      method: "POST", url: "/api/attempts", payload: { source: "template", template_id: template.id },
    });
    const attemptId = createRes.json().attempt_id;
    await local.app.inject({ method: "POST", url: `/api/attempts/${attemptId}/submit` });

    // The work is durably queued locally rather than pushed.
    const outbox = (local.db.prepare(
      "SELECT COUNT(*) AS n FROM outbox WHERE entity_type = 'attempt' AND entity_id = ?"
    ).get(attemptId) as { n: number }).n;
    expect(outbox).toBe(1);

    await local.app.close();
  });

  // Finding 11 — downloading a template must pull its slices immediately.
  it("POST /api/templates/:id/download pulls the referenced slices' content right away", async () => {
    insertTag(canonicalDb, "dl");
    const q1 = insertQuestion(canonicalDb, { tags: ["dl"] });
    const q2 = insertQuestion(canonicalDb, { tags: ["dl"] });
    const template = createTemplate(canonicalDb, {
      name: "dl t", tag_query: { all: ["dl"] }, question_count: 2,
    });

    const local = buildLocal("l-download", canonicalUrl);
    await local.app.ready();
    // A real node has the template row from a prior sync (buildPullResponse
    // ships all non-retired templates regardless of slice), but none of the
    // `dl` slice's questions yet — that is exactly the state the Library
    // download button acts from.
    await local.app.inject({ method: "POST", url: "/api/sync" });
    expect(local.db.prepare("SELECT id FROM template WHERE id = ?").get(template.id)).toBeTruthy();
    expect(local.db.prepare("SELECT id FROM question WHERE id = ?").get(q1.id)).toBeUndefined();

    const res = await local.app.inject({ method: "POST", url: `/api/templates/${template.id}/download` });
    expect(res.statusCode).toBe(200);

    // Content is present immediately — no manual /api/sync after the download.
    expect(local.db.prepare("SELECT id FROM question WHERE id = ?").get(q1.id)).toBeTruthy();
    expect(local.db.prepare("SELECT id FROM question WHERE id = ?").get(q2.id)).toBeTruthy();

    // And the slice carries a real pulled_at, not the never-pulled sentinel.
    const slice = local.db.prepare("SELECT pulled_at, question_count FROM local_slice WHERE tag_slug = 'dl'").get() as {
      pulled_at: string; question_count: number;
    };
    expect(slice.pulled_at).not.toBe(NEVER_PULLED);
    expect(slice.question_count).toBe(2);

    await local.app.close();
  });

  // Finding 13 — a RESTRICT-protected question must not produce a bare 500.
  it("DELETE /api/slices/:slug succeeds without a 500 when questions are RESTRICT-protected", async () => {
    const local = buildLocal("l-restrict", canonicalUrl);
    await local.app.ready();

    insertTag(local.db, "prot");
    const frozenQ = insertQuestion(local.db, { tags: ["prot"] });
    const orphan = insertQuestion(local.db, { tags: ["prot"] });
    addSlice(local.db, "prot");

    const template = createTemplate(local.db, { name: "p", tag_query: { all: ["prot"] }, question_count: 1 });
    local.db.prepare("DELETE FROM template_frozen_question WHERE template_id = ?").run(template.id);
    local.db.prepare(
      "INSERT INTO template_frozen_question (template_id, question_id, ordinal) VALUES (?, ?, 0)"
    ).run(template.id, frozenQ.id);

    const res = await local.app.inject({ method: "DELETE", url: "/api/slices/prot" });

    expect(res.statusCode).toBe(200);
    expect(res.json().pruned_questions).toBe(1);
    expect(local.db.prepare("SELECT id FROM question WHERE id = ?").get(frozenQ.id)).toBeTruthy();
    expect(local.db.prepare("SELECT id FROM question WHERE id = ?").get(orphan.id)).toBeUndefined();

    await local.app.close();
  });

  it("POST /api/slices records the slice at the sentinel when the remote is unreachable", async () => {
    const local = buildLocal("l-noremote", "http://127.0.0.1:1");
    await local.app.ready();

    const res = await local.app.inject({ method: "POST", url: "/api/slices", payload: { tag_slug: "offline-slice" } });

    // The add itself still succeeds — a failed immediate pull is swallowed.
    expect(res.statusCode).toBe(200);
    const slice = local.db.prepare("SELECT pulled_at FROM local_slice WHERE tag_slug = 'offline-slice'").get() as {
      pulled_at: string;
    };
    expect(slice.pulled_at).toBe(NEVER_PULLED);

    await local.app.close();
  });
});

// ----------------------------------------------------------------------------
// Task 4 — /api/status model grading fields.
// ----------------------------------------------------------------------------

describe("/api/status model grading fields", () => {
  it("reports model_grades_today and model_grading_configured", async () => {
    const db = openTestDb();
    const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:",
                  remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: "real-key" };
    const node = bootstrapNode(db, env);
    const app = buildApp({ db, env, node, runtime: createSyncRuntime() });

    const res = await app.inject({ method: "GET", url: "/api/status" });
    const body = res.json();

    expect(body.model_grading_configured).toBe(true);
    expect(body.model_grades_today).toBe(0);

    // grade.response_id carries an enforced FK to response(id) (ON DELETE
    // CASCADE), and the test DB runs with foreign_keys = ON, so a bare
    // literal insert would violate it — build the minimal
    // tag/question/attempt/response chain first, matching the pattern
    // used in modelGrading.test.ts.
    insertTag(db, "a");
    const q = insertQuestion(db, { type: "written", tags: ["a"] });
    const attemptId = uuidv4();
    const responseId = uuidv4();
    db.prepare("INSERT INTO attempt (id, node_id, source, started_at) VALUES (?, 'n1', 'adhoc', datetime('now'))").run(
      attemptId
    );
    db.prepare(
      "INSERT INTO response (id, attempt_id, question_id, ordinal, response_text) VALUES (?, ?, ?, 0, 'my answer')"
    ).run(responseId, attemptId, q.id);
    db.prepare(
      "INSERT INTO grade (id, response_id, grader, score, model_name, graded_at) VALUES (?, ?, 'model', 0.9, 'deepseek-v4-flash', datetime('now'))"
    ).run(uuidv4(), responseId);

    const res2 = await app.inject({ method: "GET", url: "/api/status" });
    expect(res2.json().model_grades_today).toBe(1);
  });

  it("reports model_grading_configured false when DEEPSEEK_API_KEY is unset", async () => {
    const db = openTestDb();
    const env = { role: "canonical" as const, label: "c2", port: 0, dbPath: ":memory:",
                  remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: null };
    const node = bootstrapNode(db, env);
    const app = buildApp({ db, env, node, runtime: createSyncRuntime() });

    const res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.json().model_grading_configured).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// Task 1.4 — GET /api/attempts/live-pending, so the app can discover a
// tutor-created app_live attempt to render.
// ----------------------------------------------------------------------------

describe("GET /api/attempts/live-pending", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof openTestDb>;

  beforeAll(async () => {
    db = openTestDb();
    const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:",
                  remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: null };
    const node = bootstrapNode(db, env);
    app = buildApp({ db, env, node, runtime: createSyncRuntime() });
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it("returns null when nothing is pending", async () => {
    const res = await app.inject({ method: "GET", url: "/api/attempts/live-pending" });
    expect(res.statusCode).toBe(200);
    expect(res.json().attempt).toBeNull();
  });

  it("returns the pending app_live attempt, not a chat_quick_check one", async () => {
    insertTag(db, "live-pending");
    const q1 = insertQuestion(db, { tags: ["live-pending"] });
    const q2 = insertQuestion(db, { tags: ["live-pending"] });

    // A chat_quick_check attempt should never surface here — it's for the
    // tutor's own chat-side flow, not something the app should render.
    createAttempt(
      db,
      { node_id: "n1", source: "adhoc", question_ids: [q1.id], delivery_mode: "chat_quick_check" },
      "canonical"
    );

    const presented = presentItem(db, { node_id: "n1", question_id: q2.id });

    const res = await app.inject({ method: "GET", url: "/api/attempts/live-pending" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.attempt).not.toBeNull();
    expect(body.attempt.id).toBe(presented.attempt_id);
    expect(body.attempt.source).toBe("adhoc");
  });

  it("does not return a submitted app_live attempt", async () => {
    const db2 = openTestDb();
    const env = { role: "canonical" as const, label: "c2", port: 0, dbPath: ":memory:",
                  remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: null };
    const node = bootstrapNode(db2, env);
    const app2 = buildApp({ db: db2, env, node, runtime: createSyncRuntime() });
    await app2.ready();

    insertTag(db2, "live-submitted");
    const q = insertQuestion(db2, { tags: ["live-submitted"] });
    const presented = presentItem(db2, { node_id: "n1", question_id: q.id });
    db2.prepare("UPDATE attempt SET submitted_at = datetime('now') WHERE id = ?").run(presented.attempt_id);

    const res = await app2.inject({ method: "GET", url: "/api/attempts/live-pending" });
    expect(res.json().attempt).toBeNull();

    await app2.close();
  });
});
