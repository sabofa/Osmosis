import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { createQuestions } from "../src/domain/questions.js";
import { createAsset } from "../src/domain/assets.js";
import { createSession, endSession, getSessionDetail } from "../src/domain/sessions.js";
import { presentItem, quickCheck, answerResponse, submitAttempt, getItemOutcome } from "../src/domain/attempts.js";
import { createTemplate } from "../src/domain/templates.js";
import { DomainError } from "../src/domain/errors.js";

// Regressions from the first live tutoring session's bug report (2026-09-14).

describe("1. document_marker_offset must land on a token, not a single space", () => {
  it("rejects an offset sitting on the space between two words, accepts one on the word", async () => {
    const db = openTestDb();
    insertTag(db, "a");
    const asset = await createAsset(db, "/tmp", { title: "t", type: "text", content: "alpha beta gamma" }, "human");
    const onSpace = createQuestions(db, [
      { type: "written", prompt: "p", tags: ["a"], model_answer: "m", document_id: asset.id, document_marker_offset: 5 },
    ]);
    expect(onSpace.rejected[0]?.reason).toBe("invalid_document_marker");

    const onWord = createQuestions(db, [
      { type: "written", prompt: "p", tags: ["a"], model_answer: "m", document_id: asset.id, document_marker_offset: 6 },
    ]);
    expect(onWord.created).toHaveLength(1);
  });
});

describe("2. an ended session accepts nothing new", () => {
  function ended(db: ReturnType<typeof openTestDb>): string {
    const s = createSession(db, { name: "s" });
    endSession(db, s.id);
    return s.id;
  }

  it("present_item, quick_check and create_template all refuse with session_ended", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const mc = insertQuestion(db, { tags: ["a"] });
    const written = insertQuestion(db, { tags: ["a"], type: "written" });
    const sid = ended(db);

    for (const fn of [
      () => presentItem(db, { node_id: "n", question_id: mc.id, session_id: sid }),
      () => quickCheck(db, { node_id: "n", question_id: written.id, session_id: sid }),
      () => createTemplate(db, { name: "t", tag_query: { all: ["a"] }, question_count: 1, session_id: sid }),
    ]) {
      let caught: unknown;
      try {
        fn();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(DomainError);
      expect((caught as DomainError).code).toBe("session_ended");
    }
    expect((db.prepare("SELECT COUNT(*) AS n FROM attempt WHERE session_id = ?").get(sid) as { n: number }).n).toBe(0);
  });
});

describe("4. an mc question has exactly one correct choice", () => {
  it("rejects two is_correct: true choices with mc_multiple_correct", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const r = createQuestions(db, [
      {
        type: "mc", prompt: "p", tags: ["a"],
        choices: [
          { body: "x", is_correct: true },
          { body: "y", is_correct: true },
          { body: "z", is_correct: false, misconception: "m" },
        ],
      },
    ]);
    expect(r.created).toHaveLength(0);
    expect(r.rejected[0]?.reason).toBe("mc_multiple_correct");
  });
});

describe("5. duplicate detection ignores function words and keeps math tokens whole", () => {
  it("does not flag two arithmetic questions that only share 'what is' and a numeral", () => {
    const db = openTestDb();
    insertTag(db, "math");
    insertQuestion(db, { tags: ["math"], prompt: "What is 1/8 + 1/2?" });
    const r = createQuestions(db, [
      { type: "written", prompt: "What is 1/2 ÷ 2/3?", tags: ["math"], model_answer: "3/4" },
    ]);
    expect(r.created).toHaveLength(1);
    expect(r.possible_duplicates).toHaveLength(0);
  });

  it("still flags a genuine near-duplicate", () => {
    const db = openTestDb();
    insertTag(db, "math");
    insertQuestion(db, { tags: ["math"], prompt: "Solve 2x + 3 = 7 for x." });
    const r = createQuestions(db, [
      { type: "written", prompt: "Solve 2x + 3 = 7.", tags: ["math"], model_answer: "2" },
    ]);
    expect(r.possible_duplicates.length).toBeGreaterThan(0);
  });
});

// 3 and 6 were observed against the build that was live before the
// 2026-09-14 deploy; pin the current behaviour so they can't come back.
describe("3. get_session rollup is correct immediately after end_session", () => {
  it("an ungraded written attempt shows mean_score null and ungraded 1 right away", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "written" });
    const s = createSession(db, { name: "s" });
    const p = presentItem(db, { node_id: "n", question_id: q.id, session_id: s.id });
    answerResponse(db, p.attempt_id, p.response_id, { response_text: "nine" });
    submitAttempt(db, p.attempt_id);
    endSession(db, s.id);
    const detail = getSessionDetail(db, s.id) as { attempts: { mean_score: number | null; ungraded: number }[] };
    expect(detail.attempts[0].mean_score).toBeNull();
    expect(detail.attempts[0].ungraded).toBe(1);
  });
});

describe("6. a written outcome always carries response_text", () => {
  it("await_item_outcome's answered record has the text even before any grade exists", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "written" });
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    answerResponse(db, p.attempt_id, p.response_id, { response_text: "nine" });
    submitAttempt(db, p.attempt_id);
    const o = getItemOutcome(db, p.response_id);
    expect(o.status).toBe("answered");
    if (o.status === "answered") {
      expect(o.response_text).toBe("nine");
      expect(o.outcome).toBe("ungraded");
      expect(o.model_answer).toBe("model answer");
    }
  });
});
