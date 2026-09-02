import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { presentItem, getItemOutcome, answerResponse, submitAttempt } from "../src/domain/attempts.js";

describe("getItemOutcome", () => {
  it("reports pending before the app-side answer is submitted", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const presented = presentItem(db, { node_id: "test-node", question_id: q.id });

    const outcome = getItemOutcome(db, presented.response_id);
    expect(outcome.status).toBe("pending");
  });

  it("reports the outcome once the app's existing submit path has run", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    const presented = presentItem(db, { node_id: "test-node", question_id: q.id });

    const correctChoiceId = (
      db.prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = 1").get(q.id) as { id: string }
    ).id;

    // Exactly what the app's PATCH + submit HTTP routes do under the hood
    // (apiRoutes.ts:265-295) — no new answer-recording logic, reusing what
    // already exists.
    answerResponse(db, presented.attempt_id, presented.response_id, { selected_choice_id: correctChoiceId });
    submitAttempt(db, presented.attempt_id);

    const outcome = getItemOutcome(db, presented.response_id);
    expect(outcome.status).toBe("answered");
    if (outcome.status === "answered") {
      expect(outcome.correct).toBe(true);
      expect(outcome.correct_choice_id).toBe(correctChoiceId);
    }
  });

  it("throws on a response_id that doesn't exist", () => {
    const db = openTestDb();
    expect(() => getItemOutcome(db, "not-real")).toThrow();
  });
});
