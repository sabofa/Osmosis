import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { createAsset } from "../src/domain/assets.js";
import { createQuestions } from "../src/domain/questions.js";

describe("document_marker_offset validation", () => {
  it("rejects an offset landing in whitespace, accepts one on a token boundary", async () => {
    const db = openTestDb();
    insertTag(db, "english");

    const asset = await createAsset(db, "/tmp/osmosis-test-uploads", {
      title: "Passage",
      type: "text",
      // Two spaces between "revise" and "(A)" so offset 7 sits strictly
      // inside the whitespace run — not adjacent to any token on either
      // side (findTokenSpan's single-char fallback only reaches one space
      // back, so this is the case that has to return null).
      content: "revise  (A) as follows",
    });

    // offset 7 is the second of the two spaces — genuinely mid-whitespace.
    const rejected = createQuestions(db, [
      {
        type: "mc",
        prompt: "Which revision is best?",
        tags: ["english"],
        choices: [
          { body: "Leave as is", is_correct: true },
          { body: "Something else", is_correct: false },
        ],
        document_id: asset.id,
        document_marker_offset: 7,
      },
    ]);
    expect(rejected.created).toHaveLength(0);
    expect(rejected.rejected[0]?.reason).toBe("invalid_document_marker");

    // offset 9 lands on the "A" inside "(A)" — a real token.
    const accepted = createQuestions(db, [
      {
        type: "mc",
        prompt: "Which revision is best?",
        tags: ["english"],
        choices: [
          { body: "Leave as is", is_correct: true },
          { body: "Something else", is_correct: false },
        ],
        document_id: asset.id,
        document_marker_offset: 9,
      },
    ]);
    expect(accepted.rejected).toHaveLength(0);
    expect(accepted.created).toHaveLength(1);
  });

  it("rejects a marker offset without a document_id", () => {
    const db = openTestDb();
    insertTag(db, "english");

    const result = createQuestions(db, [
      {
        type: "mc",
        prompt: "Which revision is best?",
        tags: ["english"],
        choices: [
          { body: "Leave as is", is_correct: true },
          { body: "Something else", is_correct: false },
        ],
        document_marker_offset: 3,
      },
    ]);
    expect(result.created).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("invalid_document_marker");
  });

  it("rejects any document_anchor_* or document_marker_offset against a url asset", async () => {
    const db = openTestDb();
    insertTag(db, "history");

    const asset = await createAsset(db, "/tmp/osmosis-test-uploads", {
      title: "Source article",
      type: "url",
      content: "https://example.com/article",
    });
    expect(asset.extracted_text).toBeNull();

    const result = createQuestions(db, [
      {
        type: "mc",
        prompt: "What year did this happen?",
        tags: ["history"],
        choices: [
          { body: "1776", is_correct: true },
          { body: "1812", is_correct: false },
        ],
        document_id: asset.id,
        document_anchor_start: 0,
        document_anchor_end: 5,
      },
    ]);
    expect(result.created).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("invalid_document_anchor");
  });
});

describe("possible_duplicates", () => {
  it("caps reported duplicates at 3 and truncates the preview to 120 chars", () => {
    const db = openTestDb();
    insertTag(db, "biology");

    const variants = [
      "what is the mitochondria known as in a plant cell",
      "what is the mitochondria known as within a cell",
      "what is the mitochondria referred to as in a cell",
      "what is the mitochondria known as in an animal cell",
      "what is the mitochondria known as inside a cell",
    ];
    for (const prompt of variants) {
      insertQuestion(db, { tags: ["biology"], prompt: `${prompt} ${"x".repeat(200)}` });
    }

    const result = createQuestions(db, [
      {
        type: "mc",
        prompt: "what is the mitochondria known as in a cell",
        tags: ["biology"],
        choices: [
          { body: "the powerhouse of the cell", is_correct: true },
          { body: "the nucleus", is_correct: false },
        ],
      },
    ]);

    expect(result.created).toHaveLength(1);
    expect(result.possible_duplicates.length).toBeLessThanOrEqual(3);
    expect(result.possible_duplicates.length).toBeGreaterThan(0);
    for (const dup of result.possible_duplicates) {
      expect(dup.existing_prompt.length).toBeLessThanOrEqual(123); // 120 + "..."
    }
  });
});
