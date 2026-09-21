import { describe, it, expect } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { listParentTagStats, getTagHistory, getDailyDayDetail } from "../src/domain/resultsDetail.js";

// One submitted attempt with graded mc responses on the given questions.
function attemptWith(
  db: ReturnType<typeof openTestDb>,
  questions: { id: string; score: number }[],
  opts: { submitted_at?: string; source?: string; daily_draw_id?: string | null } = {}
) {
  const attemptId = uuidv4();
  db.prepare(
    "INSERT INTO attempt (id, node_id, source, daily_draw_id, started_at, submitted_at) VALUES (?, 'n', ?, ?, ?, ?)"
  ).run(attemptId, opts.source ?? "adhoc", opts.daily_draw_id ?? null, opts.submitted_at ?? "2026-03-01 10:00:00", opts.submitted_at ?? "2026-03-01 10:00:00");
  questions.forEach((q, i) => {
    const rid = uuidv4();
    db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal, selected_choice_id, answered_at) VALUES (?, ?, ?, ?, NULL, datetime('now'))").run(
      rid, attemptId, q.id, i
    );
    db.prepare("INSERT INTO grade (id, response_id, grader, score, graded_at) VALUES (?, ?, 'auto_mc', ?, datetime('now'))").run(uuidv4(), rid, q.score);
  });
  return attemptId;
}

describe("results subpages", () => {
  it("rolls every descendant up into its top-level parent", () => {
    const db = openTestDb();
    insertTag(db, "math");
    insertTag(db, "math:algebra", "math");
    insertTag(db, "math:algebra:linear", "math:algebra");
    insertTag(db, "econ");
    const q1 = insertQuestion(db, { tags: ["math:algebra:linear"] });
    const q2 = insertQuestion(db, { tags: ["math:algebra"] });
    const q3 = insertQuestion(db, { tags: ["econ"] });
    attemptWith(db, [
      { id: q1.id, score: 1 },
      { id: q2.id, score: 0 },
      { id: q3.id, score: 1 },
    ]);
    const parents = listParentTagStats(db);
    expect(parents.map((p) => [p.tag_slug, p.responses, p.mean_score])).toEqual([
      ["math", 2, 0.5],
      ["econ", 1, 1],
    ]);
    expect(parents[0].child_count).toBe(2);
  });

  it("gives a tag its history by day and each direct child's roll-up", () => {
    const db = openTestDb();
    insertTag(db, "math");
    insertTag(db, "math:algebra", "math");
    insertTag(db, "math:geometry", "math");
    insertTag(db, "math:algebra:linear", "math:algebra");
    const lin = insertQuestion(db, { tags: ["math:algebra:linear"] });
    const geo = insertQuestion(db, { tags: ["math:geometry"] });
    // Use datetime('now') so the 90-day window applies.
    const today = (db.prepare("SELECT datetime('now') AS t").get() as { t: string }).t;
    const yesterday = (db.prepare("SELECT datetime('now', '-1 day') AS t").get() as { t: string }).t;
    attemptWith(db, [{ id: lin.id, score: 0 }], { submitted_at: yesterday });
    attemptWith(db, [{ id: lin.id, score: 1 }, { id: geo.id, score: 1 }], { submitted_at: today });

    const h = getTagHistory(db, "math");
    expect(h.overall.responses).toBe(3);
    expect(h.points.map((p) => [p.mean_score, p.responses])).toEqual([[0, 1], [1, 2]]);
    expect(h.children.map((c) => [c.tag_slug, c.responses, c.mean_score])).toEqual([
      ["math:algebra", 2, 0.5],
      ["math:geometry", 1, 1],
    ]);
    expect(() => getTagHistory(db, "nope")).toThrow(/does not exist/);
  });

  it("describes one day of daily history: the questions, outcomes and tags touched", () => {
    const db = openTestDb();
    insertTag(db, "math");
    insertTag(db, "math:algebra", "math");
    const q = insertQuestion(db, { tags: ["math:algebra"], prompt: "2+2?" });
    const drawId = uuidv4();
    db.prepare("INSERT INTO daily_draw (id, draw_date, kind) VALUES (?, '2026-03-01', 'question')").run(drawId);
    db.prepare("INSERT INTO daily_draw_question (daily_draw_id, question_id, ordinal) VALUES (?, ?, 0)").run(drawId, q.id);
    attemptWith(db, [{ id: q.id, score: 1 }], { source: "daily_question", daily_draw_id: drawId });

    const day = getDailyDayDetail(db, "2026-03-01");
    expect(day.draws).toHaveLength(1);
    expect(day.draws[0].mean_score).toBe(1);
    expect(day.draws[0].responses[0]).toMatchObject({ prompt: "2+2?", outcome: "correct", tags: ["math:algebra"] });
    expect(day.tags_touched).toEqual([{ tag_slug: "math:algebra", responses: 1, day_mean: 1, overall_mean: 1 }]);
    expect(() => getDailyDayDetail(db, "2026-03-02")).toThrow(/No daily draw/);
  });
});
