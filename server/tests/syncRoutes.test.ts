import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";

describe("/sync/pull and /sync/push HTTP routes", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof openTestDb>;

  beforeAll(async () => {
    db = openTestDb();
    const env = { role: "canonical" as const, label: "test-canonical", port: 0, dbPath: ":memory:",
                  remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "test-token", webDistDir: null };
    const node = bootstrapNode(db, env);
    app = buildApp({ db, env, node, runtime: createSyncRuntime(), logger: false });
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it("POST /sync/pull returns matching tags and questions", async () => {
    insertTag(db, "math");
    insertQuestion(db, { tags: ["math"] });

    const res = await app.inject({
      method: "POST", url: "/sync/pull",
      payload: { node_id: "local-1", protocol_version: 1, slices: ["math"], since: null, include_grades_for_node: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.questions.length).toBe(1);
    expect(body.protocol_version).toBe(1);
  });

  it("POST /sync/push accepts a new attempt and replaying it returns duplicate", async () => {
    insertTag(db, "math2");
    const q = insertQuestion(db, { tags: ["math2"] });
    const payload = {
      node_id: "local-1", protocol_version: 1,
      attempts: [{ id: "http-a1", node_id: "local-1", source: "adhoc", template_id: null, daily_draw_id: null,
                   started_at: "2026-08-20 10:00:00", submitted_at: "2026-08-20 10:05:00", abandoned_at: null, offline: 1 }],
      responses: [{ id: "http-r1", attempt_id: "http-a1", question_id: q.id, ordinal: 0, selected_choice_id: null,
                    response_text: null, skipped: 0, answered_at: "2026-08-20 10:04:00", elapsed_ms: 1000 }],
      grades: [],
    };

    const first = await app.inject({ method: "POST", url: "/sync/push", payload });
    expect(first.json().accepted.sort()).toEqual(["http-a1", "http-r1"]);

    const second = await app.inject({ method: "POST", url: "/sync/push", payload });
    expect(second.json().duplicate.sort()).toEqual(["http-a1", "http-r1"]);
  });

  it("a local-role app does not mount /sync/pull or /sync/push", async () => {
    const localDb = openTestDb();
    const env = { role: "local" as const, label: "test-local", port: 0, dbPath: ":memory:",
                  remoteUrl: "http://localhost:9999", uploadsDir: "/tmp", mcpAuthToken: null, webDistDir: null };
    const node = bootstrapNode(localDb, env);
    const localApp = buildApp({ db: localDb, env, node, runtime: createSyncRuntime(), logger: false });
    await localApp.ready();

    const res = await localApp.inject({ method: "POST", url: "/sync/pull", payload: {} });
    expect(res.statusCode).toBe(404);

    await localApp.close();
  });
});
