import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { migrate } from "../src/db/migrate.js";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { insertTag, insertQuestion } from "./helpers.js";

// File-backed (not :memory:) DB helper, matching syncDurability.test.ts's
// pattern: this suite needs real separate on-disk DBs and real listening
// HTTP servers to prove the daily-draw feature holds together across two
// distinct node processes talking over real HTTP.
function openFileDb(dir: string, name: string): DatabaseSync {
  const db = new DatabaseSync(join(dir, name));
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

describe("daily draws: same-date consistency across two nodes", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "osmosis-daily-"));
  });

  it("two local nodes requesting the same day's daily question get the identical question", async () => {
    const canonicalDb = openFileDb(dir, "c.db");
    insertTag(canonicalDb, "geo");
    for (let i = 0; i < 5; i++) insertQuestion(canonicalDb, { tags: ["geo"] });
    const cEnv = {
      role: "canonical" as const,
      label: "c",
      port: 0,
      dbPath: join(dir, "c.db"),
      remoteUrl: null,
      uploadsDir: dir,
      mcpAuthToken: "t", webDistDir: null,
    };
    const cNode = bootstrapNode(canonicalDb, cEnv);
    const canonicalApp = buildApp({ db: canonicalDb, env: cEnv, node: cNode, runtime: createSyncRuntime(), logger: false });
    const canonicalUrl = await canonicalApp.listen({ port: 0, host: "127.0.0.1" });

    async function localRequestsDaily(dbName: string): Promise<any> {
      const localDb = openFileDb(dir, dbName);
      const env = {
        role: "local" as const,
        label: dbName,
        port: 0,
        dbPath: join(dir, dbName),
        remoteUrl: canonicalUrl,
        uploadsDir: dir,
        mcpAuthToken: null, webDistDir: null,
      };
      const node = bootstrapNode(localDb, env);
      const runtime = createSyncRuntime();
      runtime.online = true;
      const app: FastifyInstance = buildApp({ db: localDb, env, node, runtime, logger: false });
      const res = await app.inject({ method: "POST", url: "/api/attempts", payload: { daily_kind: "question" } });
      const body = res.json();
      await app.close();
      return body;
    }

    const first = await localRequestsDaily("l1.db");
    const second = await localRequestsDaily("l2.db");

    expect(second.questions[0].id).toBe(first.questions[0].id);

    await canonicalApp.close();
  });

  it("a local node offline gets 503; the same node online afterward gets the draw", async () => {
    const canonicalDb = openFileDb(dir, "c2.db");
    insertTag(canonicalDb, "art");
    insertQuestion(canonicalDb, { tags: ["art"] });
    const cEnv = {
      role: "canonical" as const,
      label: "c2",
      port: 0,
      dbPath: join(dir, "c2.db"),
      remoteUrl: null,
      uploadsDir: dir,
      mcpAuthToken: "t", webDistDir: null,
    };
    const cNode = bootstrapNode(canonicalDb, cEnv);
    const canonicalApp = buildApp({ db: canonicalDb, env: cEnv, node: cNode, runtime: createSyncRuntime(), logger: false });
    const canonicalUrl = await canonicalApp.listen({ port: 0, host: "127.0.0.1" });

    const localDb = openFileDb(dir, "l3.db");
    const env = {
      role: "local" as const,
      label: "l3",
      port: 0,
      dbPath: join(dir, "l3.db"),
      remoteUrl: canonicalUrl,
      uploadsDir: dir,
      mcpAuthToken: null, webDistDir: null,
    };
    const node = bootstrapNode(localDb, env);
    const runtime = createSyncRuntime();
    runtime.online = false;
    const app = buildApp({ db: localDb, env, node, runtime, logger: false });

    const offlineRes = await app.inject({ method: "POST", url: "/api/attempts", payload: { daily_kind: "question" } });
    expect(offlineRes.statusCode).toBe(503);

    runtime.online = true;
    const onlineRes = await app.inject({ method: "POST", url: "/api/attempts", payload: { daily_kind: "question" } });
    expect(onlineRes.statusCode).toBe(200);

    await app.close();
    await canonicalApp.close();
  });
});
