import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { presentItem, answerResponse, submitAttempt, getAttemptDetail } from "../src/domain/attempts.js";
import { DomainError } from "../src/domain/errors.js";

function choiceOf(db: ReturnType<typeof openTestDb>, questionId: string, correct: boolean): string {
  return (
    db.prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = ?").get(questionId, correct ? 1 : 0) as {
      id: string;
    }
  ).id;
}

describe("answerResponse input guards", () => {
  it("rejects a selected_choice_id that belongs to a different question", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q1 = insertQuestion(db, { tags: ["a"] });
    const q2 = insertQuestion(db, { tags: ["a"] });
    const presented = presentItem(db, { node_id: "n", question_id: q1.id });

    // Without the guard this "answer" would be graded against q2's answer
    // key: submitAttempt only looks the choice up by id, so a correct choice
    // from any other question scores 1.0 here.
    const foreignCorrect = choiceOf(db, q2.id, true);
    expect(() =>
      answerResponse(db, presented.attempt_id, presented.response_id, { selected_choice_id: foreignCorrect })
    ).toThrow(DomainError);

    const row = db.prepare("SELECT selected_choice_id FROM response WHERE id = ?").get(presented.response_id) as {
      selected_choice_id: string | null;
    };
    expect(row.selected_choice_id).toBeNull();
  });

  it("rejects a confidence value outside the 3-point scale with a DomainError, not a raw SQLite error", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const presented = presentItem(db, { node_id: "n", question_id: q.id });

    let caught: unknown;
    try {
      answerResponse(db, presented.attempt_id, presented.response_id, {
        confidence: "very" as unknown as "unsure",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe("invalid_confidence");
  });

  it("an explicit null clears a previously set field (choice, confidence, misapplied_method)", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const presented = presentItem(db, { node_id: "n", question_id: q.id });
    const correct = choiceOf(db, q.id, true);

    answerResponse(db, presented.attempt_id, presented.response_id, {
      selected_choice_id: correct,
      confidence: "confident",
      misapplied_method: "guessed",
    });
    const cleared = answerResponse(db, presented.attempt_id, presented.response_id, {
      selected_choice_id: null,
      confidence: null,
      misapplied_method: null,
    });
    expect(cleared.selected_choice_id).toBeNull();
    expect(cleared.confidence).toBeNull();
    expect(cleared.misapplied_method).toBeNull();
  });

  it("an omitted field is left untouched (partial PATCH semantics still hold)", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const presented = presentItem(db, { node_id: "n", question_id: q.id });
    const correct = choiceOf(db, q.id, true);

    answerResponse(db, presented.attempt_id, presented.response_id, { selected_choice_id: correct });
    const after = answerResponse(db, presented.attempt_id, presented.response_id, { confidence: "somewhat" });
    expect(after.selected_choice_id).toBe(correct);
    expect(after.confidence).toBe("somewhat");

    submitAttempt(db, presented.attempt_id);
    const detail = getAttemptDetail(db, presented.attempt_id) as { responses: { grade: { score: number } }[] };
    expect(detail.responses[0].grade.score).toBe(1);
  });
});
