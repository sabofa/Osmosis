import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startModelGradingBackground } from "../src/grading/scheduler.js";
import { bootstrapNode } from "../src/node.js";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import type { AppContext } from "../src/http/app.js";
import { createSyncRuntime } from "../src/sync/client.js";
import { v4 as uuidv4 } from "uuid";

// scheduler.ts mirrors sync/client.ts's startSyncBackground timer pattern
// (see syncClient.test.ts): a 5-minute setInterval gated on env fields, driven
// here with fake timers rather than a real 5-minute wait.

function buildCtx(overrides: Partial<AppContext["env"]> = {}): AppContext {
  const db = openTestDb();
  const env = {
    role: "canonical" as const,
    label: "c",
    port: 0,
    dbPath: ":memory:",
    remoteUrl: null,
    uploadsDir: "/tmp",
    mcpAuthToken: "t",
    deepseekApiKey: "test-key",
    ...overrides,
  };
  const node = bootstrapNode(db, env);
  return { db, env, node, runtime: createSyncRuntime() };
}

describe("startModelGradingBackground", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("no-ops for a non-canonical role: returns {stop} and never calls fetch even past 5 minutes", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchSpy);

    const ctx = buildCtx({ role: "local", remoteUrl: "http://example.invalid" });
    const { stop } = startModelGradingBackground(ctx);

    await vi.advanceTimersByTimeAsync(6 * 60_000);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it("no-ops when deepseekApiKey is null: returns {stop} and never calls fetch even past 5 minutes", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchSpy);

    const ctx = buildCtx({ deepseekApiKey: null });
    const { stop } = startModelGradingBackground(ctx);

    await vi.advanceTimersByTimeAsync(6 * 60_000);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it("with role canonical and a real api key, attempts a sweep once 5 minutes elapse", async () => {
    const ctx = buildCtx();

    // written_grader defaults to 'self_only' (see migrations/008_model_grader_daily_limit.sql),
    // so flip it on before seeding an eligible written response.
    ctx.db.prepare("UPDATE config SET value = '\"model_when_online\"' WHERE key = 'written_grader'").run();
    insertTag(ctx.db, "sched");
    const q = insertQuestion(ctx.db, { type: "written", tags: ["sched"] });
    const attemptId = uuidv4();
    const responseId = uuidv4();
    ctx.db
      .prepare("INSERT INTO attempt (id, node_id, source, started_at) VALUES (?, 'n1', 'adhoc', datetime('now'))")
      .run(attemptId);
    ctx.db
      .prepare(
        "INSERT INTO response (id, attempt_id, question_id, ordinal, response_text, answered_at) VALUES (?, ?, ?, 0, 'my answer', datetime('now'))"
      )
      .run(responseId, attemptId, q.id);
    ctx.db
      .prepare("INSERT INTO grade (id, response_id, grader, score, graded_at) VALUES (?, ?, 'self', 0.5, datetime('now'))")
      .run(uuidv4(), responseId);

    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ score: 0.9, feedback: "great" }) } }],
      }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchSpy);

    const { stop } = startModelGradingBackground(ctx);
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.deepseek.com/chat/completions",
      expect.objectContaining({ method: "POST" })
    );

    const live = ctx.db
      .prepare("SELECT grader FROM grade WHERE response_id = ? AND superseded_at IS NULL")
      .get(responseId) as { grader: string };
    expect(live.grader).toBe("model");

    stop();
  });
});
