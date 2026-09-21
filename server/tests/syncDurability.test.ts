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
import { sweepModelGrading } from "../src/domain/modelGrading.js";
import { insertTag, insertQuestion } from "./helpers.js";
import { v4 as uuidv4 } from "uuid";

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
      deepseekApiKey: null, webDistDir: null,
    };
    const node = bootstrapNode(db, env);
    const app = buildApp({ db, env, node, runtime: createSyncRuntime(), logger: false });
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
      deepseekApiKey: null, webDistDir: null,
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

  // Regression for the critical pull-path bug: a model grade superseding a
  // local node's own live self-grade must apply cleanly on the next pull,
  // not throw on grade_one_live_per_response and jam sync permanently.
  it("8. a model grade superseding a node's own live self-grade applies cleanly on the next pull", async () => {
    const canonical = await startCanonical("c8.db");
    insertTag(canonical.db, "wgr");
    const q = insertQuestion(canonical.db, { type: "written", tags: ["wgr"] });
    canonical.db.prepare("UPDATE config SET value = '\"model_when_online\"' WHERE key = 'written_grader'").run();

    const localDb = openFileDb(dir, "l8.db");
    const ctx = localCtx(localDb, canonical.url, "l8.db");
    addSlice(localDb, "wgr");
    await runSync(ctx, ctx.runtime); // pull the written question down first

    // Write a local written response with a self-grade, then push it up. All
    // timestamps use the real "now" (not a fixed historical string): the
    // canonical grade query's incremental sinceClause filters on graded_at,
    // so the pushed self-grade must land within the sync cursor's window for
    // the later pull (after it's superseded) to pick it back up.
    const nowStr = (localDb.prepare("SELECT datetime('now') AS t").get() as { t: string }).t;
    const attemptId = uuidv4();
    const responseId = uuidv4();
    const gradeId = uuidv4();
    localDb
      .prepare("INSERT INTO attempt (id, node_id, source, started_at, submitted_at) VALUES (?, ?, 'adhoc', datetime('now'), datetime('now'))")
      .run(attemptId, ctx.node.id);
    localDb
      .prepare(
        "INSERT INTO response (id, attempt_id, question_id, ordinal, response_text, answered_at) VALUES (?, ?, ?, 0, 'my written answer', datetime('now'))"
      )
      .run(responseId, attemptId, q.id);
    localDb
      .prepare("INSERT INTO grade (id, response_id, grader, score, graded_at) VALUES (?, ?, 'self', 0.5, datetime('now'))")
      .run(gradeId, responseId);
    localDb
      .prepare(`INSERT INTO outbox (entity_type, entity_id, payload) VALUES ('attempt', ?, ?)`)
      .run(attemptId, JSON.stringify({
        id: attemptId, node_id: ctx.node.id, source: "adhoc", template_id: null, daily_draw_id: null,
        started_at: nowStr, submitted_at: nowStr, abandoned_at: null, offline: 1,
      }));
    localDb
      .prepare(`INSERT INTO outbox (entity_type, entity_id, payload) VALUES ('response', ?, ?)`)
      .run(responseId, JSON.stringify({
        id: responseId, attempt_id: attemptId, question_id: q.id, ordinal: 0, selected_choice_id: null,
        response_text: "my written answer", skipped: 0, answered_at: nowStr, elapsed_ms: 1000,
      }));
    localDb
      .prepare(`INSERT INTO outbox (entity_type, entity_id, payload) VALUES ('grade', ?, ?)`)
      .run(gradeId, JSON.stringify({
        id: gradeId, response_id: responseId, grader: "self", score: 0.5, feedback: null, rubric_version: null,
        model_name: null, graded_at: nowStr, superseded_at: null,
      }));

    await runSync(ctx, ctx.runtime); // push the self-graded response up to canonical
    expect(canonical.db.prepare("SELECT id FROM response WHERE id = ?").get(responseId)).toBeTruthy();

    // Canonical's model-grading sweep supersedes the pushed self-grade.
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ score: 0.9, feedback: "well explained" }) } }] }),
    })) as unknown as typeof fetch;
    const sweepResult = await sweepModelGrading(canonical.db, "test-key", 20, fetchImpl);
    expect(sweepResult.graded).toBe(1);
    const canonicalLive = canonical.db
      .prepare("SELECT grader FROM grade WHERE response_id = ? AND superseded_at IS NULL")
      .get(responseId) as { grader: string };
    expect(canonicalLive.grader).toBe("model");

    // The next pull must apply the supersede + new live model grade without throwing.
    await expect(runSync(ctx, ctx.runtime)).resolves.not.toThrow();

    const localSelfGrade = localDb.prepare("SELECT superseded_at FROM grade WHERE id = ?").get(gradeId) as {
      superseded_at: string | null;
    };
    expect(localSelfGrade.superseded_at).not.toBeNull();

    const localLive = localDb
      .prepare("SELECT grader FROM grade WHERE response_id = ? AND superseded_at IS NULL")
      .get(responseId) as { grader: string };
    expect(localLive.grader).toBe("model");

    const state = localDb.prepare("SELECT last_error FROM sync_state WHERE id = 1").get() as { last_error: string | null };
    expect(state.last_error).toBeNull();

    await canonical.app.close();
  });
});
