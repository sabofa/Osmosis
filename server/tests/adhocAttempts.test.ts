import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { createAttempt } from "../src/domain/attempts.js";

describe("createAttempt with source: adhoc", () => {
  it("creates an attempt with exactly the given question_ids, no template required", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q1 = insertQuestion(db, { tags: ["a"] });
    const q2 = insertQuestion(db, { tags: ["a"] });

    const result = createAttempt(db, { node_id: "test-node", source: "adhoc", question_ids: [q1.id, q2.id] });

    expect(result.attempt_id).toBeTruthy();
    const responseCount = (
      db.prepare("SELECT COUNT(*) AS n FROM response WHERE attempt_id = ?").get(result.attempt_id) as { n: number }
    ).n;
    expect(responseCount).toBe(2);

    const attemptRow = db.prepare("SELECT source, template_id FROM attempt WHERE id = ?").get(result.attempt_id) as {
      source: string;
      template_id: string | null;
    };
    expect(attemptRow.source).toBe("adhoc");
    expect(attemptRow.template_id).toBeNull();
  });

  it("rejects an empty question_ids list", () => {
    const db = openTestDb();
    expect(() => createAttempt(db, { node_id: "test-node", source: "adhoc", question_ids: [] })).toThrow();
  });

  it("rejects a question_id that doesn't exist", () => {
    const db = openTestDb();
    expect(() =>
      createAttempt(db, { node_id: "test-node", source: "adhoc", question_ids: ["not-a-real-id"] })
    ).toThrow();
  });
});
