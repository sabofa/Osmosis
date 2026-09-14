import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { quickCheck, submitQuickCheck } from "../src/domain/attempts.js";
import { createSession } from "../src/domain/sessions.js";
import { DomainError } from "../src/domain/errors.js";

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

  it("resolves a tag_query matching only written questions", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "written" });

    const result = quickCheck(db, { node_id: "test-node", tag_query: { all: ["a"] } });

    expect(result.question.id).toBe(q.id);
  });

  it("filters a mixed tag_query down to written questions only", () => {
    const db = openTestDb();
    insertTag(db, "a");
    insertQuestion(db, { tags: ["a"], type: "mc" });
    const written = insertQuestion(db, { tags: ["a"], type: "written" });

    const result = quickCheck(db, { node_id: "test-node", tag_query: { all: ["a"] } });

    expect(result.question.id).toBe(written.id);
  });

  it("throws no_eligible_questions when tag_query matches only mc questions", () => {
    const db = openTestDb();
    insertTag(db, "a");
    insertQuestion(db, { tags: ["a"], type: "mc" });

    expect(() => quickCheck(db, { node_id: "test-node", tag_query: { all: ["a"] } })).toThrow(DomainError);
    try {
      quickCheck(db, { node_id: "test-node", tag_query: { all: ["a"] } });
      throw new Error("expected quickCheck to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("no_eligible_questions");
    }
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

  // Whole-branch review finding: submitQuickCheck threads confidence/idk/
  // misapplied_method through to answerResponse (and the MCP schema was
  // updated for them), but nothing exercised that path. Confirm they land.
  it("threads confidence/idk/misapplied_method through to the underlying response row", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "written" });
    const presented = quickCheck(db, { node_id: "test-node", question_id: q.id });

    submitQuickCheck(db, {
      response_id: presented.response_id,
      response_text: "I'm not sure, but I think it's the chain rule.",
      confidence: "unsure",
      idk: true,
      misapplied_method: "tried the product rule",
    });

    const row = db
      .prepare("SELECT confidence, idk, misapplied_method FROM response WHERE id = ?")
      .get(presented.response_id) as { confidence: string; idk: number; misapplied_method: string };
    expect(row.confidence).toBe("unsure");
    expect(row.idk).toBe(1);
    expect(row.misapplied_method).toBe("tried the product rule");
  });
});
