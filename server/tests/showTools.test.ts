import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/http/app.js";
import { openTestDb } from "./helpers.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { acknowledgeShow } from "../src/domain/shows.js";
import type { EnvConfig } from "../src/env.js";

// ----------------------------------------------------------------------------
// Task 8, §5.1/§5.2 — the show tools over the real MCP transport, including
// await_show_outcome's polling loop, which is the only part of the three that
// is more than a thin wrapper over the domain.
// ----------------------------------------------------------------------------

const TOKEN = "show-tools-token";

describe("the show tools over MCP", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let db: ReturnType<typeof openTestDb>;

  async function call(name: string, args: unknown): Promise<any> {
    const res = await fetch(`${baseUrl}/mcp/${TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const raw = await res.text();
    const dataLine = raw.split("\n").find((line) => line.startsWith("data:"));
    const envelope = JSON.parse(dataLine ? dataLine.slice("data:".length).trim() : raw);
    return JSON.parse(envelope.result.content[0].text);
  }

  beforeAll(async () => {
    db = openTestDb();
    const env: EnvConfig = {
      role: "canonical",
      label: "test-canonical",
      port: 0,
      dbPath: ":memory:",
      remoteUrl: null,
      uploadsDir: ".",
      mcpAuthToken: TOKEN,
      deepseekApiKey: null,
      webDistDir: null,
    };
    const node = bootstrapNode(db, env);
    app = buildApp({ db, env, node, runtime: createSyncRuntime(), logger: false });
    baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close();
  });

  it("presents, updates and waits on a graph show", async () => {
    const session = await call("create_session", { name: "showing" });
    const show = await call("present_show", {
      session_id: session.id,
      kind: "graph",
      payload: "y = x^2",
      caption: "the parabola",
      context: { course: "algebra", step: "worked example", timer_s: 45 },
    });
    expect(show.show_id).toBeTruthy();
    expect(show.presented_at).toBeTruthy();

    const updated = await call("update_show", { show_id: show.show_id, payload: "y = x^3" });
    expect(updated).toMatchObject({ show_id: show.show_id, kind: "graph" });
    expect(updated.updated_at).toBeTruthy();

    // Nothing has happened on the learner's side: the wait runs its shortest
    // window and reports pending rather than hanging.
    const pending = await call("await_show_outcome", { show_id: show.show_id, timeout_s: 1 });
    expect(pending).toMatchObject({ status: "pending", seen_at: null, acknowledged_at: null });

    // Acknowledged before the wait starts: it returns at once with the record.
    acknowledgeShow(db, show.show_id, 7000);
    const done = await call("await_show_outcome", { show_id: show.show_id, timeout_s: 25 });
    expect(done).toMatchObject({ status: "acknowledged", dwell_ms: 7000 });
    expect(done.acknowledged_at).toBeTruthy();
  });

  it("returns the domain's rejection for a bad spec and a non-graph update", async () => {
    const session = await call("create_session", { name: "rejections" });
    const bad = await call("present_show", {
      session_id: session.id,
      kind: "graph",
      payload: "!!! not a spec !!!",
    });
    expect(bad.error).toBe("invalid_graph_spec");

    const text = await call("present_show", { session_id: session.id, kind: "text", payload: "hello" });
    const refused = await call("update_show", { show_id: text.show_id, payload: "goodbye" });
    expect(refused.error).toBe("update_not_supported");

    const missing = await call("await_show_outcome", { show_id: "nope", timeout_s: 1 });
    expect(missing.error).toBe("not_found");
  });

  it("counts its shows in end_session's summary", async () => {
    const session = await call("create_session", { name: "counted" });
    await call("present_show", { session_id: session.id, kind: "text", payload: "a" });
    await call("present_show", { session_id: session.id, kind: "markdown", payload: "**b**" });
    const ended = await call("end_session", { session_id: session.id });
    expect(ended.summary.shows).toBe(2);
    expect(ended.summary.presented).toBe(0);
  });
});
