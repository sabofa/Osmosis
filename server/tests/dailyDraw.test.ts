import { describe, it, expect } from "vitest";
import { computeDrawDate, resolveDailyDraw } from "../src/domain/dailyDraw.js";
import { insertTag, insertQuestion, openTestDb, mulberry32 } from "./helpers.js";

describe("computeDrawDate", () => {
  it("computes YYYY-MM-DD in config.daily_timezone, not UTC", () => {
    const db = openTestDb();
    db.prepare("UPDATE config SET value = ? WHERE key = 'daily_timezone'").run(JSON.stringify("America/Los_Angeles"));
    // 2026-01-01 06:00 UTC is still 2025-12-31 22:00 in America/Los_Angeles (PST, UTC-8)
    const date = computeDrawDate(db, new Date("2026-01-01T06:00:00Z"));
    expect(date).toBe("2025-12-31");
  });
});

describe("resolveDailyDraw", () => {
  it("generates a daily question lazily and caches it for the same date", () => {
    const db = openTestDb();
    insertTag(db, "math");
    for (let i = 0; i < 5; i++) insertQuestion(db, { tags: ["math"] });

    const first = resolveDailyDraw(db, "question", new Date("2026-08-20T12:00:00Z"));
    expect(first.questions.length).toBe(1);
    expect(first.kind).toBe("question");
    expect(first.exclusion_relaxed).not.toBeNull(); // freshly generated

    const second = resolveDailyDraw(db, "question", new Date("2026-08-20T18:00:00Z")); // same date, different hour
    expect(second.daily_draw_id).toBe(first.daily_draw_id);
    expect(second.questions).toEqual(first.questions); // cached, not re-drawn
  });

  it("excludes lineages drawn within daily_exclusion_days, relaxing when the pool is too small", () => {
    const db = openTestDb();
    db.prepare("UPDATE config SET value = ? WHERE key = 'daily_exclusion_days'").run(JSON.stringify(2));
    insertTag(db, "math");
    const only = insertQuestion(db, { tags: ["math"] }); // exactly one question in the whole bank

    const day1 = resolveDailyDraw(db, "question", new Date("2026-08-18T12:00:00Z"));
    expect(day1.questions[0].id).toBe(only.id);

    // Next day: the only question was drawn yesterday (within the 2-day window), so
    // strict exclusion leaves zero eligible — relaxation must kick in and still return it.
    const day2 = resolveDailyDraw(db, "question", new Date("2026-08-19T12:00:00Z"));
    expect(day2.questions[0].id).toBe(only.id);
    expect(day2.exclusion_relaxed).toBe(0); // fully relaxed to reuse it
    expect(day2.short_draw).toBe(false); // exactly enough once relaxed
  });

  it("a re-versioned question's new id is still excluded by its shared lineage", () => {
    const db = openTestDb();
    db.prepare("UPDATE config SET value = ? WHERE key = 'daily_exclusion_days'").run(JSON.stringify(2));
    insertTag(db, "math");
    const q1 = insertQuestion(db, { tags: ["math"] });
    const q2 = insertQuestion(db, { tags: ["math"] }); // second, distinct lineage

    // q1 and q2 tie in weak_weighted weight (neither has been answered yet), so
    // which one day1 draws is a genuine coin flip under Math.random — seed the
    // rng so this test deterministically draws q1 first, matching the scenario
    // this test is actually about (q1's lineage being excluded the next day).
    const day1 = resolveDailyDraw(db, "question", new Date("2026-08-18T12:00:00Z"), mulberry32(7));
    expect(day1.questions[0].id).toBe(q1.id);

    // Simulate q1 being edited (re-versioned): new id, SAME lineage_id, old row retired.
    db.exec("BEGIN");
    db.prepare("UPDATE question SET retired_at = datetime('now') WHERE id = ?").run(q1.id);
    const newVersionId = "q1-v2";
    db.prepare(
      `INSERT INTO question (id, lineage_id, version, type, prompt, difficulty, calculator_policy)
       VALUES (?, ?, 2, 'mc', 'edited prompt', 3, 'n_a')`
    ).run(newVersionId, q1.lineage_id);
    db.prepare("INSERT INTO question_tag (question_id, tag_slug) VALUES (?, 'math')").run(newVersionId);
    db.prepare("INSERT INTO choice (id, question_id, body, is_correct, ordinal) VALUES ('c1', ?, 'a', 1, 0)").run(newVersionId);
    db.exec("COMMIT");

    const day2 = resolveDailyDraw(db, "question", new Date("2026-08-19T12:00:00Z"));
    // Only q2 is truly unexcluded (q1's lineage was drawn yesterday, and its new
    // version shares that lineage) — day2 must draw q2, not newVersionId.
    expect(day2.questions[0].id).toBe(q2.id);
  });

  it("drawing the daily quiz excludes the same day's already-drawn daily question's lineage", () => {
    const db = openTestDb();
    insertTag(db, "math");
    const q1 = insertQuestion(db, { tags: ["math"] });
    const q2 = insertQuestion(db, { tags: ["math"] });
    const now = new Date("2026-08-20T12:00:00Z");

    const dailyQuestion = resolveDailyDraw(db, "question", now);
    const dailyQuiz = resolveDailyDraw(db, "quiz", now);

    expect(dailyQuiz.questions.map((q) => q.id)).not.toContain(dailyQuestion.questions[0].id);
    expect(dailyQuiz.questions.map((q) => q.id)).toContain(
      dailyQuestion.questions[0].id === q1.id ? q2.id : q1.id
    );
  });

  it("returns a short draw with exclusion_relaxed 0 when the bank genuinely can't fill the quiz", () => {
    const db = openTestDb();
    db.prepare("UPDATE config SET value = ? WHERE key = 'daily_quiz_size'").run(JSON.stringify(10));
    insertTag(db, "math");
    insertQuestion(db, { tags: ["math"] }); // only 1 question, quiz wants 10

    const quiz = resolveDailyDraw(db, "quiz", new Date("2026-08-20T12:00:00Z"));
    expect(quiz.short_draw).toBe(true);
    expect(quiz.exclusion_relaxed).toBe(0);
    expect(quiz.requested).toBe(10);
    expect(quiz.returned).toBeLessThanOrEqual(1); // minus whatever the daily question already took
  });

  it("daily_tag_filter restricts both kinds to a subtree when set", () => {
    const db = openTestDb();
    insertTag(db, "math");
    insertTag(db, "history");
    const mathQ = insertQuestion(db, { tags: ["math"] });
    insertQuestion(db, { tags: ["history"] });
    db.prepare("UPDATE config SET value = ? WHERE key = 'daily_tag_filter'").run(JSON.stringify({ all: ["math"] }));

    const daily = resolveDailyDraw(db, "question", new Date("2026-08-20T12:00:00Z"));
    expect(daily.questions[0].id).toBe(mathQ.id);
  });
});
