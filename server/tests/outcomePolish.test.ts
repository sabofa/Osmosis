import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../src/mcp/tools.js";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { createQuestions } from "../src/domain/questions.js";
import {
  presentItem,
  quickCheck,
  submitQuickCheck,
  answerResponse,
  submitAttempt,
  getItemOutcome,
  getAttemptDetail,
  gradeResponse,
  gradeResponseByTutor,
  pauseAttempt,
  resumeAttempt,
  sweepAbandonedAttempts,
} from "../src/domain/attempts.js";
import { getResults } from "../src/domain/results.js";
import { createSession, endSession } from "../src/domain/sessions.js";
import { readme } from "../src/domain/readme.js";
import { TOOLS_VERSION } from "../src/protocol.js";

type Db = ReturnType<typeof openTestDb>;

function expectDomainError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (err) {
    expect((err as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`expected a ${code} DomainError`);
}

async function connectedClient(db: Db): Promise<Client> {
  const server = new McpServer({ name: "osmosis-test", version: "1.0.0" });
  registerTools(server, db, "/tmp/osmosis-test-uploads", "test-node");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = (result as { content: { type: string; text: string }[] }).content;
  return { body: JSON.parse(content[0].text), isError: (result as { isError?: boolean }).isError === true };
}

function mcQuestion(db: Db, prompt = "2+2?") {
  return createQuestions(db, [
    {
      type: "mc",
      prompt,
      tags: ["a"],
      choices: [
        { body: "4", is_correct: true },
        { body: "5", is_correct: false, misconception: "off by one" },
      ],
    },
  ]).created[0]!;
}

function choiceId(db: Db, questionId: string, correct: boolean): string {
  return (
    db.prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = ?").get(questionId, correct ? 1 : 0) as {
      id: string;
    }
  ).id;
}

// ----------------------------------------------------------------------------
// §2.3 best guess
// ----------------------------------------------------------------------------

describe("best_guess_choice_id (§2.3)", () => {
  it("rejects a best guess without idk", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = mcQuestion(db);
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    expectDomainError(
      () => answerResponse(db, p.attempt_id, p.response_id, { best_guess_choice_id: choiceId(db, q.id, true) }),
      "best_guess_requires_idk"
    );
  });

  it("rejects a best guess that belongs to another question", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = mcQuestion(db);
    const other = mcQuestion(db, "other?");
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    expectDomainError(
      () =>
        answerResponse(db, p.attempt_id, p.response_id, {
          idk: true,
          best_guess_choice_id: choiceId(db, other.id, true),
        }),
      "invalid_choice"
    );
  });

  it("drops the guess when the learner takes the idk back and answers normally", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = mcQuestion(db);
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    const wrong = choiceId(db, q.id, false);
    answerResponse(db, p.attempt_id, p.response_id, { idk: true, best_guess_choice_id: wrong, skipped: true });

    // Switching back to a real answer must not leave the guess behind: it
    // would be graded as an ordinary answer *and* reported as a best guess.
    const patched = answerResponse(db, p.attempt_id, p.response_id, {
      idk: false,
      skipped: false,
      selected_choice_id: choiceId(db, q.id, true),
    });
    expect(patched.best_guess_choice_id).toBeNull();
    submitAttempt(db, p.attempt_id);

    const o = getItemOutcome(db, p.response_id);
    if (o.status !== "answered") throw new Error("expected answered");
    expect(o.outcome).toBe("correct");
    expect(o.best_guess_choice_id).toBeNull();
    expect(o.best_guess_correct).toBeNull();
  });

  it("never scores the guess: a correct guess after idk is still dont_know with score 0", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = mcQuestion(db);
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    const right = choiceId(db, q.id, true);
    answerResponse(db, p.attempt_id, p.response_id, { idk: true, best_guess_choice_id: right, skipped: true });
    submitAttempt(db, p.attempt_id);

    const o = getItemOutcome(db, p.response_id);
    if (o.status !== "answered") throw new Error("expected answered");
    expect(o.outcome).toBe("dont_know");
    expect(o.score).toBe(0);
    expect(o.best_guess_choice_id).toBe(right);
    expect(o.best_guess_correct).toBe(true);
  });

  it("is visible on all four read paths, with best_guess_correct computed from the key", async () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = mcQuestion(db);
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    const wrong = choiceId(db, q.id, false);
    const patched = answerResponse(db, p.attempt_id, p.response_id, { idk: true, best_guess_choice_id: wrong });
    expect(patched.best_guess_choice_id).toBe(wrong);
    // Whether the guess was right is answer-key material: withheld from the
    // in-progress attempt exactly like the question snapshot's key.
    const inProgress = getAttemptDetail(db, p.attempt_id) as { responses: Record<string, unknown>[] };
    expect(inProgress.responses[0]!.best_guess_choice_id).toBe(wrong);
    expect(inProgress.responses[0]!.best_guess_correct).toBeNull();
    submitAttempt(db, p.attempt_id);

    const outcome = getItemOutcome(db, p.response_id);
    if (outcome.status !== "answered") throw new Error("expected answered");
    expect(outcome.best_guess_correct).toBe(false);

    const detail = getAttemptDetail(db, p.attempt_id) as { responses: Record<string, unknown>[] };
    expect(detail.responses[0]!.best_guess_choice_id).toBe(wrong);
    expect(detail.responses[0]!.best_guess_correct).toBe(false);

    const questionScope = getResults(db, { scope: "question" }) as {
      questions: { recent_responses: Record<string, unknown>[] }[];
    };
    expect(questionScope.questions[0]!.recent_responses[0]!.best_guess_choice_id).toBe(wrong);
    expect(questionScope.questions[0]!.recent_responses[0]!.best_guess_correct).toBe(false);

    const attemptScope = getResults(db, { scope: "attempt" }) as {
      attempts: { responses: Record<string, unknown>[] }[];
    };
    expect(attemptScope.attempts[0]!.responses[0]!.best_guess_choice_id).toBe(wrong);
    expect(attemptScope.attempts[0]!.responses[0]!.best_guess_correct).toBe(false);
    expect(attemptScope.attempts[0]!.responses[0]!.outcome).toBe("dont_know");
  });

  it("reports best_guess_correct null when no guess was made", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = mcQuestion(db);
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    answerResponse(db, p.attempt_id, p.response_id, { idk: true });
    submitAttempt(db, p.attempt_id);
    const o = getItemOutcome(db, p.response_id);
    if (o.status !== "answered") throw new Error("expected answered");
    expect(o.best_guess_choice_id).toBeNull();
    expect(o.best_guess_correct).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// §2.4 confidence
// ----------------------------------------------------------------------------

describe("confidence_numeric (§2.4)", () => {
  it("documents the scale in readme and carries the numeric value on every outcome path", () => {
    const db = openTestDb();
    expect(readme(db).prompt_conventions.confidence_scale).toEqual({
      labels: ["unsure", "somewhat", "confident"],
      numeric: { unsure: 1, somewhat: 3, confident: 5 },
    });

    insertTag(db, "a");
    const q = insertQuestion(db, { type: "written", tags: ["a"] });
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    const patched = answerResponse(db, p.attempt_id, p.response_id, { response_text: "x", confidence: "somewhat" });
    expect(patched.confidence_numeric).toBe(3);
    submitAttempt(db, p.attempt_id);

    const o = getItemOutcome(db, p.response_id);
    if (o.status !== "answered") throw new Error("expected answered");
    expect(o.confidence_numeric).toBe(3);

    const detail = getAttemptDetail(db, p.attempt_id) as { responses: Record<string, unknown>[] };
    expect(detail.responses[0]!.confidence_numeric).toBe(3);

    const questionScope = getResults(db, { scope: "question" }) as {
      questions: { recent_responses: Record<string, unknown>[] }[];
    };
    expect(questionScope.questions[0]!.recent_responses[0]!.confidence_numeric).toBe(3);
  });

  it("is null when no confidence was recorded", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { type: "written", tags: ["a"] });
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    answerResponse(db, p.attempt_id, p.response_id, { response_text: "x" });
    submitAttempt(db, p.attempt_id);
    const o = getItemOutcome(db, p.response_id);
    if (o.status !== "answered") throw new Error("expected answered");
    expect(o.confidence_numeric).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// §2.8 paused
// ----------------------------------------------------------------------------

describe("pause/resume (§2.8)", () => {
  it("pauses, reports status paused, and refuses a second pause", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const p = presentItem(db, { node_id: "n", question_id: q.id });

    const paused = pauseAttempt(db, p.attempt_id);
    expect(typeof paused.paused_at).toBe("string");
    expectDomainError(() => pauseAttempt(db, p.attempt_id), "already_paused");

    const o = getItemOutcome(db, p.response_id);
    expect(o.status).toBe("paused");
    if (o.status !== "paused") throw new Error("expected paused");
    expect(o.paused_at).toBe(paused.paused_at);
  });

  it("accumulates paused_ms on resume and exposes both on the attempt", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const p = presentItem(db, { node_id: "n", question_id: q.id });

    pauseAttempt(db, p.attempt_id);
    db.prepare("UPDATE attempt SET paused_at = datetime('now', '-120 seconds') WHERE id = ?").run(p.attempt_id);
    const resumed = resumeAttempt(db, p.attempt_id);
    expect(resumed.paused_ms).toBe(120_000);
    expect(resumed.paused_at).toBeNull();

    const detail = getAttemptDetail(db, p.attempt_id) as { paused_at: string | null; paused_ms: number };
    expect(detail.paused_at).toBeNull();
    expect(detail.paused_ms).toBe(120_000);
    expect(getItemOutcome(db, p.response_id).status).toBe("pending");
  });

  it("never abandons a paused attempt, and counts paused time against the abandon window", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });

    const stillPaused = presentItem(db, { node_id: "n", question_id: q.id });
    db.prepare("UPDATE attempt SET started_at = datetime('now', '-30 hours') WHERE id = ?").run(stillPaused.attempt_id);
    pauseAttempt(db, stillPaused.attempt_id);
    sweepAbandonedAttempts(db);
    expect(getItemOutcome(db, stillPaused.response_id).status).toBe("paused");

    // 25h old, but 10h of that was paused — inside the 24h window once paused
    // time is discounted.
    const resumedAfterLongPause = presentItem(db, { node_id: "n", question_id: q.id });
    db.prepare("UPDATE attempt SET started_at = datetime('now', '-25 hours'), paused_ms = ? WHERE id = ?").run(
      10 * 3600 * 1000,
      resumedAfterLongPause.attempt_id
    );
    sweepAbandonedAttempts(db);
    expect(getItemOutcome(db, resumedAfterLongPause.response_id).status).toBe("pending");
  });

  it("auto-resumes when the learner answers a paused attempt", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const p = presentItem(db, { node_id: "n", question_id: q.id });

    pauseAttempt(db, p.attempt_id);
    db.prepare("UPDATE attempt SET paused_at = datetime('now', '-60 seconds') WHERE id = ?").run(p.attempt_id);
    answerResponse(db, p.attempt_id, p.response_id, { selected_choice_id: choiceId(db, q.id, true) });

    const detail = getAttemptDetail(db, p.attempt_id) as { paused_at: string | null; paused_ms: number };
    expect(detail.paused_at).toBeNull();
    expect(detail.paused_ms).toBe(60_000);
  });
});

// ----------------------------------------------------------------------------
// §2.9 grader
// ----------------------------------------------------------------------------

describe("grade_response (§2.9)", () => {
  it("records an oracle grade that supersedes a self grade and is distinguishable in get_results", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { type: "written", tags: ["a"] });
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    answerResponse(db, p.attempt_id, p.response_id, { response_text: "nine" });
    submitAttempt(db, p.attempt_id);
    gradeResponse(db, p.response_id, { grader: "self", score: 1 });

    const graded = gradeResponseByTutor(db, p.response_id, {
      grader: "oracle",
      score: 0.5,
      diagnosis: "conflated rate with total",
    });
    expect(graded.grader).toBe("oracle");
    expect(graded.score).toBe(0.5);

    const o = getItemOutcome(db, p.response_id);
    if (o.status !== "answered") throw new Error("expected answered");
    expect(o.score).toBe(0.5);
    expect(o.grader).toBe("oracle");
    expect(o.diagnosis).toBe("conflated rate with total");

    const questionScope = getResults(db, { scope: "question" }) as {
      questions: {
        graded_by: Record<string, number>;
        recent_responses: Record<string, unknown>[];
      }[];
    };
    expect(questionScope.questions[0]!.graded_by).toEqual({ self: 0, model: 0, oracle: 1, judge: 0, auto_mc: 0 });
    expect(questionScope.questions[0]!.recent_responses[0]!.grader).toBe("oracle");
    expect(questionScope.questions[0]!.recent_responses[0]!.diagnosis).toBe("conflated rate with total");
  });

  it("stores only the diagnosis on an mc item, leaving the auto_mc grade untouched", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = mcQuestion(db);
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    answerResponse(db, p.attempt_id, p.response_id, { selected_choice_id: choiceId(db, q.id, false) });
    submitAttempt(db, p.attempt_id);

    const graded = gradeResponseByTutor(db, p.response_id, { grader: "oracle", score: 1, diagnosis: "picked the trap" });
    expect(graded.grader).toBe("auto_mc");
    expect(graded.score).toBe(0);

    const o = getItemOutcome(db, p.response_id);
    if (o.status !== "answered") throw new Error("expected answered");
    expect(o.score).toBe(0);
    expect(o.grader).toBe("auto_mc");
    expect(o.diagnosis).toBe("picked the trap");
  });

  it("leaves an earlier diagnosis alone when a later grade omits one", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { type: "written", tags: ["a"] });
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    answerResponse(db, p.attempt_id, p.response_id, { response_text: "nine" });
    submitAttempt(db, p.attempt_id);

    gradeResponseByTutor(db, p.response_id, { grader: "judge", score: 0, diagnosis: "inverted the ratio" });
    const regraded = gradeResponseByTutor(db, p.response_id, { grader: "judge", score: 1 });
    expect(regraded.diagnosis).toBe("inverted the ratio");
    expect(regraded.score).toBe(1);
  });

  it("refuses to grade a response on an unsubmitted attempt", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { type: "written", tags: ["a"] });
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    answerResponse(db, p.attempt_id, p.response_id, { response_text: "nine" });
    expectDomainError(() => gradeResponseByTutor(db, p.response_id, { grader: "judge", score: 1 }), "attempt_not_submitted");
  });

  it("is exposed as an MCP tool", async () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { type: "written", tags: ["a"] });
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    answerResponse(db, p.attempt_id, p.response_id, { response_text: "nine" });
    submitAttempt(db, p.attempt_id);

    const client = await connectedClient(db);
    const { body, isError } = await callTool(client, "grade_response", {
      response_id: p.response_id,
      grader: "judge",
      score: 1,
      diagnosis: "right for the right reason",
    });
    expect(isError).toBe(false);
    expect(body.grader).toBe("judge");
    expect(body.diagnosis).toBe("right for the right reason");
  });
});

// ----------------------------------------------------------------------------
// §3.4 await_item_outcome timeout_s
// ----------------------------------------------------------------------------

describe("await_item_outcome timeout_s (§3.4)", () => {
  it("clamps timeout_s to at least 1s and returns pending within it", async () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const p = presentItem(db, { node_id: "n", question_id: q.id });

    const client = await connectedClient(db);
    const started = Date.now();
    const { body } = await callTool(client, "await_item_outcome", { response_id: p.response_id, timeout_s: 0 });
    const elapsed = Date.now() - started;
    expect(body.status).toBe("pending");
    expect(elapsed).toBeLessThan(5_000);
  });

  it("returns immediately with status paused for a paused item", async () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    pauseAttempt(db, p.attempt_id);

    const client = await connectedClient(db);
    const { body } = await callTool(client, "await_item_outcome", { response_id: p.response_id, timeout_s: 1 });
    expect(body.status).toBe("paused");
    expect(typeof body.paused_at).toBe("string");
  });
});

// ----------------------------------------------------------------------------
// §3.7 end_session summary
// ----------------------------------------------------------------------------

describe("end_session summary (§3.7)", () => {
  it("counts presented/answered/abandoned/dont_know and finalises pending items", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const mc = mcQuestion(db);
    const session = createSession(db, { name: "s" });

    const answered = presentItem(db, { node_id: "n", question_id: mc.id, session_id: session.id });
    answerResponse(db, answered.attempt_id, answered.response_id, { selected_choice_id: choiceId(db, mc.id, true) });
    submitAttempt(db, answered.attempt_id);

    const idk = presentItem(db, { node_id: "n", question_id: mc.id, session_id: session.id });
    answerResponse(db, idk.attempt_id, idk.response_id, { idk: true, skipped: true });
    submitAttempt(db, idk.attempt_id);

    const pending = presentItem(db, { node_id: "n", question_id: mc.id, session_id: session.id });

    const result = endSession(db, session.id);
    expect(result.summary).toEqual({ presented: 3, answered: 2, abandoned: 1, dont_know: 1, paused_now: false });
    expect(getItemOutcome(db, pending.response_id).status).toBe("abandoned");
  });

  it("does not count an idk answer as incorrect", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const mc = mcQuestion(db);
    const session = createSession(db, { name: "s" });
    const idk = presentItem(db, { node_id: "n", question_id: mc.id, session_id: session.id });
    answerResponse(db, idk.attempt_id, idk.response_id, { idk: true, skipped: true });
    submitAttempt(db, idk.attempt_id);

    const result = endSession(db, session.id);
    expect(result.summary).toEqual({ presented: 1, answered: 1, abandoned: 0, dont_know: 1, paused_now: false });
  });
});

// ----------------------------------------------------------------------------
// §3.8 tools_version
// ----------------------------------------------------------------------------

describe("readme node block (§3.8)", () => {
  it("reports tools_version, the sorted registered tool list, and push: false", async () => {
    const db = openTestDb();
    const client = await connectedClient(db);
    const { body } = await callTool(client, "readme", {});
    expect(body.node.tools_version).toBe(TOOLS_VERSION);
    expect(body.node.push).toBe(false);
    expect(body.node.tools).toContain("grade_response");
    expect(body.node.tools).toEqual([...body.node.tools].sort());
    const listed = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(body.node.tools).toEqual(listed);
  });
});

// ----------------------------------------------------------------------------
// submit_quick_check carries the same record
// ----------------------------------------------------------------------------

describe("submit_quick_check outcome record", () => {
  it("carries confidence_numeric, grader, diagnosis and best-guess fields", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { type: "written", tags: ["a"] });
    const qc = quickCheck(db, { node_id: "n", question_id: q.id });
    const r = submitQuickCheck(db, { response_id: qc.response_id, response_text: "nine", confidence: "confident" });
    expect(r.confidence_numeric).toBe(5);
    expect(r.grader).toBeNull();
    expect(r.diagnosis).toBeNull();
    expect(r.best_guess_choice_id).toBeNull();
    expect(r.best_guess_correct).toBeNull();
  });
});
