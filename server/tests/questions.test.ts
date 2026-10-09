import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { createAsset } from "../src/domain/assets.js";
import { createQuestions, editQuestion } from "../src/domain/questions.js";
import { questionSnapshot } from "../src/domain/attempts.js";

describe("document_marker_offset validation", () => {
  it("rejects an offset landing in whitespace, accepts one on a token boundary", async () => {
    const db = openTestDb();
    insertTag(db, "english");

    const asset = await createAsset(
      db,
      "/tmp/osmosis-test-uploads",
      {
        title: "Passage",
        type: "text",
        // Two spaces between "revise" and "(A)" so offset 7 sits strictly
        // inside the whitespace run — not adjacent to any token on either
        // side (findTokenSpan's single-char fallback only reaches one space
        // back, so this is the case that has to return null).
        content: "revise  (A) as follows",
      },
      "claude"
    );

    // offset 7 is the second of the two spaces — genuinely mid-whitespace.
    const rejected = createQuestions(db, [
      {
        type: "mc",
        prompt: "Which revision is best?",
        tags: ["english"],
        choices: [
          { body: "Leave as is", is_correct: true },
          { body: "Something else", is_correct: false, misconception: "m" },
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
          { body: "Something else", is_correct: false, misconception: "m" },
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
          { body: "Something else", is_correct: false, misconception: "m" },
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

    const asset = await createAsset(
      db,
      "/tmp/osmosis-test-uploads",
      {
        title: "Source article",
        type: "url",
        content: "https://example.com/article",
      },
      "claude"
    );
    expect(asset.extracted_text).toBeNull();

    const result = createQuestions(db, [
      {
        type: "mc",
        prompt: "What year did this happen?",
        tags: ["history"],
        choices: [
          { body: "1776", is_correct: true },
          { body: "1812", is_correct: false, misconception: "m" },
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
          { body: "the nucleus", is_correct: false, misconception: "m" },
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

// Regression: the 2026-08-21 MCP stress test v2 accidentally wrote a 5-choice
// mc question (readme()'s prompt_conventions says "4 choices, exactly one
// correct unless testing a multi-select concept") and create_questions
// accepted it silently — no signal back to the author that the convention
// was violated. This is deliberately non-blocking (choice count isn't a hard
// schema constraint, an author may have a real reason to deviate), but the
// author should get a warning rather than total silence.
describe("mc choice-count warning", () => {
  it("warns, but still creates, an mc question with other than 4 choices", () => {
    const db = openTestDb();
    insertTag(db, "math");

    const result = createQuestions(db, [
      {
        type: "mc",
        prompt: "Which of these double an investment fastest?",
        tags: ["math"],
        choices: [
          { body: "A", is_correct: true },
          { body: "B", is_correct: false, misconception: "m" },
          { body: "C", is_correct: false, misconception: "m" },
          { body: "D", is_correct: false, misconception: "m" },
          { body: "E", is_correct: false, misconception: "m" },
        ],
      },
    ]);

    expect(result.created).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].index).toBe(0);
    expect(result.warnings[0].message.toLowerCase()).toContain("4 choices");
  });

  it("does not warn on a real 4-choice mc question", () => {
    const db = openTestDb();
    insertTag(db, "math");

    const result = createQuestions(db, [
      {
        type: "mc",
        prompt: "What is 2 + 2?",
        tags: ["math"],
        choices: [
          { body: "3", is_correct: false, misconception: "m" },
          { body: "4", is_correct: true },
          { body: "5", is_correct: false, misconception: "m" },
          { body: "6", is_correct: false, misconception: "m" },
        ],
      },
    ]);

    expect(result.created).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });

  it("does not warn on written questions (no choices field at all)", () => {
    const db = openTestDb();
    insertTag(db, "math");

    const result = createQuestions(db, [
      { type: "written", prompt: "Explain why.", tags: ["math"], model_answer: "Because." },
    ]);

    expect(result.created).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("document offsets are codepoint indices", () => {
  const mc = (extra: Record<string, unknown>) => ({
    type: "mc" as const,
    prompt: "Which revision is best?",
    tags: ["english"],
    choices: [
      { body: "Leave as is", is_correct: true },
      { body: "Something else", is_correct: false, misconception: "m" },
    ],
    ...extra,
  });
  // "😀 hello world": 13 codepoints, 14 UTF-16 code units. "h" is codepoint 2.
  const content = "😀 hello world";

  async function setup() {
    const db = openTestDb();
    insertTag(db, "english");
    const asset = await createAsset(db, "/tmp/osmosis-test-uploads", { title: "Emoji", type: "text", content }, "claude");
    return { db, asset };
  }

  it("validates an anchor in codepoints and rejects an end beyond cpLength", async () => {
    const { db, asset } = await setup();
    const ok = createQuestions(db, [mc({ document_id: asset.id, document_anchor_start: 2, document_anchor_end: 13 })]);
    expect(ok.rejected).toHaveLength(0);
    expect(ok.created).toHaveLength(1);
    const row = db.prepare("SELECT document_anchor_end AS e FROM question WHERE id = ?").get(ok.created[0]!.id) as { e: number };
    expect(row.e).toBe(13);
    const bad = createQuestions(db, [mc({ document_id: asset.id, document_anchor_start: 2, document_anchor_end: 14 })]);
    expect(bad.created).toHaveLength(0);
    expect(bad.rejected[0]?.reason).toBe("invalid_document_anchor");
  });

  it("validates a marker landing on the token after an emoji", async () => {
    const { db, asset } = await setup();
    const ok = createQuestions(db, [mc({ document_id: asset.id, document_marker_offset: 2 })]);
    expect(ok.rejected).toHaveLength(0);
    const ws = createQuestions(db, [mc({ document_id: asset.id, document_marker_offset: 1 })]);
    expect(ws.rejected[0]?.reason).toBe("invalid_document_marker");
    const oob = createQuestions(db, [mc({ document_id: asset.id, document_marker_offset: 14 })]);
    expect(oob.rejected[0]?.reason).toBe("invalid_document_marker");
  });
});

describe("anchor and marker quotes", () => {
  const mc = (extra: Record<string, unknown>) => ({
    type: "mc" as const,
    prompt: "Which revision is best?",
    tags: ["english"],
    choices: [
      { body: "Leave as is", is_correct: true },
      { body: "Something else", is_correct: false, misconception: "m" },
    ],
    ...extra,
  });
  const content = "😀 hello world";

  async function setup() {
    const db = openTestDb();
    insertTag(db, "english");
    const asset = await createAsset(db, "/tmp/osmosis-test-uploads", { title: "Q", type: "text", content }, "claude");
    return { db, asset };
  }
  const quotes = (db: ReturnType<typeof openTestDb>, id: string) =>
    db.prepare("SELECT document_anchor_quote AS a, document_marker_quote AS m FROM question WHERE id = ?").get(id) as {
      a: string | null;
      m: string | null;
    };

  it("stores the anchor and marker quotes (emoji-safe) and returns them in the snapshot", async () => {
    const { db, asset } = await setup();
    const r = createQuestions(db, [
      mc({ document_id: asset.id, document_anchor_start: 0, document_anchor_end: 7, document_marker_offset: 2 }),
    ]);
    const id = r.created[0]!.id;
    expect(quotes(db, id)).toEqual({ a: "😀 hello", m: "hello" });
    const snap = questionSnapshot(db, id, false);
    expect(snap.document_anchor_quote).toBe("😀 hello");
    expect(snap.document_marker_quote).toBe("hello");
  });

  it("updates the quote when the anchor changes and clears it when the anchor is cleared", async () => {
    const { db, asset } = await setup();
    const id = createQuestions(db, [mc({ document_id: asset.id, document_anchor_start: 2, document_anchor_end: 7 })])
      .created[0]!.id;
    expect(quotes(db, id).a).toBe("hello");
    editQuestion(db, id, { document_anchor_start: 8, document_anchor_end: 13 });
    expect(quotes(db, id).a).toBe("world");
    editQuestion(db, id, { document_anchor_start: null, document_anchor_end: null });
    expect(quotes(db, id)).toEqual({ a: null, m: null });
  });

  it("legacy rows with null quotes still read fine", async () => {
    const { db, asset } = await setup();
    const id = createQuestions(db, [mc({ document_id: asset.id, document_anchor_start: 2, document_anchor_end: 7 })])
      .created[0]!.id;
    db.prepare("UPDATE question SET document_anchor_quote = NULL WHERE id = ?").run(id);
    const snap = questionSnapshot(db, id, false);
    expect(snap.document_anchor_quote).toBeNull();
    expect(snap.document_anchor_start).toBe(2);
  });

  function attempt(db: ReturnType<typeof openTestDb>, qid: string) {
    db.prepare(
      "INSERT INTO attempt (id, node_id, source, started_at, submitted_at) VALUES ('at1', 'n', 'adhoc', datetime('now'), datetime('now'))"
    ).run();
    db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal) VALUES ('rs1', 'at1', ?, 0)").run(qid);
  }

  it("versioned edit: new row gets the new anchor quote, the old row keeps the old one", async () => {
    const { db, asset } = await setup();
    const id = createQuestions(db, [mc({ document_id: asset.id, document_anchor_start: 2, document_anchor_end: 7 })])
      .created[0]!.id;
    attempt(db, id);
    const r = editQuestion(db, id, { document_anchor_end: 13 });
    expect(r.versioned).toBe(true);
    expect(quotes(db, r.id).a).toBe("hello world");
    expect(quotes(db, id).a).toBe("hello");
  });

  it("versioned edit: moving only the marker updates the marker quote", async () => {
    const { db, asset } = await setup();
    const id = createQuestions(db, [mc({ document_id: asset.id, document_marker_offset: 2 })]).created[0]!.id;
    attempt(db, id);
    const r = editQuestion(db, id, { document_marker_offset: 8 });
    expect(r.versioned).toBe(true);
    expect(quotes(db, r.id).m).toBe("world");
    expect(quotes(db, id).m).toBe("hello");
  });

  it("an unrelated edit backfills quotes on a legacy row (versioned and in place)", async () => {
    for (const withAttempt of [false, true]) {
      const { db, asset } = await setup();
      const id = createQuestions(db, [
        mc({ document_id: asset.id, document_anchor_start: 2, document_anchor_end: 7, document_marker_offset: 2 }),
      ]).created[0]!.id;
      db.prepare("UPDATE question SET document_anchor_quote = NULL, document_marker_quote = NULL WHERE id = ?").run(id);
      if (withAttempt) attempt(db, id);
      const r = editQuestion(db, id, { prompt: "Reworded?" });
      expect(r.versioned).toBe(withAttempt);
      expect(quotes(db, r.id)).toEqual({ a: "hello", m: "hello" });
    }
  });

  it("rejects non-integer anchor and marker offsets", async () => {
    const { db, asset } = await setup();
    const m = createQuestions(db, [mc({ document_id: asset.id, document_marker_offset: 2.5 })]);
    expect(m.rejected[0]?.reason).toBe("invalid_document_marker");
    const a = createQuestions(db, [mc({ document_id: asset.id, document_anchor_start: 1.5, document_anchor_end: 7 })]);
    expect(a.rejected[0]?.reason).toBe("invalid_document_anchor");
    const e = createQuestions(db, [mc({ document_id: asset.id, document_anchor_start: 1, document_anchor_end: 7.5 })]);
    expect(e.rejected[0]?.reason).toBe("invalid_document_anchor");
  });
});
