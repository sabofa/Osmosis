import { describe, it, expect } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { listUngradedWritten, gradeResponse, gradeResponseByTutor } from "../src/domain/attempts.js";

function seedWritten(
  db: ReturnType<typeof openTestDb>,
  opts: { text?: string | null; idk?: boolean; skipped?: boolean; submitted?: boolean; session?: string | null } = {}
) {
  const q = insertQuestion(db, { type: "written", tags: ["w"] });
  db.prepare("UPDATE question SET model_answer = '42', rubric = ? WHERE id = ?").run(
    JSON.stringify(["states 42", "shows why"]),
    q.id
  );
  const attemptId = uuidv4();
  const responseId = uuidv4();
  if (opts.session) {
    db.prepare("INSERT OR IGNORE INTO tutor_session (id, name) VALUES (?, 'S')").run(opts.session);
  }
  db.prepare(
    "INSERT INTO attempt (id, node_id, source, session_id, started_at, submitted_at) VALUES (?, 'n', 'adhoc', ?, datetime('now'), ?)"
  ).run(attemptId, opts.session ?? null, opts.submitted === false ? null : "2026-01-02 00:00:00");
  db.prepare(
    "INSERT INTO response (id, attempt_id, question_id, ordinal, response_text, idk, skipped) VALUES (?, ?, ?, 0, ?, ?, ?)"
  ).run(responseId, attemptId, q.id, opts.text === undefined ? "my answer" : opts.text, opts.idk ? 1 : 0, opts.skipped ? 1 : 0);
  return { responseId, attemptId, questionId: q.id };
}

describe("list_ungraded_written", () => {
  it("lists submitted written answers with their rubric and model answer, oldest first", () => {
    const db = openTestDb();
    insertTag(db, "w");
    const a = seedWritten(db);
    const { total, responses } = listUngradedWritten(db);
    expect(total).toBe(1);
    expect(responses[0]).toMatchObject({
      response_id: a.responseId,
      attempt_id: a.attemptId,
      model_answer: "42",
      rubric: ["states 42", "shows why"],
      response_text: "my answer",
      idk: false,
      tags: ["w"],
      self_grade: null,
    });
  });

  it("skips blanks, skipped rows and unsubmitted attempts, keeps an idk", () => {
    const db = openTestDb();
    insertTag(db, "w");
    seedWritten(db, { text: "" });
    seedWritten(db, { text: "x", skipped: true });
    seedWritten(db, { submitted: false });
    const idk = seedWritten(db, { text: "", idk: true });
    const { responses } = listUngradedWritten(db);
    expect(responses.map((r) => r.response_id)).toEqual([idk.responseId]);
    expect(responses[0].idk).toBe(true);
  });

  it("includes a self-graded answer by default, not once a tutor graded it", () => {
    const db = openTestDb();
    insertTag(db, "w");
    const a = seedWritten(db);
    gradeResponse(db, a.responseId, { grader: "self", score: 0.5 });
    expect(listUngradedWritten(db).responses[0].self_grade).toMatchObject({ score: 0.5 });
    expect(listUngradedWritten(db, { include_self_graded: false }).total).toBe(0);

    gradeResponseByTutor(db, a.responseId, { grader: "judge", score: 1, diagnosis: "right" });
    expect(listUngradedWritten(db).total).toBe(0);
  });

  it("filters by session", () => {
    const db = openTestDb();
    insertTag(db, "w");
    seedWritten(db, { session: "s1" });
    seedWritten(db);
    expect(listUngradedWritten(db, { session_id: "s1" }).total).toBe(1);
    expect(listUngradedWritten(db).total).toBe(2);
  });
});
