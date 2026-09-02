import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { presentItem, getItemOutcome, answerResponse, submitAttempt } from "../src/domain/attempts.js";

describe("app-mediated live loop (present_item -> app answers -> await_item_outcome)", () => {
  it("never exposes is_correct before the app-side answer is submitted, and reports it correctly after", () => {
    const db = openTestDb();
    insertTag(db, "algebra");
    const q = insertQuestion(db, { tags: ["algebra"], prompt: "What is 2+2?" });

    const presented = presentItem(db, { node_id: "test-node", tag_query: { all: ["algebra"] } });
    expect(JSON.stringify(presented)).not.toMatch(/is_correct/);
    expect(JSON.stringify(presented)).not.toMatch(/explanation/);

    // Before Ben answers, the tutor's poll reports pending.
    expect(getItemOutcome(db, presented.response_id).status).toBe("pending");

    // This is exactly what the app's existing PATCH/submit HTTP routes do.
    const correctChoiceId = (
      db.prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = 1").get(presented.question.id) as {
        id: string;
      }
    ).id;
    answerResponse(db, presented.attempt_id, presented.response_id, { selected_choice_id: correctChoiceId });
    submitAttempt(db, presented.attempt_id);

    const outcome = getItemOutcome(db, presented.response_id);
    expect(outcome.status).toBe("answered");
    if (outcome.status === "answered") expect(outcome.correct).toBe(true);
  });
});
