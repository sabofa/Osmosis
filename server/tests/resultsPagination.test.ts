import { describe, it, expect } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { getResults } from "../src/domain/results.js";
import { insertTag, insertQuestion, seedScoredResponse, isoAgo, openTestDb } from "./helpers.js";

describe("get_results offset", () => {
  it("tag scope: offset skips past the first page", () => {
    const db = openTestDb();
    for (const slug of ["a", "b", "c"]) {
      insertTag(db, slug);
      const q = insertQuestion(db, { tags: [slug] });
      seedScoredResponse(db, q.id, 0.5, isoAgo(1));
    }
    const page1 = getResults(db, { scope: "tag", limit: 2, offset: 0 }) as { tags: any[] };
    const page2 = getResults(db, { scope: "tag", limit: 2, offset: 2 }) as { tags: any[] };
    expect(page1.tags).toHaveLength(2);
    expect(page2.tags).toHaveLength(1);
    const slugsPage1 = page1.tags.map((t) => t.tag_slug);
    const slugsPage2 = page2.tags.map((t) => t.tag_slug);
    expect(slugsPage1.some((s) => slugsPage2.includes(s))).toBe(false);
  });

  it("question scope: offset skips past the first page", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q1 = insertQuestion(db, { tags: ["a"] });
    const q2 = insertQuestion(db, { tags: ["a"] });
    seedScoredResponse(db, q1.id, 0.0, isoAgo(1));
    seedScoredResponse(db, q2.id, 0.5, isoAgo(1));
    const page1 = getResults(db, { scope: "question", limit: 1, offset: 0 }) as { questions: any[] };
    const page2 = getResults(db, { scope: "question", limit: 1, offset: 1 }) as { questions: any[] };
    expect(page1.questions[0].lineage_id).not.toBe(page2.questions[0].lineage_id);
  });

  it("attempt scope: offset skips past the first page", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });
    // Three distinct submitted attempts, most recent first per ORDER BY submitted_at DESC.
    seedScoredResponse(db, q.id, 0.5, isoAgo(3));
    seedScoredResponse(db, q.id, 0.5, isoAgo(2));
    seedScoredResponse(db, q.id, 0.5, isoAgo(1));

    const page1 = getResults(db, { scope: "attempt", limit: 2, offset: 0 }) as { attempts: any[] };
    const page2 = getResults(db, { scope: "attempt", limit: 2, offset: 2 }) as { attempts: any[] };
    expect(page1.attempts).toHaveLength(2);
    expect(page2.attempts).toHaveLength(1);
    const idsPage1 = page1.attempts.map((a) => a.id);
    const idsPage2 = page2.attempts.map((a) => a.id);
    expect(idsPage1.some((id) => idsPage2.includes(id))).toBe(false);
  });

  it("daily scope: offset skips past the first page", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"] });

    for (const drawDate of ["2026-08-28", "2026-08-29", "2026-08-30"]) {
      const drawId = uuidv4();
      db.prepare("INSERT INTO daily_draw (id, draw_date, kind) VALUES (?, ?, 'question')").run(drawId, drawDate);
      db.prepare("INSERT INTO daily_draw_question (daily_draw_id, question_id, ordinal) VALUES (?, ?, 0)").run(
        drawId,
        q.id
      );
    }

    const page1 = getResults(db, { scope: "daily", limit: 2, offset: 0 }) as { daily: any[] };
    const page2 = getResults(db, { scope: "daily", limit: 2, offset: 2 }) as { daily: any[] };
    expect(page1.daily).toHaveLength(2);
    expect(page2.daily).toHaveLength(1);
    const datesPage1 = page1.daily.map((d) => d.draw_date);
    const datesPage2 = page2.daily.map((d) => d.draw_date);
    expect(datesPage1.some((d) => datesPage2.includes(d))).toBe(false);
  });
});
