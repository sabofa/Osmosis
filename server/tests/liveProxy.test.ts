import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../src/db/migrate.js";
import { insertTag, insertQuestion } from "./helpers.js";
import { createSession } from "../src/domain/sessions.js";
import { presentItem } from "../src/domain/attempts.js";
import { shouldForward } from "../src/http/liveProxy.js";

function openFileDb(dir: string, name: string): DatabaseSync {
  const db = new DatabaseSync(join(dir, name));
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

describe("shouldForward", () => {
  const local = (id: string) => id === "mine";
  it("forwards sessions, shows, live-pending and foreign attempts; keeps the rest local", () => {
    expect(shouldForward("GET", "/api/sessions", local)).toBe(true);
    expect(shouldForward("GET", "/api/sessions/abc/events", local)).toBe(true);
    expect(shouldForward("POST", "/api/shows/x/seen", local)).toBe(true);
    expect(shouldForward("GET", "/api/attempts/live-pending?session_id=s", local)).toBe(true);
    expect(shouldForward("PATCH", "/api/attempts/theirs/responses/r", local)).toBe(true);
    expect(shouldForward("PATCH", "/api/attempts/mine/responses/r", local)).toBe(false);
    expect(shouldForward("GET", "/api/attempts", local)).toBe(false);
    expect(shouldForward("GET", "/api/templates", local)).toBe(false);
  });
});

describe("live sessions through a local node", () => {
  const dirs: string[] = [];
  const apps: { close: () => Promise<void> }[] = [];
  const dbs: DatabaseSync[] = [];
  afterEach(async () => {
    for (const a of apps.splice(0)) await a.close();
    for (const db of dbs.splice(0)) db.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("reads canonical's sessions and answers its live item from the local app", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osmosis-liveproxy-"));
    dirs.push(dir);
    const canonicalDb = openFileDb(dir, "c.db");
    dbs.push(canonicalDb);
    insertTag(canonicalDb, "geo");
    const q = insertQuestion(canonicalDb, { tags: ["geo"] });
    const cEnv = { role: "canonical" as const, label: "c", port: 0, dbPath: join(dir, "c.db"), remoteUrl: null,
                   uploadsDir: dir, mcpAuthToken: "t", webDistDir: null };
    const canonicalNode = bootstrapNode(canonicalDb, cEnv);
    const canonicalApp = buildApp({ db: canonicalDb, env: cEnv, node: canonicalNode, runtime: createSyncRuntime(), logger: false });
    apps.push(canonicalApp);
    const canonicalUrl = await canonicalApp.listen({ port: 0, host: "127.0.0.1" });

    const localDb = openFileDb(dir, "l.db");
    dbs.push(localDb);
    const env = { role: "local" as const, label: "l", port: 0, dbPath: join(dir, "l.db"), remoteUrl: canonicalUrl,
                  uploadsDir: dir, mcpAuthToken: null, webDistDir: null };
    const runtime = createSyncRuntime();
    runtime.online = true;
    const app = buildApp({ db: localDb, env, node: bootstrapNode(localDb, env), runtime, logger: false });
    apps.push(app);
    const localUrl = await app.listen({ port: 0, host: "127.0.0.1" });

    // The tutor's side, on canonical.
    const session = createSession(canonicalDb, { name: "Live from the server" });
    const presented = presentItem(canonicalDb, { node_id: canonicalNode.id, question_id: q.id, session_id: session.id });

    // The learner's side, on the local app.
    const list = await (await fetch(`${localUrl}/api/sessions`)).json() as { sessions: { id: string; name: string }[] };
    expect(list.sessions.map((s) => s.id)).toEqual([session.id]);

    const pending = await (await fetch(`${localUrl}/api/attempts/live-pending?session_id=${session.id}`)).json() as {
      attempt: { id: string } | null;
    };
    expect(pending.attempt?.id).toBe(presented.attempt_id);

    const choice = canonicalDb.prepare("SELECT id FROM choice WHERE question_id = ? ORDER BY ordinal LIMIT 1").get(q.id) as { id: string };
    const patched = await fetch(`${localUrl}/api/attempts/${presented.attempt_id}/responses/${presented.response_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selected_choice_id: choice.id, elapsed_ms: 1200 }),
    });
    expect(patched.status).toBe(200);
    const stored = canonicalDb
      .prepare("SELECT selected_choice_id, elapsed_ms FROM response WHERE id = ?")
      .get(presented.response_id) as { selected_choice_id: string; elapsed_ms: number };
    expect(stored).toEqual({ selected_choice_id: choice.id, elapsed_ms: 1200 });

    // The SSE stream comes through too: the first bytes are the retry line.
    const controller = new AbortController();
    const stream = await fetch(`${localUrl}/api/sessions/${session.id}/events`, {
      headers: { accept: "text/event-stream" },
      signal: controller.signal,
    });
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("retry:");
    controller.abort();

    // Offline, the same read is a 503 the app understands.
    runtime.online = false;
    const offline = await fetch(`${localUrl}/api/sessions`);
    expect(offline.status).toBe(503);
    expect(((await offline.json()) as { reason: string }).reason).toBe("requires_connection");
  });
});
