import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { quickCheck, submitQuickCheck } from "../src/domain/attempts.js";
import { createSession } from "../src/domain/sessions.js";

describe("quickCheck", () => {
  it("presents a written question inline, withholding the model answer", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "written" });

    const result = quickCheck(db, { node_id: "test-node", question_id: q.id });
    expect(result.question.model_answer).toBeUndefined();

    const attemptRow = db.prepare("SELECT delivery_mode FROM attempt WHERE id = ?").get(result.attempt_id) as {
      delivery_mode: string;
    };
    expect(attemptRow.delivery_mode).toBe("chat_quick_check");
  });

  it("rejects an mc question — quick_check is free-response only", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "mc" });
    expect(() => quickCheck(db, { node_id: "test-node", question_id: q.id })).toThrow();
  });

  it("threads session_id through to the attempt, mirroring presentItem", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "written" });
    const session = createSession(db, { name: "s" });

    const result = quickCheck(db, { node_id: "test-node", question_id: q.id, session_id: session.id });

    const attemptRow = db.prepare("SELECT session_id FROM attempt WHERE id = ?").get(result.attempt_id) as {
      session_id: string | null;
    };
    expect(attemptRow.session_id).toBe(session.id);
  });

  it("still works with no session_id (session_id IS NULL path)", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "written" });

    const result = quickCheck(db, { node_id: "test-node", question_id: q.id });

    const attemptRow = db.prepare("SELECT session_id FROM attempt WHERE id = ?").get(result.attempt_id) as {
      session_id: string | null;
    };
    expect(attemptRow.session_id).toBeNull();
  });
});

describe("submitQuickCheck", () => {
  it("records the answer and reveals the model answer", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "written" });
    const presented = quickCheck(db, { node_id: "test-node", question_id: q.id });

    const outcome = submitQuickCheck(db, {
      response_id: presented.response_id,
      response_text: "My answer is that the derivative measures instantaneous rate of change.",
    });
    expect(outcome.model_answer).toBe("model answer"); // seeded by insertQuestion's helper default
  });
});
