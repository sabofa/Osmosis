import { describe, it, expect } from "vitest";
import { openTestDb, insertTag } from "./helpers.js";
import { createQuestions, getQuestionDetail, searchQuestions, editQuestion } from "../src/domain/questions.js";

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

  it("editQuestion can update all four fields in-place (no attempts path)", () => {
    const db = openTestDb();
    insertTag(db, "algebra");

    // Create a question with the four fields
    const created = createQuestions(db, [
      {
        type: "mc",
        prompt: "original",
        tags: ["algebra"],
        choices: [{ body: "a", is_correct: true }, { body: "b", is_correct: false }],
        claim_rung: "can_state",
        tests_error: "first error",
        provenance: "textbook_sourced",
        node_key: "orig:key",
      },
    ]);
    const id = created.created[0].id;

    // Edit all four fields (no attempts yet, so in-place update)
    const edited = editQuestion(db, id, {
      prompt: "updated",
      claim_rung: "can_explain_why",
      tests_error: "second error",
      provenance: "tutor_authored",
      node_key: "new:key",
    });

    expect(edited.versioned).toBe(false); // in-place edit, not versioned
    const detail = getQuestionDetail(db, id);
    expect(detail.prompt).toBe("updated");
    expect(detail.claim_rung).toBe("can_explain_why");
    expect(detail.tests_error).toBe("second error");
    expect(detail.provenance).toBe("tutor_authored");
    expect(detail.node_key).toBe("new:key");
  });

  it("editQuestion preserves all four fields when not specified in changes (no attempts path)", () => {
    const db = openTestDb();
    insertTag(db, "algebra");

    const created = createQuestions(db, [
      {
        type: "mc",
        prompt: "original",
        tags: ["algebra"],
        choices: [{ body: "a", is_correct: true }, { body: "b", is_correct: false }],
        claim_rung: "can_discriminate",
        tests_error: "original error",
        provenance: "tutor_authored",
        node_key: "stable:key",
      },
    ]);
    const id = created.created[0].id;

    // Edit only the prompt, leave the four fields untouched
    editQuestion(db, id, {
      prompt: "new prompt",
    });

    const detail = getQuestionDetail(db, id);
    expect(detail.claim_rung).toBe("can_discriminate");
    expect(detail.tests_error).toBe("original error");
    expect(detail.provenance).toBe("tutor_authored");
    expect(detail.node_key).toBe("stable:key");
  });

  it("editQuestion can update all four fields with versioning (has attempts path)", () => {
    const db = openTestDb();
    insertTag(db, "algebra");

    // Create a question
    const created = createQuestions(db, [
      {
        type: "mc",
        prompt: "original",
        tags: ["algebra"],
        choices: [{ body: "a", is_correct: true }, { body: "b", is_correct: false }],
        claim_rung: "can_state",
        tests_error: "first error",
        provenance: "textbook_sourced",
        node_key: "orig:key",
      },
    ]);
    const originalId = created.created[0].id;

    // Create an attempt to force versioning on edit
    const attemptId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const responseId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    db.prepare(
      `INSERT INTO attempt (id, node_id, source, started_at)
       VALUES (?, ?, ?, datetime('now'))`
    ).run(attemptId, "node-123", "adhoc");

    db.prepare(
      `INSERT INTO response (id, attempt_id, question_id, ordinal)
       VALUES (?, ?, ?, 0)`
    ).run(responseId, attemptId, originalId);

    // Now edit the question — it should create a new version
    const edited = editQuestion(db, originalId, {
      prompt: "updated",
      claim_rung: "can_explain_why",
      tests_error: "second error",
      provenance: "tutor_authored",
      node_key: "new:key",
    });

    expect(edited.versioned).toBe(true);
    expect(edited.version).toBe(2);
    expect(edited.supersedes_id).toBe(originalId);

    // New version should have updated fields
    const newDetail = getQuestionDetail(db, edited.id);
    expect(newDetail.version).toBe(2);
    expect(newDetail.prompt).toBe("updated");
    expect(newDetail.claim_rung).toBe("can_explain_why");
    expect(newDetail.tests_error).toBe("second error");
    expect(newDetail.provenance).toBe("tutor_authored");
    expect(newDetail.node_key).toBe("new:key");

    // Old version should be retired
    const oldDetail = getQuestionDetail(db, originalId);
    expect(oldDetail.retired_at).not.toBeNull();
  });

  it("editQuestion preserves all four fields when not specified in changes (has attempts path)", () => {
    const db = openTestDb();
    insertTag(db, "algebra");

    const created = createQuestions(db, [
      {
        type: "mc",
        prompt: "original",
        tags: ["algebra"],
        choices: [{ body: "a", is_correct: true }, { body: "b", is_correct: false }],
        claim_rung: "can_transfer",
        tests_error: "original error",
        provenance: "textbook_sourced",
        node_key: "stable:key",
      },
    ]);
    const originalId = created.created[0].id;

    // Create an attempt to force versioning
    const attemptId2 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const responseId2 = "dddddddd-dddd-dddd-dddd-dddddddddddd";

    db.prepare(
      `INSERT INTO attempt (id, node_id, source, started_at)
       VALUES (?, ?, ?, datetime('now'))`
    ).run(attemptId2, "node-456", "adhoc");

    db.prepare(
      `INSERT INTO response (id, attempt_id, question_id, ordinal)
       VALUES (?, ?, ?, 0)`
    ).run(responseId2, attemptId2, originalId);

    // Edit only the prompt
    const edited = editQuestion(db, originalId, {
      prompt: "new prompt",
    });

    // New version should preserve the four fields
    const newDetail = getQuestionDetail(db, edited.id);
    expect(newDetail.claim_rung).toBe("can_transfer");
    expect(newDetail.tests_error).toBe("original error");
    expect(newDetail.provenance).toBe("textbook_sourced");
    expect(newDetail.node_key).toBe("stable:key");
  });
});
