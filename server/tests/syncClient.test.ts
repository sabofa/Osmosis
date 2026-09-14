import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { runSync, checkConnectivity, createSyncRuntime } from "../src/sync/client.js";
import { addSlice, NEVER_PULLED } from "../src/domain/sync.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";

describe("local sync engine", () => {
  let canonicalApp: FastifyInstance;
  let canonicalUrl: string;
  let canonicalDb: ReturnType<typeof openTestDb>;

  beforeAll(async () => {
    canonicalDb = openTestDb();
    const env = { role: "canonical" as const, label: "c", port: 0, dbPath: ":memory:",
                  remoteUrl: null, uploadsDir: "/tmp", mcpAuthToken: "t", deepseekApiKey: null, webDistDir: null };
    const node = bootstrapNode(canonicalDb, env);
    canonicalApp = buildApp({ db: canonicalDb, env, node, runtime: createSyncRuntime() });
    const address = await canonicalApp.listen({ port: 0, host: "127.0.0.1" });
    canonicalUrl = address;
  });

  afterAll(async () => { await canonicalApp.close(); });

  it("checkConnectivity reports true when the remote is reachable", async () => {
    const localDb = openTestDb();
    const env = { role: "local" as const, label: "l", port: 0, dbPath: ":memory:",
                  remoteUrl: canonicalUrl, uploadsDir: "/tmp", mcpAuthToken: null, deepseekApiKey: null, webDistDir: null };
    const node = bootstrapNode(localDb, env);
    const runtime = createSyncRuntime();
    const ctx = { db: localDb, env, node, runtime };

    const online = await checkConnectivity(ctx, runtime);
    expect(online).toBe(true);
    expect(runtime.online).toBe(true);
  });

  it("checkConnectivity reports false for an unreachable remote", async () => {
    const localDb = openTestDb();
    const env = { role: "local" as const, label: "l2", port: 0, dbPath: ":memory:",
                  remoteUrl: "http://127.0.0.1:1", uploadsDir: "/tmp", mcpAuthToken: null, deepseekApiKey: null, webDistDir: null };
    const node = bootstrapNode(localDb, env);
    const runtime = createSyncRuntime();
    const ctx = { db: localDb, env, node, runtime };

    const online = await checkConnectivity(ctx, runtime);
    expect(online).toBe(false);
  });

  it("runSync pushes outbox rows then pulls matching slices, end to end", async () => {
    insertTag(canonicalDb, "sciX");
    const q = insertQuestion(canonicalDb, { tags: ["sciX"] });

    const localDb = openTestDb();
    const env = { role: "local" as const, label: "l3", port: 0, dbPath: ":memory:",
                  remoteUrl: canonicalUrl, uploadsDir: "/tmp", mcpAuthToken: null, deepseekApiKey: null, webDistDir: null };
    const node = bootstrapNode(localDb, env);
    addSlice(localDb, "sciX");
    localDb.prepare(
      `INSERT INTO outbox (entity_type, entity_id, payload) VALUES ('attempt', 'sync-a1', ?)`
    ).run(JSON.stringify({ id: "sync-a1", node_id: node.id, source: "adhoc", template_id: null, daily_draw_id: null,
                            started_at: "2026-08-20 10:00:00", submitted_at: "2026-08-20 10:05:00", abandoned_at: null, offline: 1 }));

    const runtime = createSyncRuntime();
    const ctx = { db: localDb, env, node, runtime };
    await runSync(ctx, runtime);

    // Pushed: outbox drained, attempt exists on canonical.
    const outboxCount = (localDb.prepare("SELECT COUNT(*) AS n FROM outbox").get() as { n: number }).n;
    expect(outboxCount).toBe(0);
    const remoteAttempt = canonicalDb.prepare("SELECT id FROM attempt WHERE id = 'sync-a1'").get();
    expect(remoteAttempt).toBeTruthy();

    // Pulled: local db now has the sciX question.
    const localQuestion = localDb.prepare("SELECT id FROM question WHERE id = ?").get(q.id);
    expect(localQuestion).toBeTruthy();
  });

  it("replaying runSync's push (e.g. after a mid-push crash) is safe — nothing duplicates on canonical", async () => {
    insertTag(canonicalDb, "sciY");
    const localDb = openTestDb();
    const env = { role: "local" as const, label: "l4", port: 0, dbPath: ":memory:",
                  remoteUrl: canonicalUrl, uploadsDir: "/tmp", mcpAuthToken: null, deepseekApiKey: null, webDistDir: null };
    const node = bootstrapNode(localDb, env);
    localDb.prepare(
      `INSERT INTO outbox (entity_type, entity_id, payload) VALUES ('attempt', 'sync-a2', ?)`
    ).run(JSON.stringify({ id: "sync-a2", node_id: node.id, source: "adhoc", template_id: null, daily_draw_id: null,
                            started_at: "2026-08-20 10:00:00", submitted_at: "2026-08-20 10:05:00", abandoned_at: null, offline: 1 }));

    const runtime = createSyncRuntime();
    const ctx = { db: localDb, env, node, runtime };
    await runSync(ctx, runtime); // first attempt: outbox row real, drains normally

    // Simulate a crash-before-drain by re-inserting the same outbox row and running again.
    localDb.prepare(
      `INSERT INTO outbox (entity_type, entity_id, payload) VALUES ('attempt', 'sync-a2', ?)`
    ).run(JSON.stringify({ id: "sync-a2", node_id: node.id, source: "adhoc", template_id: null, daily_draw_id: null,
                            started_at: "2026-08-20 10:00:00", submitted_at: "2026-08-20 10:05:00", abandoned_at: null, offline: 1 }));
    await runSync(ctx, runtime);

    const count = (canonicalDb.prepare("SELECT COUNT(*) AS n FROM attempt WHERE id = 'sync-a2'").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  // Finding 5 — a slice added while offline must backfill its *historical*
  // content once the node comes back online, not just what's new since the
  // last successful sync.
  it("backfills a slice added while offline, including questions predating the node's last sync", async () => {
    // Historical content: created on canonical BEFORE the local node ever
    // syncs this slice, so an incremental (since: last_pull_at) pull would
    // never return it.
    insertTag(canonicalDb, "sciBackfill");
    const historical = insertQuestion(canonicalDb, { tags: ["sciBackfill"] });
    // Genuinely historical: created long before this node's last_pull_at, so
    // the incremental pull's `created_at >= since` clause can never return it.
    // (Without this backdating the whole test runs inside one wall-clock
    // second and the incremental pull would pick it up regardless.)
    canonicalDb.prepare("UPDATE question SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(historical.id);

    const localDb = openTestDb();
    const env = { role: "local" as const, label: "l6", port: 0, dbPath: ":memory:",
                  remoteUrl: canonicalUrl, uploadsDir: "/tmp", mcpAuthToken: null, deepseekApiKey: null, webDistDir: null };
    const node = bootstrapNode(localDb, env);
    const runtime = createSyncRuntime();
    const ctx = { db: localDb, env, node, runtime };

    // An unrelated slice syncs successfully first, so sync_state.last_pull_at
    // is set — this is what makes the regular pull incremental and would
    // otherwise strand the offline-added slice's history.
    insertTag(canonicalDb, "sciOther");
    addSlice(localDb, "sciOther");
    await runSync(ctx, runtime);
    const stateAfterFirst = localDb.prepare("SELECT last_pull_at FROM sync_state WHERE id = 1").get() as {
      last_pull_at: string | null;
    };
    expect(stateAfterFirst.last_pull_at).not.toBeNull();

    // Now "go offline" and add a slice: POST /api/slices calls addSlice, then
    // pullOneSlice which fails. Simulate by pointing at a dead remote.
    const offlineCtx = { ...ctx, env: { ...env, remoteUrl: "http://127.0.0.1:1" } };
    addSlice(localDb, "sciBackfill");
    await expect(
      (async () => {
        const { pullOneSlice } = await import("../src/sync/client.js");
        await pullOneSlice(offlineCtx, "sciBackfill");
      })()
    ).rejects.toThrow();

    // Offline path leaves the slice at the sentinel.
    const sliceOffline = localDb.prepare("SELECT pulled_at FROM local_slice WHERE tag_slug = 'sciBackfill'").get() as {
      pulled_at: string;
    };
    expect(sliceOffline.pulled_at).toBe(NEVER_PULLED);
    expect(localDb.prepare("SELECT id FROM question WHERE id = ?").get(historical.id)).toBeUndefined();

    // Back online: runSync must issue a full backfill pull for the sentinel slice.
    await runSync(ctx, runtime);

    expect(localDb.prepare("SELECT id FROM question WHERE id = ?").get(historical.id)).toBeTruthy();
    const sliceAfter = localDb.prepare(
      "SELECT pulled_at, question_count FROM local_slice WHERE tag_slug = 'sciBackfill'"
    ).get() as { pulled_at: string; question_count: number };
    expect(sliceAfter.pulled_at).not.toBe(NEVER_PULLED);
    expect(sliceAfter.question_count).toBe(1);
  });

  it("a push failure's last_error survives a subsequent successful pull in the same runSync call", async () => {
    // The bug: runSync's pull-success branch unconditionally clears sync_state.last_error,
    // even when the push half of the *same* call failed with an HTTP error. That hides a
    // stuck outbox behind a null last_error in /api/status.
    //
    // To reproduce an HTTP-level push failure without a real network fault, we front the
    // real canonical app with a tiny proxy: POST /sync/push always returns 500, while every
    // other path (in particular /sync/pull) is forwarded verbatim to the real canonical
    // instance so the pull half of runSync succeeds normally against real data. This isolates
    // exactly the scenario the bug report describes — push fails at the HTTP layer, pull
    // succeeds right after, in the same runSync call — without needing to make
    // applyPushRequest throw or fabricating a fake PullResponse by hand.
    const proxy = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/sync/push") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "simulated push failure" }));
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        const upstream = http.request(
          canonicalUrl + req.url,
          { method: req.method, headers: req.headers },
          (upstreamRes) => {
            res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
            upstreamRes.pipe(res);
          }
        );
        upstream.on("error", () => { res.writeHead(502); res.end(); });
        upstream.end(body.length > 0 ? body : undefined);
      });
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

    try {
      insertTag(canonicalDb, "sciZ");
      const q = insertQuestion(canonicalDb, { tags: ["sciZ"] });

      const localDb = openTestDb();
      const env = { role: "local" as const, label: "l5", port: 0, dbPath: ":memory:",
                    remoteUrl: proxyUrl, uploadsDir: "/tmp", mcpAuthToken: null, deepseekApiKey: null, webDistDir: null };
      const node = bootstrapNode(localDb, env);
      addSlice(localDb, "sciZ");
      // Seed an outbox row so the push half of runSync actually has something to send
      // (an empty outbox is treated as "nothing to push", which counts as push-ok).
      localDb.prepare(
        `INSERT INTO outbox (entity_type, entity_id, payload) VALUES ('attempt', 'sync-a3', ?)`
      ).run(JSON.stringify({ id: "sync-a3", node_id: node.id, source: "adhoc", template_id: null, daily_draw_id: null,
                              started_at: "2026-08-20 10:00:00", submitted_at: "2026-08-20 10:05:00", abandoned_at: null, offline: 1 }));

      const runtime = createSyncRuntime();
      const ctx = { db: localDb, env, node, runtime };
      await runSync(ctx, runtime);

      // Push failed at the HTTP layer: outbox row is still stuck (not drained).
      const outboxCount = (localDb.prepare("SELECT COUNT(*) AS n FROM outbox").get() as { n: number }).n;
      expect(outboxCount).toBe(1);

      // Pull succeeded (question was fetched from the real canonical via the proxy).
      const localQuestion = localDb.prepare("SELECT id FROM question WHERE id = ?").get(q.id);
      expect(localQuestion).toBeTruthy();

      // The push failure's error must still be visible — not clobbered by the pull success.
      const state = localDb.prepare("SELECT last_error FROM sync_state WHERE id = 1").get() as { last_error: string | null };
      expect(state.last_error).toMatch(/push failed/);
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });
});
