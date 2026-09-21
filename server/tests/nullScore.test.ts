import { describe, it, expect } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { openTestDb, insertTag, insertQuestion, isoAgo } from "./helpers.js";
import { getResults } from "../src/domain/results.js";
import { listAttempts } from "../src/domain/attempts.js";
import { getSessionDetail, createSession } from "../src/domain/sessions.js";
import { createTemplate, getTemplateDetail } from "../src/domain/templates.js";
import { bootstrap } from "../src/domain/bootstrap.js";

// One attempt, two written responses: one graded 1, one never graded.
function seedAttempt(db: ReturnType<typeof openTestDb>, q1: string, q2: string, opts: { template_id?: string; session_id?: string } = {}): string {
  const attemptId = uuidv4();
  const at = isoAgo(1);
  db.prepare(
    "INSERT INTO attempt (id, node_id, source, template_id, session_id, started_at, submitted_at) VALUES (?, 'n', ?, ?, ?, ?, ?)"
  ).run(attemptId, opts.template_id ? "template" : "adhoc", opts.template_id ?? null, opts.session_id ?? null, at, at);
  const r1 = uuidv4();
  const r2 = uuidv4();
  db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal, response_text, answered_at) VALUES (?, ?, ?, 0, 'a', ?)").run(r1, attemptId, q1, at);
  db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal, response_text, answered_at) VALUES (?, ?, ?, 1, 'b', ?)").run(r2, attemptId, q2, at);
  db.prepare("INSERT INTO grade (id, response_id, grader, score, graded_at) VALUES (?, ?, 'self', 1, ?)").run(uuidv4(), r1, at);
  return attemptId;
}

describe("a null score is ungraded, never zero", () => {
  it("attempt scope, listAttempts, and sessions report mean 1 with ungraded 1", () => {
    const db = openTestDb();
    insertTag(db, "w");
    const q1 = insertQuestion(db, { tags: ["w"], type: "written" });
    const q2 = insertQuestion(db, { tags: ["w"], type: "written" });
    const session = createSession(db, { name: "s" });
    seedAttempt(db, q1.id, q2.id, { session_id: session.id });

    const attemptScope = getResults(db, { scope: "attempt" }) as { attempts: any[] };
    expect(attemptScope.attempts[0].mean_score).toBe(1);
    expect(attemptScope.attempts[0].ungraded).toBe(1);

    const listed = listAttempts(db);
    expect(listed.attempts[0].mean_score).toBe(1);
    expect(listed.attempts[0].ungraded).toBe(1);

    const detail = getSessionDetail(db, session.id) as { attempts: any[] };
    expect(detail.attempts[0].mean_score).toBe(1);
    expect(detail.attempts[0].ungraded).toBe(1);
  });

  it("tag scope (the view) and bootstrap's weakest_tags ignore the ungraded response", () => {
    const db = openTestDb();
    insertTag(db, "w");
    const q1 = insertQuestion(db, { tags: ["w"], type: "written" });
    const q2 = insertQuestion(db, { tags: ["w"], type: "written" });
    seedAttempt(db, q1.id, q2.id);

    const tagScope = getResults(db, { scope: "tag" }) as { tags: any[] };
    const row = tagScope.tags.find((t) => t.tag_slug === "w");
    expect(row.responses).toBe(2);
    expect(row.graded).toBe(1);
    expect(row.mean_score).toBe(1);
    expect(row.misses).toBe(0);

    const b = bootstrap(db, null);
    expect(b.results_pointer.weakest_tags[0].mean_score).toBe(1);
  });

  it("template summary mean is over graded responses only", () => {
    const db = openTestDb();
    insertTag(db, "w");
    const q1 = insertQuestion(db, { tags: ["w"], type: "written" });
    const q2 = insertQuestion(db, { tags: ["w"], type: "written" });
    const t = createTemplate(db, { name: "t", tag_query: { all: ["w"] }, question_count: 2 });
    seedAttempt(db, q1.id, q2.id, { template_id: t.id });
    expect(getTemplateDetail(db, t.id).mean_score).toBe(1);
  });

  it("an attempt with nothing graded has mean_score null, not 0, in every read path", () => {
    const db = openTestDb();
    insertTag(db, "w");
    const q = insertQuestion(db, { tags: ["w"], type: "written" });
    const session = createSession(db, { name: "s" });
    const attemptId = uuidv4();
    const at = isoAgo(1);
    db.prepare("INSERT INTO attempt (id, node_id, source, session_id, started_at, submitted_at) VALUES (?, 'n', 'adhoc', ?, ?, ?)").run(attemptId, session.id, at, at);
    db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal, response_text, answered_at) VALUES (?, ?, ?, 0, 'x', ?)").run(uuidv4(), attemptId, q.id, at);

    const listed = listAttempts(db);
    expect(listed.attempts[0].mean_score).toBeNull();
    expect(listed.attempts[0].ungraded).toBe(1);

    const attemptScope = getResults(db, { scope: "attempt" }) as { attempts: any[] };
    expect(attemptScope.attempts[0].mean_score).toBeNull();
    expect(attemptScope.attempts[0].ungraded).toBe(1);

    const detail = getSessionDetail(db, session.id) as { attempts: any[] };
    expect(detail.attempts[0].mean_score).toBeNull();
    expect(detail.attempts[0].ungraded).toBe(1);
  });
});
