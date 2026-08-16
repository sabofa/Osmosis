import { describe, it, expect } from "vitest";
import {
  getEligibleQuestions,
  computeWeakWeights,
  weightedSampleWithoutReplacement,
  resolveDrawFromParams,
  resolveFrozenDraw,
} from "../src/domain/draw.js";
import { insertTag, insertQuestion, seedScoredResponse, isoAgo, mulberry32, openTestDb } from "./helpers.js";

describe("tag query eligibility", () => {
  it("none actually excludes", () => {
    const db = openTestDb();
    insertTag(db, "a");
    insertTag(db, "b");
    const keep = insertQuestion(db, { tags: ["a"] });
    const drop = insertQuestion(db, { tags: ["a", "b"] });

    const pool = getEligibleQuestions(db, { tag_query: { all: ["a"], none: ["b"] } });

    expect(pool.map((q) => q.id)).toEqual([keep.id]);
    expect(pool.map((q) => q.id)).not.toContain(drop.id);
  });

  it("descendant expansion resolves", () => {
    const db = openTestDb();
    insertTag(db, "math");
    insertTag(db, "math:functions", "math");
    insertTag(db, "math:functions:quadratic", "math:functions");
    const deep = insertQuestion(db, { tags: ["math:functions:quadratic"] });
    const unrelated = insertQuestion(db, { tags: ["math"] });

    const pool = getEligibleQuestions(db, { tag_query: { all: ["math"] } });
    const ids = pool.map((q) => q.id);

    expect(ids).toContain(deep.id);
    expect(ids).toContain(unrelated.id);
  });

  it("excludes retired questions and non-latest versions", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const retired = insertQuestion(db, { tags: ["a"] });
    db.prepare("UPDATE question SET retired_at = datetime('now'), retired_reason = 'x' WHERE id = ?").run(
      retired.id
    );
    const current = insertQuestion(db, { tags: ["a"] });

    const pool = getEligibleQuestions(db, { tag_query: { all: ["a"] } });

    expect(pool.map((q) => q.id)).toEqual([current.id]);
  });
});

describe("weak_weighted", () => {
  it("computes the documented weight formula", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const unanswered = insertQuestion(db, { tags: ["a"] });
    const alwaysRight = insertQuestion(db, { tags: ["a"] });
    const alwaysWrong = insertQuestion(db, { tags: ["a"] });
    const recentRight = insertQuestion(db, { tags: ["a"] });

    seedScoredResponse(db, alwaysRight.id, 1.0, isoAgo(48));
    seedScoredResponse(db, alwaysWrong.id, 0.0, isoAgo(48));
    seedScoredResponse(db, recentRight.id, 1.0, isoAgo(1));

    const pool = getEligibleQuestions(db, { tag_query: { all: ["a"] } });
    const weights = computeWeakWeights(db, pool);
    const byId = new Map(pool.map((q, i) => [q.id, weights[i]]));

    expect(byId.get(unanswered.id)).toBeCloseTo(2.0, 5); // s=0.5, r=1.0 -> (1+2*0.5)*1
    expect(byId.get(alwaysRight.id)).toBeCloseTo(1.0, 5); // s=1.0, r=1.0 -> (1+0)*1
    expect(byId.get(alwaysWrong.id)).toBeCloseTo(3.0, 5); // s=0.0, r=1.0 -> (1+2)*1
    expect(byId.get(recentRight.id)).toBeCloseTo(0.25, 5); // s=1.0, r=0.25 -> (1+0)*0.25
  });

  it("produces the expected sampling distribution over 10k draws", () => {
    const items = ["A", "B", "C"];
    const weights = [2.0, 1.0, 3.0]; // total 6 -> expected P: A=1/3, B=1/6, C=1/2
    const rng = mulberry32(42);

    const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
    const trials = 10000;
    for (let i = 0; i < trials; i++) {
      const [picked] = weightedSampleWithoutReplacement(items, weights, 1, rng);
      counts[picked]++;
    }

    expect(counts.A / trials).toBeCloseTo(1 / 3, 1);
    expect(counts.B / trials).toBeCloseTo(1 / 6, 1);
    expect(counts.C / trials).toBeCloseTo(1 / 2, 1);
  });
});

describe("mc_ratio partitioning", () => {
  it("backfills from the other side when one is short and flags mix_adjusted", () => {
    const db = openTestDb();
    insertTag(db, "a");
    for (let i = 0; i < 2; i++) insertQuestion(db, { tags: ["a"], type: "mc" });
    for (let i = 0; i < 5; i++) insertQuestion(db, { tags: ["a"], type: "written" });

    const result = resolveDrawFromParams(db, {
      tag_query: { all: ["a"] },
      question_count: 6,
      mc_ratio: 0.5,
      weighting: "random",
    });

    // mc wants 3, only 2 available -> deficit 1 backfilled from written (5 available)
    const mcCount = result.questions.filter((q) => q.type === "mc").length;
    const writtenCount = result.questions.filter((q) => q.type === "written").length;

    expect(mcCount).toBe(2);
    expect(writtenCount).toBe(4);
    expect(result.mix_adjusted).toBe(true);
    expect(result.returned).toBe(6);
    expect(result.short_draw).toBe(false);
  });

  it("does not flag mix_adjusted when both sides have enough", () => {
    const db = openTestDb();
    insertTag(db, "a");
    for (let i = 0; i < 5; i++) insertQuestion(db, { tags: ["a"], type: "mc" });
    for (let i = 0; i < 5; i++) insertQuestion(db, { tags: ["a"], type: "written" });

    const result = resolveDrawFromParams(db, {
      tag_query: { all: ["a"] },
      question_count: 6,
      mc_ratio: 0.5,
      weighting: "random",
    });

    expect(result.mix_adjusted).toBe(false);
    expect(result.returned).toBe(6);
  });
});

describe("short draws", () => {
  it("returns the whole pool without repeats and flags short_draw", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const seeded = [insertQuestion(db, { tags: ["a"] }), insertQuestion(db, { tags: ["a"] }), insertQuestion(db, { tags: ["a"] })];

    const result = resolveDrawFromParams(db, {
      tag_query: { all: ["a"] },
      question_count: 10,
      weighting: "random",
    });

    expect(result.short_draw).toBe(true);
    expect(result.requested).toBe(10);
    expect(result.returned).toBe(3);
    expect(new Set(result.questions.map((q) => q.id)).size).toBe(3);
    expect(result.questions.map((q) => q.id).sort()).toEqual(seeded.map((q) => q.id).sort());
  });
});

describe("frozen templates", () => {
  it("returns questions in stored order, not insertion order", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q1 = insertQuestion(db, { tags: ["a"] });
    const q2 = insertQuestion(db, { tags: ["a"] });
    const q3 = insertQuestion(db, { tags: ["a"] });

    const templateId = "11111111-1111-1111-1111-111111111111";
    db.prepare(
      "INSERT INTO template (id, name, tag_query, question_count, frozen) VALUES (?, 't', '{}', 3, 1)"
    ).run(templateId);

    // Store in a deliberately different order than insertion (q3, q1, q2).
    const insert = db.prepare(
      "INSERT INTO template_frozen_question (template_id, question_id, ordinal) VALUES (?, ?, ?)"
    );
    insert.run(templateId, q3.id, 0);
    insert.run(templateId, q1.id, 1);
    insert.run(templateId, q2.id, 2);

    const result = resolveFrozenDraw(db, templateId);

    expect(result.map((q) => q.id)).toEqual([q3.id, q1.id, q2.id]);
  });
});
