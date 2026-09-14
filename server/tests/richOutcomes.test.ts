import { describe, it, expect } from "vitest";
import { openTestDb, insertTag } from "./helpers.js";
import { createQuestions } from "../src/domain/questions.js";
import { presentItem, answerResponse, submitAttempt, getItemOutcome } from "../src/domain/attempts.js";

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
});
