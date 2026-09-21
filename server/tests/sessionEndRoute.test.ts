import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { createSession } from "../src/domain/sessions.js";
import { readme } from "../src/domain/readme.js";
import { openTestDb } from "./helpers.js";

// ----------------------------------------------------------------------------
// Task 6, §6.1/§5.4 — the app can close a session the tutor walked away from,
// and every place that advertises this node's capabilities says push is on.
// ----------------------------------------------------------------------------

describe("POST /api/sessions/:id/end", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof openTestDb>;

  beforeAll(async () => {
    db = openTestDb();
    const env = {
      role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:",
      remoteUrl: null, uploadsDir: ".", mcpAuthToken: "t", deepseekApiKey: null, webDistDir: null,
    };
    const node = bootstrapNode(db, env);
    app = buildApp({ db, env, node, runtime: createSyncRuntime() });
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it("closes an open session with no body at all", async () => {
    const s = createSession(db, { name: "Left open" });
    const res = await app.inject({ method: "POST", url: `/api/sessions/${s.id}/end` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; ended_at: string; summary_text: string | null };
    expect(body.id).toBe(s.id);
    expect(body.ended_at).toBeTruthy();
    expect(body.summary_text).toBeNull();

    const detail = (await app.inject({ method: "GET", url: `/api/sessions/${s.id}` })).json() as {
      status: string;
      ended_at: string | null;
      summary: string | null;
    };
    expect(detail.status).toBe("closed");
    expect(detail.summary).toBeNull();
  });

  it("stores a summary passed in the body and serves it back on the detail", async () => {
    const s = createSession(db, { name: "With words" });
    const res = await app.inject({
      method: "POST",
      url: `/api/sessions/${s.id}/end`,
      payload: { summary: "We finished **limits**." },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { summary_text: string }).summary_text).toBe("We finished **limits**.");

    const detail = (await app.inject({ method: "GET", url: `/api/sessions/${s.id}` })).json() as { summary: string };
    expect(detail.summary).toBe("We finished **limits**.");
  });

  it("404s an unknown session and 400s one that already ended", async () => {
    expect((await app.inject({ method: "POST", url: "/api/sessions/nope/end" })).statusCode).toBe(404);

    const s = createSession(db, { name: "Twice" });
    await app.inject({ method: "POST", url: `/api/sessions/${s.id}/end` });
    const second = await app.inject({ method: "POST", url: `/api/sessions/${s.id}/end` });
    expect(second.statusCode).toBe(400);
    expect((second.json() as { error: string }).error).toBe("already_ended");
  });

  it("reports push: true everywhere this node describes itself", async () => {
    expect(readme(db).node.push).toBe(true);

    const health = (await app.inject({ method: "GET", url: "/sync/health" })).json() as { push: boolean };
    expect(health.push).toBe(true);

    const status = (await app.inject({ method: "GET", url: "/api/status" })).json() as { push: boolean };
    expect(status.push).toBe(true);
  });
});
