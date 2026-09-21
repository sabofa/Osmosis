import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { buildApp } from "../src/http/app.js";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { createSession } from "../src/domain/sessions.js";
import { presentItem } from "../src/domain/attempts.js";
import { sessionEventListenerCount } from "../src/lib/events.js";
import type { EnvConfig } from "../src/env.js";

// ----------------------------------------------------------------------------
// Task 6, §5.4 — GET /api/sessions/:id/events over a real listener. app.inject
// can't read a never-ending response, so this boots the server on port 0 and
// reads the stream with fetch, the way the browser's EventSource does.
// ----------------------------------------------------------------------------

const env: EnvConfig = {
  role: "canonical",
  label: "test-canonical",
  port: 0,
  dbPath: ":memory:",
  remoteUrl: null,
  uploadsDir: ".",
  mcpAuthToken: "test-token-123",
  deepseekApiKey: null,
  webDistDir: null,
};

describe("GET /api/sessions/:id/events", () => {
  let app: FastifyInstance;
  let db: DatabaseSync;
  let baseUrl: string;

  beforeAll(async () => {
    db = openTestDb();
    const node = bootstrapNode(db, env);
    app = buildApp({ db, env, node, runtime: createSyncRuntime(), logger: false });
    baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close();
  });

  it("404s for a session that does not exist", async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nope/events`);
    expect(res.status).toBe(404);
    await res.text();
  });

  it("streams item_presented to a subscribed client, with the SSE headers a proxy needs", async () => {
    insertTag(db, "algebra");
    const q = insertQuestion(db, { tags: ["algebra"] });
    const session = createSession(db, { name: "Streamed" });

    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/sessions/${session.id}/events`, { signal: controller.signal });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // The preamble: the browser's reconnect delay, sent before anything else.
    const first = decoder.decode((await reader.read()).value);
    expect(first).toContain("retry: 2000");

    // Wait for the server to actually register the listener before writing.
    await waitFor(() => sessionEventListenerCount(session.id) === 1);

    const item = presentItem(db, { node_id: "test-node", question_id: q.id, session_id: session.id });

    let buffered = first;
    while (!buffered.includes("item_presented")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value);
    }

    expect(buffered).toContain("event: item_presented");
    expect(buffered).toContain("id: 1");
    const dataLine = buffered.split("\n").find((l) => l.startsWith("data: "))!;
    const payload = JSON.parse(dataLine.slice("data: ".length)) as Record<string, unknown>;
    expect(payload.type).toBe("item_presented");
    expect(payload.attempt_id).toBe(item.attempt_id);
    expect(payload.response_id).toBe(item.response_id);
    expect(typeof payload.at).toBe("string");

    controller.abort();
    await reader.cancel().catch(() => {});

    // The listener has to go with the client, or every reconnect leaks one.
    await waitFor(() => sessionEventListenerCount(session.id) === 0);
    expect(sessionEventListenerCount(session.id)).toBe(0);
  });
});

describe("app.close() with a stream still open", () => {
  it("ends the stream and drops its listener instead of hanging the close", async () => {
    const db2 = openTestDb();
    const node = bootstrapNode(db2, env);
    const app2 = buildApp({ db: db2, env, node, runtime: createSyncRuntime(), logger: false });
    const url = await app2.listen({ port: 0, host: "127.0.0.1" });
    const session = createSession(db2, { name: "Closing" });

    const res = await fetch(`${url}/api/sessions/${session.id}/events`);
    const reader = res.body!.getReader();
    await reader.read();
    await waitFor(() => sessionEventListenerCount(session.id) === 1);

    await app2.close();

    expect(sessionEventListenerCount(session.id)).toBe(0);
    await reader.cancel().catch(() => {});
  }, 10_000);
});

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor timed out");
}
