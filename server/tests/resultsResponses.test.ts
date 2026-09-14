import { describe, it, expect } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { openTestDb, insertTag, insertQuestion, isoAgo } from "./helpers.js";
import { getResults } from "../src/domain/results.js";

function seedResponse(
  db: ReturnType<typeof openTestDb>,
  questionId: string,
  fields: { selected_choice_id?: string | null; response_text?: string | null; idk?: number; confidence?: string | null; misapplied_method?: string | null; elapsed_ms?: number | null },
  score: number | null,
  answeredAt: string
): void {
  const attemptId = uuidv4();
  const responseId = uuidv4();
  db.prepare("INSERT INTO attempt (id, node_id, source, started_at, submitted_at) VALUES (?, 'n', 'adhoc', ?, ?)").run(attemptId, answeredAt, answeredAt);
  db.prepare(
    `INSERT INTO response (id, attempt_id, question_id, ordinal, selected_choice_id, response_text, idk, confidence, misapplied_method, elapsed_ms, answered_at)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
  ).run(responseId, attemptId, questionId, fields.selected_choice_id ?? null, fields.response_text ?? null, fields.idk ?? 0,
        fields.confidence ?? null, fields.misapplied_method ?? null, fields.elapsed_ms ?? null, answeredAt);
  if (score !== null) {
    db.prepare("INSERT INTO grade (id, response_id, grader, score, graded_at) VALUES (?, ?, 'self', ?, ?)").run(uuidv4(), responseId, score, answeredAt);
  }
}

describe("get_results question scope: recent_responses for every type", () => {
  it("mc rows carry selected_choice_id/idk/confidence/elapsed_ms", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "mc" });
    const wrong = (db.prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = 0").get(q.id) as { id: string }).id;
    seedResponse(db, q.id, { selected_choice_id: wrong, confidence: "confident", elapsed_ms: 1500 }, 0, isoAgo(1));

    const result = getResults(db, { scope: "question" }) as { questions: any[] };
    const row = result.questions[0];
    expect(row.recent_responses).toHaveLength(1);
    expect(row.recent_responses[0].selected_choice_id).toBe(wrong);
    expect(row.recent_responses[0].confidence).toBe("confident");
    expect(row.recent_responses[0].elapsed_ms).toBe(1500);
    expect(row.recent_responses[0].idk).toBe(false);
    expect(row.recent_responses[0].score).toBe(0);
  });

  it("counts graded and ungraded separately and does not fold null into the mean", () => {
    const db = openTestDb();
    insertTag(db, "w");
    const q = insertQuestion(db, { tags: ["w"], type: "written" });
    seedResponse(db, q.id, { response_text: "right" }, 1, isoAgo(2));
    seedResponse(db, q.id, { response_text: "pending", misapplied_method: "chain rule" }, null, isoAgo(1));

    const result = getResults(db, { scope: "question" }) as { questions: any[] };
    const row = result.questions[0];
    expect(row.responses).toBe(2);
    expect(row.graded).toBe(1);
    expect(row.ungraded).toBe(1);
    expect(row.mean_score).toBe(1);
    expect(row.recent_responses[0].misapplied_method).toBe("chain rule");
    expect(row.recent_responses[0].score).toBeNull();
  });
});
