import { describe, it, expect } from "vitest";
import { openTestDb, insertTag } from "./helpers.js";
import { createQuestions, getQuestionDetail, searchQuestions } from "../src/domain/questions.js";

describe("ingestion metadata fields (claim_rung, tests_error, provenance, node_key)", () => {
  it("accepts and round-trips all four fields through creation and detail read", () => {
    const db = openTestDb();
    insertTag(db, "algebra");

    const result = createQuestions(db, [
      {
        type: "mc",
        prompt: "Which curve is the derivative of x^2?",
        tags: ["algebra"],
        choices: [
          { body: "2x", is_correct: true, misconception: null },
          { body: "x^2", is_correct: false, misconception: "confuses the function with its own derivative" },
        ],
        claim_rung: "can_discriminate",
        tests_error: "confusing a function with its derivative",
        provenance: "tutor_authored",
        node_key: "calc101:derivative-of-power-rule",
      },
    ]);

    expect(result.created).toHaveLength(1);
    const detail = getQuestionDetail(db, result.created[0].id);
    expect(detail.claim_rung).toBe("can_discriminate");
    expect(detail.tests_error).toBe("confusing a function with its derivative");
    expect(detail.provenance).toBe("tutor_authored");
    expect(detail.node_key).toBe("calc101:derivative-of-power-rule");
  });

  it("leaves all four fields null when not supplied — fully optional, no backfill guess", () => {
    const db = openTestDb();
    insertTag(db, "algebra");
    const result = createQuestions(db, [
      { type: "mc", prompt: "2+2?", tags: ["algebra"], choices: [{ body: "4", is_correct: true }, { body: "5", is_correct: false }] },
    ]);
    const detail = getQuestionDetail(db, result.created[0].id);
    expect(detail.claim_rung).toBeNull();
    expect(detail.tests_error).toBeNull();
    expect(detail.provenance).toBeNull();
    expect(detail.node_key).toBeNull();
  });

  it("rejects an invalid claim_rung value at the domain layer", () => {
    const db = openTestDb();
    insertTag(db, "algebra");
    const result = createQuestions(db, [
      {
        type: "mc",
        prompt: "x",
        tags: ["algebra"],
        choices: [{ body: "a", is_correct: true }, { body: "b", is_correct: false }],
        claim_rung: "can_vibe" as any,
      },
    ]);
    expect(result.created).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("invalid_claim_rung");
  });

  it("node_key is queryable and indexed — searching by it (via a direct SQL check) finds the right question", () => {
    const db = openTestDb();
    insertTag(db, "algebra");
    createQuestions(db, [
      { type: "mc", prompt: "a", tags: ["algebra"], node_key: "calc101:chain-rule", choices: [{ body: "x", is_correct: true }, { body: "y", is_correct: false }] },
      { type: "mc", prompt: "b", tags: ["algebra"], node_key: "calc101:product-rule", choices: [{ body: "x", is_correct: true }, { body: "y", is_correct: false }] },
    ]);
    const row = db.prepare("SELECT prompt FROM question WHERE node_key = ?").get("calc101:chain-rule") as { prompt: string };
    expect(row.prompt).toBe("a");
  });
});
