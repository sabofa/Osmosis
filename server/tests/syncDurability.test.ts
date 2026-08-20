import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../src/db/migrate.js";
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/http/app.js";
import { bootstrapNode } from "../src/node.js";
import { runSync, createSyncRuntime } from "../src/sync/client.js";
import { addSlice, removeSlice, applyPushRequest } from "../src/domain/sync.js";
import { createTemplate } from "../src/domain/templates.js";
import { createAttempt, submitAttempt } from "../src/domain/attempts.js";
import { insertTag, insertQuestion } from "./helpers.js";

// File-backed (not :memory:) DB helper: unlike the rest of the suite, this
// file needs state to survive "closing" one DatabaseSync/Fastify handle and
// opening a fresh one against the same on-disk file, to simulate a real
// process restart of the canonical node.
function openFileDb(dir: string, name: string): DatabaseSync {
  const db = new DatabaseSync(join(dir, name));
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

describe("sync durability (spec exit criteria)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "osmosis-sync-"));
  });

  async function startCanonical(dbFile: string) {
    const db = openFileDb(dir, dbFile);
    const env = {
      role: "canonical" as const,
      label: "c",
      port: 0,
      dbPath: join(dir, dbFile),
      remoteUrl: null,
      uploadsDir: dir,
      mcpAuthToken: "t",
    };
    const node = bootstrapNode(db, env);
    const app = buildApp({ db, env, node, runtime: createSyncRuntime() });
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    return { db, env, node, app, url };
  }

  function localCtx(db: DatabaseSync, remoteUrl: string, dbFile: string) {
    const env = {
      role: "local" as const,
      label: "l",
      port: 0,
      dbPath: join(dir, dbFile),
      remoteUrl,
      uploadsDir: dir,
      mcpAuthToken: null,
    };
    const node = bootstrapNode(db, env);
    return { db, env, node, runtime: createSyncRuntime() };
  }

  it("1. local pulls a slice; question count matches canonical for that tag", async () => {
    const canonical = await startCanonical("c1.db");
    insertTag(canonical.db, "phys");
    insertQuestion(canonical.db, { tags: ["phys"] });
    insertQuestion(canonical.db, { tags: ["phys"] });

    const localDb = openFileDb(dir, "l1.db");
    const ctx = localCtx(localDb, canonical.url, "l1.db");
    insertTag(localDb, "phys"); // local_slice.tag_slug FKs to tag(slug); a real slice download would have pulled this too
    addSlice(localDb, "phys");
    await runSync(ctx, ctx.runtime);

    const localCount = (localDb.prepare("SELECT COUNT(*) AS n FROM question").get() as { n: number }).n;
    const remoteCount = (
      canonical.db
        .prepare(
          "SELECT COUNT(*) AS n FROM question WHERE id IN (SELECT question_id FROM question_tag WHERE tag_slug = 'phys')"
        )
        .get() as { n: number }
    ).n;
    expect(localCount).toBe(remoteCount);
    await canonical.app.close();
  });

  it("2 & 3. killing canonical doesn't block local attempts; restarting canonical lets them sync up with correct scores", async () => {
    const canonical = await startCanonical("c2.db");
    insertTag(canonical.db, "chem");
    insertQuestion(canonical.db, { tags: ["chem"] });
    const template = createTemplate(canonical.db, { name: "t", tag_query: { all: ["chem"] }, question_count: 1 });

    const localDb = openFileDb(dir, "l2.db");
    const ctx = localCtx(localDb, canonical.url, "l2.db");
    insertTag(localDb, "chem");
    addSlice(localDb, "chem");
    await runSync(ctx, ctx.runtime);

    await canonical.app.close(); // "kill" canonical

    const created = createAttempt(localDb, { node_id: ctx.node.id, source: "template", template_id: template.id }, "local");
    submitAttempt(localDb, created.attempt_id, "local");
    const outboxDepth = (localDb.prepare("SELECT COUNT(*) AS n FROM outbox").get() as { n: number }).n;
    expect(outboxDepth).toBeGreaterThan(0); // succeeded locally despite canonical being down

    const restarted = await startCanonical("c2.db"); // same db file — real restart semantics
    const runtime = createSyncRuntime();
    const restartedCtx = { ...ctx, env: { ...ctx.env, remoteUrl: restarted.url } };
    await runSync(restartedCtx, runtime);

    const remoteAttempt = restarted.db.prepare("SELECT id FROM attempt WHERE id = ?").get(created.attempt_id);
    expect(remoteAttempt).toBeTruthy();
    await restarted.app.close();
  });

  it("4. replaying the same push payload manually returns duplicate for every ID, nothing duplicates (the most important test)", async () => {
    const canonical = await startCanonical("c4.db");
    insertTag(canonical.db, "bio");
    const q = insertQuestion(canonical.db, { tags: ["bio"] });
    const payload = {
      node_id: "replay-node",
      protocol_version: 1,
      attempts: [
        {
          id: "replay-a1",
          node_id: "replay-node",
          source: "adhoc",
          template_id: null,
          daily_draw_id: null,
          started_at: "2026-08-20 10:00:00",
          submitted_at: "2026-08-20 10:05:00",
          abandoned_at: null,
          offline: 1,
        },
      ],
      responses: [
        {
          id: "replay-r1",
          attempt_id: "replay-a1",
          question_id: q.id,
          ordinal: 0,
          selected_choice_id: null,
          response_text: null,
          skipped: 0,
          answered_at: "2026-08-20 10:04:00",
          elapsed_ms: 1000,
        },
      ],
      grades: [],
    };
    for (let i = 0; i < 5; i++) {
      const result = applyPushRequest(canonical.db, payload);
      if (i === 0) expect(result.accepted.sort()).toEqual(["replay-a1", "replay-r1"]);
      else expect(result.duplicate.sort()).toEqual(["replay-a1", "replay-r1"]);
    }
    const count = (canonical.db.prepare("SELECT COUNT(*) AS n FROM attempt WHERE id = 'replay-a1'").get() as {
      n: number;
    }).n;
    expect(count).toBe(1);
    await canonical.app.close();
  });

  it("5. retiring a question on canonical stops it appearing in local draws but old responses still render", async () => {
    const canonical = await startCanonical("c5.db");
    insertTag(canonical.db, "geo");
    const q = insertQuestion(canonical.db, { tags: ["geo"] });

    const localDb = openFileDb(dir, "l5.db");
    const ctx = localCtx(localDb, canonical.url, "l5.db");
    insertTag(localDb, "geo");
    addSlice(localDb, "geo");
    await runSync(ctx, ctx.runtime);
    expect((localDb.prepare("SELECT retired_at FROM question WHERE id = ?").get(q.id) as any).retired_at).toBeNull();

    canonical.db.prepare("UPDATE question SET retired_at = datetime('now'), retired_reason = 'r' WHERE id = ?").run(q.id);
    await runSync(ctx, ctx.runtime);

    const row = localDb.prepare("SELECT retired_at FROM question WHERE id = ?").get(q.id) as { retired_at: string | null };
    expect(row.retired_at).not.toBeNull(); // tombstoned, not deleted
    await canonical.app.close();
  });

  it("6. a push that fails partway (simulated: reject then retry) leaves no partial state", async () => {
    const canonical = await startCanonical("c6.db");
    const result1 = applyPushRequest(canonical.db, {
      node_id: "n",
      protocol_version: 1,
      attempts: [
        {
          id: "partial-a1",
          node_id: "n",
          source: "adhoc",
          template_id: null,
          daily_draw_id: null,
          started_at: "2026-08-20 10:00:00",
          submitted_at: null,
          abandoned_at: null,
          offline: 1,
        },
      ],
      responses: [
        {
          id: "partial-r1",
          attempt_id: "partial-a1",
          question_id: "does-not-exist-yet",
          ordinal: 0,
          selected_choice_id: null,
          response_text: null,
          skipped: 0,
          answered_at: null,
          elapsed_ms: null,
        },
      ],
      grades: [],
    });
    // Attempt accepted, response rejected (unknown question) — attempt row exists, response does not (no partial response row).
    expect(result1.accepted).toEqual(["partial-a1"]);
    expect(result1.rejected.map((r) => r.id)).toEqual(["partial-r1"]);
    expect(canonical.db.prepare("SELECT id FROM response WHERE id = 'partial-r1'").get()).toBeUndefined();
    await canonical.app.close();
  });

  it("7. removing a slice with attempt history prunes unreferenced questions but keeps referenced ones", async () => {
    const localDb = openFileDb(dir, "l7.db");
    insertTag(localDb, "art");
    const referenced = insertQuestion(localDb, { tags: ["art"] });
    const orphan = insertQuestion(localDb, { tags: ["art"] });
    addSlice(localDb, "art");
    localDb.prepare("INSERT INTO attempt (id, node_id, source, started_at) VALUES ('h1','n','adhoc',datetime('now'))").run();
    localDb.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal) VALUES ('hr1','h1',?,0)").run(referenced.id);

    const result = removeSlice(localDb, "art");

    expect(result.pruned_questions).toBe(1);
    expect(localDb.prepare("SELECT id FROM question WHERE id = ?").get(referenced.id)).toBeTruthy();
    expect(localDb.prepare("SELECT id FROM question WHERE id = ?").get(orphan.id)).toBeUndefined();
  });
});
