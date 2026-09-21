import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import {
  presentItem,
  answerResponse,
  submitAttempt,
  getAttemptDetail,
  getItemOutcome,
} from "../src/domain/attempts.js";
import { createSession, endSession } from "../src/domain/sessions.js";
import { createQuestions, searchQuestions, getQuestionDetail } from "../src/domain/questions.js";
import { getEligibleQuestions } from "../src/domain/draw.js";
import { readme } from "../src/domain/readme.js";
import { bootstrap } from "../src/domain/bootstrap.js";
import { DomainError } from "../src/domain/errors.js";

function mcQuestion(overrides: Record<string, unknown> = {}) {
  return {
    type: "mc",
    prompt: "What is 2 + 2?",
    tags: ["a"],
    choices: [
      { body: "4", is_correct: true },
      { body: "5", is_correct: false, misconception: "off by one" },
    ],
    explanation: "because it is",
    ...overrides,
  };
}

function answerAndSubmit(db: ReturnType<typeof openTestDb>, attemptId: string, responseId: string): void {
  const choice = db
    .prepare(
      "SELECT c.id FROM choice c JOIN response r ON r.question_id = c.question_id WHERE r.id = ? AND c.is_correct = 0"
    )
    .get(responseId) as { id: string };
  answerResponse(db, attemptId, responseId, { selected_choice_id: choice.id });
  submitAttempt(db, attemptId);
}

// ----------------------------------------------------------------------------
// §3.1 reveal
// ----------------------------------------------------------------------------

describe("reveal (§3.1)", () => {
  it("takes the session's reveal_default when present_item doesn't say", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const session = createSession(db, { name: "s", reveal_default: "deferred" });

    const item = presentItem(db, { node_id: "n", question_id: q.id, session_id: session.id });
    const row = db.prepare("SELECT reveal FROM attempt WHERE id = ?").get(item.attempt_id) as { reveal: string };
    expect(row.reveal).toBe("deferred");
  });

  it("lets present_item's own reveal override the session default, both ways", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q1 = insertQuestion(db, { tags: ["a"] });
    const q2 = insertQuestion(db, { tags: ["a"] });
    const deferredSession = createSession(db, { name: "d", reveal_default: "deferred" });
    const plainSession = createSession(db, { name: "p" });

    const a = presentItem(db, { node_id: "n", question_id: q1.id, session_id: deferredSession.id, reveal: "immediate" });
    const b = presentItem(db, { node_id: "n", question_id: q2.id, session_id: plainSession.id, reveal: "deferred" });

    const read = (id: string) => (db.prepare("SELECT reveal FROM attempt WHERE id = ?").get(id) as { reveal: string }).reveal;
    expect(read(a.attempt_id)).toBe("immediate");
    expect(read(b.attempt_id)).toBe("deferred");
  });

  it("defaults to immediate with no session and no reveal", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const item = presentItem(db, { node_id: "n", question_id: q.id });
    const row = db.prepare("SELECT reveal FROM attempt WHERE id = ?").get(item.attempt_id) as { reveal: string };
    expect(row.reveal).toBe("immediate");
  });

  it("withholds the answer key from the learner while a deferred attempt's session is open", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const session = createSession(db, { name: "s", reveal_default: "deferred" });
    const item = presentItem(db, { node_id: "n", question_id: q.id, session_id: session.id });
    answerAndSubmit(db, item.attempt_id, item.response_id);

    const learner = getAttemptDetail(db, item.attempt_id, { viewer: "learner" }) as any;
    expect(learner.reveal).toBe("deferred");
    expect(learner.revealed).toBe(false);
    const r = learner.responses[0];
    for (const c of r.question.choices) expect(c.is_correct).toBeUndefined();
    expect(r.question.explanation).toBeUndefined();
    expect(r.question.model_answer).toBeUndefined();
    expect(r.outcome).toBeUndefined();
    expect(r.grade).toBeUndefined();
    expect(r.diagnosis).toBeUndefined();
    expect(r.chosen_misconception).toBeNull();
    expect(r.best_guess_correct).toBeNull();
    // The learner's own inputs stay.
    expect(r.selected_choice_id).toBeTruthy();
    expect(r.answered_at).toBeTruthy();
  });

  it("gives the learner the full record once the session has ended", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const session = createSession(db, { name: "s", reveal_default: "deferred" });
    const item = presentItem(db, { node_id: "n", question_id: q.id, session_id: session.id });
    answerAndSubmit(db, item.attempt_id, item.response_id);
    endSession(db, session.id);

    const learner = getAttemptDetail(db, item.attempt_id, { viewer: "learner" }) as any;
    expect(learner.revealed).toBe(true);
    const r = learner.responses[0];
    expect(r.question.choices.some((c: any) => c.is_correct === true)).toBe(true);
    expect("explanation" in r.question).toBe(true);
    expect(r.outcome).toBe("incorrect");
    expect(r.grade).not.toBeNull();
  });

  it("never withholds anything from the tutor viewer, which is the default", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const session = createSession(db, { name: "s", reveal_default: "deferred" });
    const item = presentItem(db, { node_id: "n", question_id: q.id, session_id: session.id });
    answerAndSubmit(db, item.attempt_id, item.response_id);

    const tutor = getAttemptDetail(db, item.attempt_id) as any;
    expect(tutor.revealed).toBe(true);
    const r = tutor.responses[0];
    expect(r.question.choices.some((c: any) => c.is_correct === true)).toBe(true);
    expect(r.outcome).toBe("incorrect");
    expect(r.grade).not.toBeNull();
    expect(r.diagnosis).toBeNull();

    // ... and the tutor's own outcome read is untouched by reveal.
    const outcome = getItemOutcome(db, item.response_id) as any;
    expect(outcome.status).toBe("answered");
    expect(outcome.correct_choice_id).toBeTruthy();
  });

  it("reveals a deferred attempt with no session to the learner on submit, like an immediate one", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const item = presentItem(db, { node_id: "n", question_id: q.id, reveal: "deferred" });
    answerAndSubmit(db, item.attempt_id, item.response_id);

    const learner = getAttemptDetail(db, item.attempt_id, { viewer: "learner" }) as any;
    expect(learner.revealed).toBe(true);
    expect(learner.responses[0].question.choices.some((c: any) => c.is_correct === true)).toBe(true);
  });

  it("leaves an immediate attempt in an open session exactly as it was for the learner", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const session = createSession(db, { name: "s" });
    const item = presentItem(db, { node_id: "n", question_id: q.id, session_id: session.id });
    answerAndSubmit(db, item.attempt_id, item.response_id);

    const learner = getAttemptDetail(db, item.attempt_id, { viewer: "learner" }) as any;
    expect(learner.revealed).toBe(true);
    expect(learner.responses[0].question.explanation !== undefined).toBe(true);
    expect(learner.responses[0].outcome).toBe("incorrect");
  });
});

// ----------------------------------------------------------------------------
// §3.5 ephemeral
// ----------------------------------------------------------------------------

describe("ephemeral questions (§3.5)", () => {
  function seedEphemeral(db: ReturnType<typeof openTestDb>) {
    insertTag(db, "a");
    const session = createSession(db, { name: "s" });
    const result = createQuestions(db, [mcQuestion()], { ephemeral: true, session_id: session.id });
    return { session, id: result.created[0].id };
  }

  it("rejects ephemeral: true without a session_id", () => {
    const db = openTestDb();
    insertTag(db, "a");
    expect(() => createQuestions(db, [mcQuestion()], { ephemeral: true })).toThrow(
      expect.objectContaining({ code: "ephemeral_requires_session" })
    );
  });

  it("keeps an ephemeral question out of draws, search, and the bank count", () => {
    const db = openTestDb();
    const { id } = seedEphemeral(db);
    insertQuestion(db, { tags: ["a"] }); // an ordinary one alongside

    expect(getEligibleQuestions(db, { tag_query: { all: ["a"] } }).map((q) => q.id)).not.toContain(id);
    expect(searchQuestions(db, {}).questions.map((q) => q.id)).not.toContain(id);
    expect(searchQuestions(db, { include_ephemeral: true }).questions.map((q) => q.id)).toContain(id);
    expect(readme(db).node.bank_size).toBe(1);
    expect(bootstrap(db, null).node.bank_size).toBe(1);
  });

  it("presents an ephemeral item while its session is open and refuses once it has ended", () => {
    const db = openTestDb();
    const { session, id } = seedEphemeral(db);

    expect(presentItem(db, { node_id: "n", question_id: id, session_id: session.id }).question.id).toBe(id);
    endSession(db, session.id);
    expect(() => presentItem(db, { node_id: "n", question_id: id })).toThrow(
      expect.objectContaining({ code: "session_ended" })
    );
  });

  it("retires its session's ephemeral questions on end_session and reports how many", () => {
    const db = openTestDb();
    const { session, id } = seedEphemeral(db);

    const ended = endSession(db, session.id);
    expect(ended.summary.retired_ephemeral).toBe(1);
    const row = db.prepare("SELECT retired_at, retired_reason FROM question WHERE id = ?").get(id) as {
      retired_at: string | null;
      retired_reason: string | null;
    };
    expect(row.retired_at).not.toBeNull();
    expect(row.retired_reason).toBe("ephemeral_session_ended");
  });

  it("shows ephemeral and its session on get_question", () => {
    const db = openTestDb();
    const { session, id } = seedEphemeral(db);
    const detail = getQuestionDetail(db, id) as any;
    expect(detail.ephemeral).toBe(true);
    expect(detail.session_id).toBe(session.id);
  });
});

// ----------------------------------------------------------------------------
// §3.9 idempotency
// ----------------------------------------------------------------------------

describe("create_questions idempotency (§3.9)", () => {
  it("replays the stored result verbatim and creates nothing the second time", () => {
    const db = openTestDb();
    insertTag(db, "a");

    const first = createQuestions(db, [mcQuestion()], { idempotency_key: "batch-1" });
    const second = createQuestions(db, [mcQuestion()], { idempotency_key: "batch-1" }) as any;

    expect((first as any).replayed).toBeUndefined();
    expect(second.replayed).toBe(true);
    expect(second.created).toEqual(first.created);
    const n = (db.prepare("SELECT COUNT(*) AS n FROM question").get() as { n: number }).n;
    expect(n).toBe(1);
  });

  it("treats a different key as a different batch", () => {
    const db = openTestDb();
    insertTag(db, "a");
    createQuestions(db, [mcQuestion()], { idempotency_key: "batch-1" });
    createQuestions(db, [mcQuestion()], { idempotency_key: "batch-2" });
    expect((db.prepare("SELECT COUNT(*) AS n FROM question").get() as { n: number }).n).toBe(2);
  });

  it("rejects an idempotency_key longer than 128 characters", () => {
    const db = openTestDb();
    insertTag(db, "a");
    expect(() => createQuestions(db, [mcQuestion()], { idempotency_key: "x".repeat(129) })).toThrow(
      expect.objectContaining({ code: "invalid_idempotency_key" })
    );
  });
});

// ----------------------------------------------------------------------------
// §3.10 node_keys
// ----------------------------------------------------------------------------

describe("node_keys (§3.10)", () => {
  it("stores the set with the first as primary and keeps question.node_key in sync", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const r = createQuestions(db, [mcQuestion({ node_keys: ["node:one", "node:two"] })]);
    const id = r.created[0].id;

    const detail = getQuestionDetail(db, id) as any;
    expect(detail.node_keys).toEqual(["node:one", "node:two"]);
    expect(detail.node_key).toBe("node:one");
    const rows = db
      .prepare("SELECT node_key, is_primary, ordinal FROM question_node_key WHERE question_id = ? ORDER BY ordinal")
      .all(id) as { node_key: string; is_primary: number; ordinal: number }[];
    expect(rows).toEqual([
      { node_key: "node:one", is_primary: 1, ordinal: 0 },
      { node_key: "node:two", is_primary: 0, ordinal: 1 },
    ]);
  });

  it("treats a singular node_key as the single primary", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const r = createQuestions(db, [mcQuestion({ node_key: "node:solo" })]);
    const detail = getQuestionDetail(db, r.created[0].id) as any;
    expect(detail.node_keys).toEqual(["node:solo"]);
    expect(detail.node_key).toBe("node:solo");
  });

  it("rejects a malformed node_key per question", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const r = createQuestions(db, [
      mcQuestion({ node_keys: ["node:Bad Key"] }),
      mcQuestion({ node_keys: ["ebbing:2.4"] }),
      mcQuestion({ node_keys: ["node:fine"] }),
    ]);
    expect(r.rejected.map((x) => [x.index, x.reason])).toEqual([
      [0, "invalid_node_key"],
      [1, "invalid_node_key"],
    ]);
    expect(r.created).toHaveLength(1);
  });

  it("rejects node_key and node_keys disagreeing on the primary", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const r = createQuestions(db, [mcQuestion({ node_key: "node:one", node_keys: ["node:two", "node:one"] })]);
    expect(r.rejected[0].reason).toBe("node_key_mismatch");
  });

  it("carries node_keys through search rows, the present_item snapshot and the outcome record", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const r = createQuestions(db, [mcQuestion({ node_keys: ["node:one", "node:two"] })]);
    const id = r.created[0].id;

    const row = searchQuestions(db, {}).questions[0] as any;
    expect(row.node_keys).toEqual(["node:one", "node:two"]);
    expect(row.node_key).toBe("node:one");

    const item = presentItem(db, { node_id: "n", question_id: id });
    expect(item.question.node_keys).toEqual(["node:one", "node:two"]);
    expect(item.question.node_key).toBe("node:one");

    answerAndSubmit(db, item.attempt_id, item.response_id);
    const outcome = getItemOutcome(db, item.response_id) as any;
    expect(outcome.node_keys).toEqual(["node:one", "node:two"]);
    expect(outcome.node_key).toBe("node:one");
  });

  it("filters search by node_key exactly, and by prefix when the value ends with ':'", () => {
    const db = openTestDb();
    insertTag(db, "a");
    createQuestions(db, [
      mcQuestion({ prompt: "p1", node_keys: ["node:ebbing11e:2.4:atomic_weight"] }),
      mcQuestion({ prompt: "p2", node_keys: ["node:ebbing11e:2.4:isotopes"] }),
      mcQuestion({ prompt: "p3", node_keys: ["node:ebbing11e:3.1:moles"] }),
    ]);

    expect(searchQuestions(db, { node_key: "node:ebbing11e:2.4:atomic_weight" }).total).toBe(1);
    expect(searchQuestions(db, { node_key: "node:ebbing11e:2.4:" }).total).toBe(2);
    expect(searchQuestions(db, { node_key: "node:nothing" }).total).toBe(0);
  });

  it("filters search by session_id", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const session = createSession(db, { name: "s" });
    createQuestions(db, [mcQuestion({ prompt: "scoped" })], { ephemeral: true, session_id: session.id });
    createQuestions(db, [mcQuestion({ prompt: "unscoped" })]);

    const scoped = searchQuestions(db, { session_id: session.id, include_ephemeral: true });
    expect(scoped.total).toBe(1);
    expect(scoped.questions[0].prompt).toBe("scoped");
  });

  it("round-trips provenance, claim_rung, tags and node_key through create → search", () => {
    const db = openTestDb();
    insertTag(db, "a");
    insertTag(db, "b");
    createQuestions(db, [
      mcQuestion({
        tags: ["a", "b"],
        provenance: "textbook_sourced",
        claim_rung: "can_discriminate",
        node_keys: ["node:one"],
      }),
    ]);

    const row = searchQuestions(db, {}).questions[0] as any;
    expect(row.provenance).toBe("textbook_sourced");
    expect(row.claim_rung).toBe("can_discriminate");
    expect(row.tags.sort()).toEqual(["a", "b"]);
    expect(row.node_key).toBe("node:one");
    expect(row.node_keys).toEqual(["node:one"]);
  });

  it("replaces the set on edit and keeps the primary column in sync", async () => {
    const db = openTestDb();
    insertTag(db, "a");
    const { editQuestion } = await import("../src/domain/questions.js");
    const r = createQuestions(db, [mcQuestion({ node_keys: ["node:one", "node:two"] })]);
    editQuestion(db, r.created[0].id, { node_keys: ["node:three"] });

    const detail = getQuestionDetail(db, r.created[0].id) as any;
    expect(detail.node_keys).toEqual(["node:three"]);
    expect(detail.node_key).toBe("node:three");
  });
});

describe("DomainError shape used above", () => {
  it("is the error class these codes come from", () => {
    expect(new DomainError("x", "y").code).toBe("x");
  });
});

// ----------------------------------------------------------------------------
// The MCP surface for all four (the tools layer is where the tutor meets this)
// ----------------------------------------------------------------------------

describe("item channel over MCP", () => {
  it("carries reveal, ephemeral, idempotency and node_keys through the tools", async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { registerTools } = await import("../src/mcp/tools.js");
    const { TOOLS_VERSION } = await import("../src/protocol.js");

    const db = openTestDb();
    insertTag(db, "a");
    const server = new McpServer({ name: "osmosis-test", version: "1.0.0" });
    registerTools(server, db, "/tmp/osmosis-test-uploads", "test-node");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const call = async (name: string, args: Record<string, unknown>) => {
      const result = (await client.callTool({ name, arguments: args })) as {
        content: { text: string }[];
        isError?: boolean;
      };
      return { body: JSON.parse(result.content[0].text), isError: result.isError === true };
    };

    expect(TOOLS_VERSION).toBe(4);

    const session = (await call("create_session", { name: "live", reveal_default: "deferred" })).body;
    expect(session.reveal_default).toBe("deferred");

    const written = await call("create_questions", {
      questions: [mcQuestion({ node_keys: ["node:one", "node:two"] })],
      ephemeral: true,
      session_id: session.id,
      idempotency_key: "k1",
    });
    const questionId = written.body.created[0].id;

    const replay = await call("create_questions", {
      questions: [mcQuestion({ node_keys: ["node:one"] })],
      ephemeral: true,
      session_id: session.id,
      idempotency_key: "k1",
    });
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.created[0].id).toBe(questionId);

    const detail = (await call("get_question", { id: questionId })).body;
    expect(detail.ephemeral).toBe(true);
    expect(detail.node_keys).toEqual(["node:one", "node:two"]);

    expect((await call("search_questions", {})).body.total).toBe(0);
    expect((await call("search_questions", { include_ephemeral: true, node_key: "node:" })).body.total).toBe(1);

    const item = (await call("present_item", { question_id: questionId, session_id: session.id })).body;
    expect(item.question.node_key).toBe("node:one");
    answerAndSubmit(db, item.attempt_id, item.response_id);

    // The tutor's own read is never gated by a deferred reveal.
    const attempt = (await call("get_attempt", { attempt_id: item.attempt_id })).body;
    expect(attempt.reveal).toBe("deferred");
    expect(attempt.revealed).toBe(true);
    expect(attempt.responses[0].outcome).toBe("incorrect");

    const ended = (await call("end_session", { session_id: session.id })).body;
    expect(ended.summary.retired_ephemeral).toBe(1);

    const rejected = await call("create_questions", { questions: [mcQuestion()], ephemeral: true });
    expect(rejected.isError).toBe(true);
    expect(rejected.body.error).toBe("ephemeral_requires_session");
  });
});

// ----------------------------------------------------------------------------
// The learner's other screens must honour the same hold (review fix round 1)
// ----------------------------------------------------------------------------

describe("deferred reveal across the learner's other reads", () => {
  function heldSession(db: ReturnType<typeof openTestDb>) {
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const session = createSession(db, { name: "s", reveal_default: "deferred" });
    const item = presentItem(db, { node_id: "n", question_id: q.id, session_id: session.id });
    answerAndSubmit(db, item.attempt_id, item.response_id);
    return { session, item };
  }

  it("hides a held attempt's mean_score from the session detail the app renders", async () => {
    const { getSessionDetail } = await import("../src/domain/sessions.js");
    const db = openTestDb();
    const { session } = heldSession(db);

    const learner = getSessionDetail(db, session.id, { viewer: "learner" }) as any;
    expect(learner.attempts[0].revealed).toBe(false);
    expect(learner.attempts[0].mean_score).toBeNull();
    expect(learner.attempts[0].ungraded).toBeNull();

    // The tutor's read — get_session — is untouched.
    const tutor = getSessionDetail(db, session.id) as any;
    expect(tutor.attempts[0].revealed).toBe(true);
    expect(tutor.attempts[0].mean_score).toBe(0);

    endSession(db, session.id);
    const afterEnd = getSessionDetail(db, session.id, { viewer: "learner" }) as any;
    expect(afterEnd.attempts[0].revealed).toBe(true);
    expect(afterEnd.attempts[0].mean_score).toBe(0);
  });

  it("keeps a held response out of every get_results scope for the learner", async () => {
    const { getResults } = await import("../src/domain/results.js");
    const db = openTestDb();
    const { session } = heldSession(db);

    const learnerTags = getResults(db, { scope: "tag" }, { viewer: "learner" }) as any;
    expect(learnerTags.tags).toHaveLength(0);
    const learnerQuestions = getResults(db, { scope: "question" }, { viewer: "learner" }) as any;
    expect(learnerQuestions.questions).toHaveLength(0);
    const learnerAttempts = getResults(db, { scope: "attempt" }, { viewer: "learner" }) as any;
    expect(learnerAttempts.attempts).toHaveLength(0);

    // The tutor still sees all of it.
    const tutorTags = getResults(db, { scope: "tag" }) as any;
    expect(tutorTags.tags[0].responses).toBe(1);
    const tutorQuestions = getResults(db, { scope: "question" }) as any;
    expect(tutorQuestions.questions[0].recent_responses[0].outcome).toBe("incorrect");

    // ... and so does the learner, once the session has ended.
    endSession(db, session.id);
    const afterEnd = getResults(db, { scope: "question" }, { viewer: "learner" }) as any;
    expect(afterEnd.questions).toHaveLength(1);
    expect(afterEnd.questions[0].recent_responses[0].outcome).toBe("incorrect");
  });

  it("leaves an immediate attempt visible to the learner in both reads", async () => {
    const { getResults } = await import("../src/domain/results.js");
    const { getSessionDetail } = await import("../src/domain/sessions.js");
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const session = createSession(db, { name: "s" });
    const item = presentItem(db, { node_id: "n", question_id: q.id, session_id: session.id });
    answerAndSubmit(db, item.attempt_id, item.response_id);

    expect((getSessionDetail(db, session.id, { viewer: "learner" }) as any).attempts[0].mean_score).toBe(0);
    expect((getResults(db, { scope: "question" }, { viewer: "learner" }) as any).questions).toHaveLength(1);
  });
});

describe("ephemeral questions never leave canonical over sync", () => {
  it("is absent from a pull payload for a slice it is tagged under", async () => {
    const { buildPullResponse } = await import("../src/domain/sync.js");
    const canonical = openTestDb();
    insertTag(canonical, "a");
    const session = createSession(canonical, { name: "s" });
    const ephemeral = createQuestions(canonical, [mcQuestion({ prompt: "session only" })], {
      ephemeral: true,
      session_id: session.id,
    }).created[0];
    const ordinary = createQuestions(canonical, [mcQuestion({ prompt: "bank item" })]).created[0];

    const payload = buildPullResponse(canonical, {
      node_id: "local-1",
      protocol_version: 1,
      slices: ["a"],
      since: null,
      include_grades_for_node: false,
    });
    const ids = payload.questions.map((q: any) => q.id);
    expect(ids).toContain(ordinary.id);
    expect(ids).not.toContain(ephemeral.id);
  });
});
