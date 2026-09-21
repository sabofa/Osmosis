import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";

describe("GET /api/status last_write_at", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof openTestDb>;

  beforeAll(async () => {
    db = openTestDb();
    const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:",
                  remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t", webDistDir: null };
    app = buildApp({ db, env, node: bootstrapNode(db, env), runtime: createSyncRuntime(), logger: false });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("is null on an empty bank, then the latest write across tags, questions, attempts and assets", async () => {
    let res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.json().last_write_at).toBeNull();

    insertTag(db, "a");
    db.prepare("UPDATE tag SET created_at = '2026-01-01 00:00:00'").run();
    const q = insertQuestion(db, { tags: ["a"] });
    db.prepare("UPDATE question SET created_at = '2026-02-01 00:00:00' WHERE id = ?").run(q.id);
    db.prepare("INSERT INTO attempt (id, node_id, source, started_at, submitted_at) VALUES (?, 'n', 'adhoc', '2026-03-01 00:00:00', '2026-03-01 00:00:00')").run(uuidv4());

    res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.json().last_write_at).toBe("2026-03-01 00:00:00");
  });
});
