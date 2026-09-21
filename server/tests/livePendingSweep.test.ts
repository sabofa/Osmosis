import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { presentItem } from "../src/domain/attempts.js";
import { createSession } from "../src/domain/sessions.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";

describe("GET /api/attempts/live-pending", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof openTestDb>;

  beforeAll(async () => {
    db = openTestDb();
    const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:",
                  remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: null, webDistDir: null };
    const node = bootstrapNode(db, env);
    app = buildApp({ db, env, node, runtime: createSyncRuntime(), logger: false });
    await app.ready();
    insertTag(db, "bank");
    insertQuestion(db, { tags: ["bank"] });
  });

  afterAll(async () => { await app.close(); });

  it("does not hand the app an item that is past the abandonment window but not yet swept", async () => {
    const session = createSession(db, { name: "s" });
    const presented = presentItem(db, { node_id: "n", tag_query: { all: ["bank"] }, session_id: session.id });
    // Older than abandon_after_hours (24h default), but nothing has run the
    // lazy sweep since — the route must not surface it as live.
    db.prepare("UPDATE attempt SET started_at = datetime('now', '-48 hours') WHERE id = ?").run(presented.attempt_id);

    const res = await app.inject({ method: "GET", url: `/api/attempts/live-pending?session_id=${session.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().attempt).toBeNull();
  });

  it("returns 400 without a JSON body on POST /api/attempts instead of a 500", async () => {
    const res = await app.inject({ method: "POST", url: "/api/attempts" });
    expect(res.statusCode).toBe(400);
  });
});
