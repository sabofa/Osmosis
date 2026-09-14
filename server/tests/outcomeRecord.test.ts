import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { createQuestions } from "../src/domain/questions.js";
import {
  presentItem, answerResponse, submitAttempt, getItemOutcome, gradeResponse,
  quickCheck, submitQuickCheck, deriveOutcome,
} from "../src/domain/attempts.js";

function mcQuestion(db: ReturnType<typeof openTestDb>) {
  insertTag(db, "a");
  return createQuestions(db, [
    {
      type: "mc", prompt: "2+2?", tags: ["a"],
      choices: [
        { body: "4", is_correct: true },
        { body: "5", is_correct: false, misconception: "off by one" },
      ],
    },
  ]).created[0];
}

function choiceId(db: ReturnType<typeof openTestDb>, questionId: string, correct: boolean): string {
  return (db.prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = ?").get(questionId, correct ? 1 : 0) as { id: string }).id;
}

describe("deriveOutcome", () => {
  it("maps idk/score to the five labels", () => {
    expect(deriveOutcome(true, 0)).toBe("dont_know");
    expect(deriveOutcome(false, null)).toBe("ungraded");
    expect(deriveOutcome(false, 1)).toBe("correct");
    expect(deriveOutcome(false, 0)).toBe("incorrect");
    expect(deriveOutcome(false, 0.5)).toBe("partial");
  });
});

describe("getItemOutcome full record", () => {
  it("mc wrong choice: incorrect, carries the chosen option and its misconception", () => {
    const db = openTestDb();
    const q = mcQuestion(db);
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    const wrong = choiceId(db, q.id, false);
    answerResponse(db, p.attempt_id, p.response_id, { selected_choice_id: wrong, confidence: "confident", elapsed_ms: 4200 });
    submitAttempt(db, p.attempt_id);

    const o = getItemOutcome(db, p.response_id);
    expect(o.status).toBe("answered");
    if (o.status !== "answered") return;
    expect(o.outcome).toBe("incorrect");
    expect(o.score).toBe(0);
    expect(o.selected_choice_id).toBe(wrong);
    expect(o.chosen_misconception).toBe("off by one");
    expect(o.correct_choice_id).toBe(choiceId(db, q.id, true));
    expect(o.elapsed_ms).toBe(4200);
    expect(o.confidence).toBe("confident");
    expect(typeof o.answered_at).toBe("string");
  });

  it("mc I-don't-know: dont_know, no chosen option", () => {
    const db = openTestDb();
    const q = mcQuestion(db);
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    answerResponse(db, p.attempt_id, p.response_id, { idk: true, skipped: true });
    submitAttempt(db, p.attempt_id);
    const o = getItemOutcome(db, p.response_id);
    if (o.status !== "answered") throw new Error("expected answered");
    expect(o.outcome).toBe("dont_know");
    expect(o.selected_choice_id).toBeNull();
    expect(o.chosen_misconception).toBeNull();
  });

  it("written: ungraded with response_text, then partial after a self-grade", () => {
    const db = openTestDb();
    insertTag(db, "w");
    const q = insertQuestion(db, { type: "written", tags: ["w"] });
    const p = presentItem(db, { node_id: "n", question_id: q.id });
    answerResponse(db, p.attempt_id, p.response_id, { response_text: "nine" });
    submitAttempt(db, p.attempt_id);

    let o = getItemOutcome(db, p.response_id);
    if (o.status !== "answered") throw new Error("expected answered");
    expect(o.outcome).toBe("ungraded");
    expect(o.score).toBeNull();
    expect(o.response_text).toBe("nine");
    expect(o.correct).toBeNull();

    gradeResponse(db, p.response_id, { grader: "self", score: 0.5 });
    o = getItemOutcome(db, p.response_id);
    if (o.status !== "answered") throw new Error("expected answered");
    expect(o.outcome).toBe("partial");
    expect(o.score).toBe(0.5);
  });
});

describe("submitQuickCheck returns the full record", () => {
  it("includes response_text and outcome, and still the model answer", () => {
    const db = openTestDb();
    insertTag(db, "w");
    const q = insertQuestion(db, { type: "written", tags: ["w"] });
    const qc = quickCheck(db, { node_id: "n", question_id: q.id });
    const r = submitQuickCheck(db, { response_id: qc.response_id, response_text: "nine", confidence: "unsure" });
    expect(r.status).toBe("answered");
    if (r.status !== "answered") return;
    expect(r.response_text).toBe("nine");
    expect(r.outcome).toBe("ungraded");
    expect(r.model_answer).toBe("model answer");
    expect(r.confidence).toBe("unsure");
  });
});
