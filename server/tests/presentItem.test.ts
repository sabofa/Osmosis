import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { presentItem } from "../src/domain/attempts.js";

describe("presentItem", () => {
  it("presents an explicit question_id without revealing is_correct or explanation, tagged app_live", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });

    const result = presentItem(db, { node_id: "test-node", question_id: q.id });

    expect(result.attempt_id).toBeTruthy();
    expect(result.response_id).toBeTruthy();
    expect(result.question.id).toBe(q.id);
    expect(result.question.explanation).toBeUndefined();
    expect(result.question.model_answer).toBeUndefined();
    for (const choice of result.question.choices as any[]) {
      expect(choice.is_correct).toBeUndefined();
    }

    const attemptRow = db.prepare("SELECT delivery_mode FROM attempt WHERE id = ?").get(result.attempt_id) as {
      delivery_mode: string;
    };
    expect(attemptRow.delivery_mode).toBe("app_live");
  });

  it("auto-picks an eligible question when given a tag_query instead of an explicit id", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });

    const result = presentItem(db, { node_id: "test-node", tag_query: { all: ["a"] } });
    expect(result.question.id).toBe(q.id);
  });

  it("throws when neither question_id nor tag_query is given", () => {
    const db = openTestDb();
    expect(() => presentItem(db, { node_id: "test-node" } as any)).toThrow();
  });

  it("throws when tag_query matches nothing", () => {
    const db = openTestDb();
    insertTag(db, "empty");
    expect(() => presentItem(db, { node_id: "test-node", tag_query: { all: ["empty"] } })).toThrow();
  });
});
