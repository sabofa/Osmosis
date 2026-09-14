import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { createQuestions, editQuestion, getQuestionDetail } from "../src/domain/questions.js";
import { DomainError } from "../src/domain/errors.js";
import { presentItem, answerResponse, submitAttempt, getItemOutcome, getAttemptDetail } from "../src/domain/attempts.js";

describe("misconception on distractors", () => {
  it("rejects a new mc question with a non-correct choice missing misconception", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const result = createQuestions(db, [
      {
        type: "mc",
        prompt: "x",
        tags: ["a"],
        choices: [
          { body: "right", is_correct: true },
          { body: "wrong", is_correct: false }, // no misconception
        ],
      },
    ]);
    expect(result.created).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("missing_misconception");
  });

  it("accepts when every non-correct choice has a misconception (the correct choice needs none)", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const result = createQuestions(db, [
      {
        type: "mc",
        prompt: "x",
        tags: ["a"],
        choices: [
          { body: "right", is_correct: true },
          { body: "wrong", is_correct: false, misconception: "thinks the sign flips" },
        ],
      },
    ]);
    expect(result.created).toHaveLength(1);
  });

  it("editQuestion on a legacy mc question (a pre-existing distractor missing misconception) succeeds when the edit doesn't touch choices", () => {
    const db = openTestDb();
    insertTag(db, "a");
    // insertQuestion writes directly via SQL, bypassing createQuestions'
    // validation entirely — this simulates a question that was created
    // before misconception existed (or otherwise predates this rule).
    const legacy = insertQuestion(db, { tags: ["a"] });

    expect(() => editQuestion(db, legacy.id, { prompt: "updated prompt" })).not.toThrow();
    const detail = getQuestionDetail(db, legacy.id);
    expect(detail.prompt).toBe("updated prompt");
  });

  it("editQuestion still rejects when the edit payload supplies a new choices array missing misconception", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const legacy = insertQuestion(db, { tags: ["a"] });

    let caught: unknown;
    try {
      editQuestion(db, legacy.id, {
        choices: [
          { body: "right", is_correct: true },
          { body: "wrong", is_correct: false }, // no misconception
        ],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe("missing_misconception");
  });

  // Whole-branch review finding: a tutor can write misconception via
  // create_questions/edit_question but getQuestionDetail's choice SELECT
  // never returned it, so there was no read path — including before
  // editing, when you'd want to see what you're about to overwrite.
  it("getQuestionDetail returns misconception on its choices", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const result = createQuestions(db, [
      {
        type: "mc",
        prompt: "x",
        tags: ["a"],
        choices: [
          { body: "right", is_correct: true },
          { body: "wrong", is_correct: false, misconception: "thinks the sign flips" },
        ],
      },
    ]);

    const detail = getQuestionDetail(db, result.created[0].id);
    const wrong = detail.choices.find((c) => !c.is_correct);
    expect(wrong?.misconception).toBe("thinks the sign flips");
    const correct = detail.choices.find((c) => c.is_correct);
    expect(correct?.misconception).toBeNull();
  });
});

describe("confidence, idk, misapplied_method on responses", () => {
  it("threads confidence/idk through answerResponse and surfaces them in getItemOutcome", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = createQuestions(db, [
      { type: "mc", prompt: "x", tags: ["a"], choices: [{ body: "r", is_correct: true }, { body: "w", is_correct: false, misconception: "m" }] },
    ]).created[0];

    const presented = presentItem(db, { node_id: "n1", question_id: q.id });
    const wrongChoiceId = (
      db.prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = 0").get(q.id) as { id: string }
    ).id;

    answerResponse(db, presented.attempt_id, presented.response_id, {
      selected_choice_id: wrongChoiceId,
      confidence: "confident",
      misapplied_method: "applied the product rule instead of the chain rule",
    });
    submitAttempt(db, presented.attempt_id);

    const outcome = getItemOutcome(db, presented.response_id) as any;
    expect(outcome.status).toBe("answered");
    expect(outcome.confidence).toBe("confident");
    expect(outcome.misapplied_method).toBe("applied the product rule instead of the chain rule");
  });

  it("idk is a distinct signal from a wrong choice — recorded even with no selected_choice_id", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = createQuestions(db, [
      { type: "mc", prompt: "x", tags: ["a"], choices: [{ body: "r", is_correct: true }, { body: "w", is_correct: false, misconception: "m" }] },
    ]).created[0];
    const presented = presentItem(db, { node_id: "n1", question_id: q.id });

    answerResponse(db, presented.attempt_id, presented.response_id, { idk: true, skipped: true });
    submitAttempt(db, presented.attempt_id);

    const row = db.prepare("SELECT idk FROM response WHERE id = ?").get(presented.response_id) as { idk: number };
    expect(row.idk).toBe(1);
  });

  // Whole-branch review finding: getAttemptDetail's response mapping stopped
  // at elapsed_ms, so confidence/idk/misapplied_method were only visible via
  // the in-session optimistic UI update, not through a GET /api/attempts/:id
  // read. Confirm they now survive that read path.
  it("surfaces confidence/idk/misapplied_method through getAttemptDetail", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = createQuestions(db, [
      { type: "mc", prompt: "x", tags: ["a"], choices: [{ body: "r", is_correct: true }, { body: "w", is_correct: false, misconception: "m" }] },
    ]).created[0];

    const presented = presentItem(db, { node_id: "n1", question_id: q.id });
    const wrongChoiceId = (
      db.prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = 0").get(q.id) as { id: string }
    ).id;

    answerResponse(db, presented.attempt_id, presented.response_id, {
      selected_choice_id: wrongChoiceId,
      confidence: "somewhat",
      idk: false,
      misapplied_method: "applied the product rule instead of the chain rule",
    });
    submitAttempt(db, presented.attempt_id);

    const detail = getAttemptDetail(db, presented.attempt_id) as any;
    const response = detail.responses.find((r: any) => r.id === presented.response_id);
    expect(response.confidence).toBe("somewhat");
    expect(response.idk).toBe(false);
    expect(response.misapplied_method).toBe("applied the product rule instead of the chain rule");
  });
});
