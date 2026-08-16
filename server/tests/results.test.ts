import { describe, it, expect } from "vitest";
import { getResults } from "../src/domain/results.js";
import { insertTag, insertQuestion, seedScoredResponse, isoAgo, openTestDb } from "./helpers.js";
import { v4 as uuidv4 } from "uuid";

// seedScoredResponse creates its own bare attempt/response/grade trio, which is
// enough for tag/question scope aggregation but doesn't set response_text.
// This helper does the same thing with a written answer's raw text attached.
function seedWrittenResponse(db: ReturnType<typeof openTestDb>, questionId: string, score: number, text: string, answeredAt: string) {
  const attemptId = uuidv4();
  const responseId = uuidv4();
  db.prepare(
    `INSERT INTO attempt (id, node_id, source, started_at, submitted_at) VALUES (?, 'n', 'adhoc', ?, ?)`
  ).run(attemptId, answeredAt, answeredAt);
  db.prepare(
    `INSERT INTO response (id, attempt_id, question_id, ordinal, response_text, answered_at) VALUES (?, ?, ?, 0, ?, ?)`
  ).run(responseId, attemptId, questionId, text, answeredAt);
  db.prepare(`INSERT INTO grade (id, response_id, grader, score, graded_at) VALUES (?, ?, 'self', ?, ?)`).run(
    uuidv4(),
    responseId,
    score,
    answeredAt
  );
}

describe("get_results scope: question", () => {
  it("returns written response_text alongside the score, sorted worst-first", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const weak = insertQuestion(db, { tags: ["a"], type: "written" });
    const strong = insertQuestion(db, { tags: ["a"], type: "written" });

    seedWrittenResponse(db, weak.id, 0.0, "I said the derivative was the integral.", isoAgo(2));
    seedWrittenResponse(db, strong.id, 1.0, "Correct explanation of the vertex.", isoAgo(2));

    const result = getResults(db, { scope: "question" }) as { questions: any[] };

    expect(result.questions[0].lineage_id).toBe(weak.lineage_id); // worst first
    expect(result.questions[0].recent_responses[0].response_text).toBe(
      "I said the derivative was the integral."
    );
    expect(result.questions[0].recent_responses[0].score).toBe(0.0);
  });
});

describe("get_results scope: tag", () => {
  it("aggregates mean_score and misses per tag", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "mc" });
    seedScoredResponse(db, q.id, 0.0, isoAgo(2));

    const result = getResults(db, { scope: "tag" }) as { tags: any[] };
    const row = result.tags.find((t) => t.tag_slug === "a");

    expect(row.responses).toBe(1);
    expect(row.mean_score).toBe(0.0);
    expect(row.misses).toBe(1);
  });
});
