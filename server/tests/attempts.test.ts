import { describe, it, expect } from "vitest";
import { createTemplate } from "../src/domain/templates.js";
import {
  createAttempt,
  createDailyAttempt,
  getAttemptDetail,
  answerResponse,
  submitAttempt,
  gradeResponse,
  sweepAbandonedAttempts,
} from "../src/domain/attempts.js";
import { DomainError } from "../src/domain/errors.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";

function setUpMcTemplate(db: ReturnType<typeof openTestDb>) {
  insertTag(db, "a");
  const q1 = insertQuestion(db, { tags: ["a"], type: "mc" });
  const q2 = insertQuestion(db, { tags: ["a"], type: "written" });
  const template = createTemplate(db, { name: "t", tag_query: { all: ["a"] }, question_count: 2 });
  return { template, q1, q2 };
}

describe("full attempt lifecycle over the domain layer", () => {
  it("create -> answer -> submit -> self-grade", () => {
    const db = openTestDb();
    const { template, q1 } = setUpMcTemplate(db);

    const created = createAttempt(db, { node_id: "n1", source: "template", template_id: template.id });
    expect(created.questions.length).toBe(2);

    const detail = getAttemptDetail(db, created.attempt_id);
    const responses = detail.responses as any[];
    expect(responses.length).toBe(2);
    // Pre-submit: answer key withheld, but panel-relevant fields (graph/desmos/
    // document/tags) are always present since they aren't part of the answer key.
    for (const r of responses) {
      expect(r.question.explanation).toBeUndefined();
      expect(r.question.tags).toEqual(["a"]);
      expect(r.question).toHaveProperty("graph_spec");
      expect(r.question).toHaveProperty("desmos_allowed");
      expect(r.question).toHaveProperty("document_id");
      expect(r.question).toHaveProperty("document_anchor_label");
      expect(r.question).toHaveProperty("document_anchor_start");
      expect(r.question).toHaveProperty("document_anchor_end");
      if (r.question.type === "mc") {
        for (const c of r.question.choices) expect(c.is_correct).toBeUndefined();
      }
    }

    const mcResponse = responses.find((r) => r.question.type === "mc");
    const correctChoiceId = (
      db.prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = 1").get(q1.id) as { id: string }
    ).id;

    answerResponse(db, created.attempt_id, mcResponse.id, { selected_choice_id: correctChoiceId });

    const submitted = submitAttempt(db, created.attempt_id) as any;
    expect(submitted.submitted_at).not.toBeNull();

    const gradedMc = submitted.responses.find((r: any) => r.id === mcResponse.id);
    expect(gradedMc.grade.grader).toBe("auto_mc");
    expect(gradedMc.grade.score).toBe(1.0);

    // Post-submit: answer key revealed.
    for (const r of submitted.responses) {
      expect(r.question.explanation).not.toBeUndefined();
    }

    const writtenResponse = submitted.responses.find((r: any) => r.question.type === "written");
    const graded = gradeResponse(db, writtenResponse.id, { grader: "self", score: 0.5 });
    expect(graded.score).toBe(0.5);
  });

  it("rejects editing responses after submit", () => {
    const db = openTestDb();
    const { template } = setUpMcTemplate(db);
    const created = createAttempt(db, { node_id: "n1", source: "template", template_id: template.id });
    submitAttempt(db, created.attempt_id);

    const detail = getAttemptDetail(db, created.attempt_id);
    const firstResponseId = (detail.responses as any[])[0].id;

    expect(() => answerResponse(db, created.attempt_id, firstResponseId, { skipped: true })).toThrow(DomainError);
  });
});

describe("grade supersede rules", () => {
  it("the unique partial index refuses a second live grade for one response", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "written" });
    const attemptId = "22222222-2222-2222-2222-222222222222";
    const responseId = "33333333-3333-3333-3333-333333333333";
    db.prepare(
      "INSERT INTO attempt (id, node_id, source, started_at, submitted_at) VALUES (?, 'n', 'adhoc', datetime('now'), datetime('now'))"
    ).run(attemptId);
    db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal) VALUES (?, ?, ?, 0)").run(
      responseId,
      attemptId,
      q.id
    );

    db.prepare("INSERT INTO grade (id, response_id, grader, score) VALUES ('g1', ?, 'self', 0.5)").run(responseId);

    expect(() =>
      db.prepare("INSERT INTO grade (id, response_id, grader, score) VALUES ('g2', ?, 'self', 1.0)").run(responseId)
    ).toThrow();
  });

  it("gradeResponse supersedes the prior live grade transactionally", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "written" });
    const attemptId = "44444444-4444-4444-4444-444444444444";
    const responseId = "55555555-5555-5555-5555-555555555555";
    db.prepare(
      "INSERT INTO attempt (id, node_id, source, started_at, submitted_at) VALUES (?, 'n', 'adhoc', datetime('now'), datetime('now'))"
    ).run(attemptId);
    db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal) VALUES (?, ?, ?, 0)").run(
      responseId,
      attemptId,
      q.id
    );

    const first = gradeResponse(db, responseId, { grader: "self", score: 0 });
    const second = gradeResponse(db, responseId, { grader: "self", score: 1 });

    const live = db.prepare("SELECT id FROM grade WHERE response_id = ? AND superseded_at IS NULL").all(responseId);
    expect(live.length).toBe(1);
    expect((live[0] as any).id).toBe(second.id);

    const supersededFirst = db.prepare("SELECT superseded_at FROM grade WHERE id = ?").get(first.id) as {
      superseded_at: string | null;
    };
    expect(supersededFirst.superseded_at).not.toBeNull();
  });

  it("refuses a plain self-grade over a live tutor grade without override", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q = insertQuestion(db, { tags: ["a"], type: "written" });
    const attemptId = "66666666-6666-6666-6666-666666666666";
    const responseId = "77777777-7777-7777-7777-777777777777";
    db.prepare(
      "INSERT INTO attempt (id, node_id, source, started_at, submitted_at) VALUES (?, 'n', 'adhoc', datetime('now'), datetime('now'))"
    ).run(attemptId);
    db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal) VALUES (?, ?, ?, 0)").run(
      responseId,
      attemptId,
      q.id
    );
    db.prepare("INSERT INTO grade (id, response_id, grader, score, model_name) VALUES ('m1', ?, 'judge', 0.8, NULL)").run(
      responseId
    );

    expect(() => gradeResponse(db, responseId, { grader: "self", score: 1 })).toThrow(DomainError);

    const overridden = gradeResponse(db, responseId, { grader: "self", score: 1, override: true });
    expect(overridden.score).toBe(1);
  });
});

describe("abandonment sweep", () => {
  it("marks an unsubmitted attempt older than abandon_after_hours as abandoned and it drops from aggregates", () => {
    const db = openTestDb();
    const { template } = setUpMcTemplate(db);
    const created = createAttempt(db, { node_id: "n1", source: "template", template_id: template.id });

    db.prepare("UPDATE attempt SET started_at = datetime('now', '-25 hours') WHERE id = ?").run(created.attempt_id);

    sweepAbandonedAttempts(db);

    const row = db.prepare("SELECT abandoned_at FROM attempt WHERE id = ?").get(created.attempt_id) as {
      abandoned_at: string | null;
    };
    expect(row.abandoned_at).not.toBeNull();
  });

  it("does not abandon an attempt within the window", () => {
    const db = openTestDb();
    const { template } = setUpMcTemplate(db);
    const created = createAttempt(db, { node_id: "n1", source: "template", template_id: template.id });

    sweepAbandonedAttempts(db);

    const row = db.prepare("SELECT abandoned_at FROM attempt WHERE id = ?").get(created.attempt_id) as {
      abandoned_at: string | null;
    };
    expect(row.abandoned_at).toBeNull();
  });
});

describe("outbox population (local nodes only)", () => {
  it("submit enqueues attempt, response(s), and auto_mc grade(s) as one unit on a local node", () => {
    const db = openTestDb();
    const { template, q1 } = setUpMcTemplate(db);
    const created = createAttempt(db, { node_id: "n1", source: "template", template_id: template.id }, "local");
    submitAttempt(db, created.attempt_id, "local");

    const rows = db.prepare("SELECT entity_type, entity_id FROM outbox ORDER BY entity_type").all() as
      { entity_type: string; entity_id: string }[];
    const types = rows.map((r) => r.entity_type).sort();
    // setUpMcTemplate seeds exactly 1 mc question and 1 written question, so
    // submitAttempt's existing (unmodified) auto_mc grading logic inserts
    // exactly 1 grade (for the mc response) — the written response only gets
    // graded via a later, separate gradeResponse("self", ...) call.
    expect(types).toEqual(["attempt", "grade", "response", "response"]);
    expect(rows.find((r) => r.entity_type === "attempt")?.entity_id).toBe(created.attempt_id);
  });

  it("submit does NOT enqueue anything on a canonical node", () => {
    const db = openTestDb();
    const { template } = setUpMcTemplate(db);
    const created = createAttempt(db, { node_id: "n1", source: "template", template_id: template.id }, "canonical");
    submitAttempt(db, created.attempt_id, "canonical");

    const count = (db.prepare("SELECT COUNT(*) AS n FROM outbox").get() as { n: number }).n;
    expect(count).toBe(0);
  });

  it("a self-grade write enqueues an outbox row on a local node", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const wq = insertQuestion(db, { type: "written", tags: ["a"] });
    const template = createTemplate(db, { name: "t", tag_query: { all: ["a"] }, question_count: 1 });
    const created = createAttempt(db, { node_id: "n1", source: "template", template_id: template.id }, "local");
    const detail = getAttemptDetail(db, created.attempt_id) as any;
    submitAttempt(db, created.attempt_id, "local");
    const responseId = detail.responses[0].id;

    const before = (db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE entity_type = 'grade'").get() as { n: number }).n;
    gradeResponse(db, responseId, { grader: "self", score: 1 }, "local");
    const after = (db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE entity_type = 'grade'").get() as { n: number }).n;
    expect(after).toBe(before + 1);
  });

  // Finding 7A — superseding a grade must enqueue the OLD row too, carrying
  // its new superseded_at, or canonical never learns the score changed and the
  // new grade dead-letters against grade_one_live_per_response.
  it("superseding a grade enqueues both the superseded old grade and the new one", () => {
    const db = openTestDb();
    insertTag(db, "a");
    insertQuestion(db, { type: "written", tags: ["a"] });
    const template = createTemplate(db, { name: "t", tag_query: { all: ["a"] }, question_count: 1 });
    const created = createAttempt(db, { node_id: "n1", source: "template", template_id: template.id }, "local");
    const detail = getAttemptDetail(db, created.attempt_id) as any;
    submitAttempt(db, created.attempt_id, "local");
    const responseId = detail.responses[0].id;

    const first = gradeResponse(db, responseId, { grader: "self", score: 0 }, "local");
    db.prepare("DELETE FROM outbox WHERE entity_type = 'grade'").run(); // simulate the first grade already pushed

    const second = gradeResponse(db, responseId, { grader: "self", score: 1 }, "local");

    const rows = db.prepare("SELECT entity_id, payload FROM outbox WHERE entity_type = 'grade'").all() as {
      entity_id: string; payload: string;
    }[];
    const ids = rows.map((r) => r.entity_id).sort();
    expect(ids).toEqual([(first as any).id, (second as any).id].sort());

    // The old grade's payload carries the real superseded_at, not null.
    const oldPayload = JSON.parse(rows.find((r) => r.entity_id === (first as any).id)!.payload);
    expect(oldPayload.superseded_at).not.toBeNull();
    expect(oldPayload.id).toBe((first as any).id);

    // The new grade's payload is still live.
    const newPayload = JSON.parse(rows.find((r) => r.entity_id === (second as any).id)!.payload);
    expect(newPayload.superseded_at).toBeNull();
    expect(newPayload.score).toBe(1);
  });

  it("a canonical-role supersede enqueues nothing", () => {
    const db = openTestDb();
    insertTag(db, "a");
    insertQuestion(db, { type: "written", tags: ["a"] });
    const template = createTemplate(db, { name: "t", tag_query: { all: ["a"] }, question_count: 1 });
    const created = createAttempt(db, { node_id: "n1", source: "template", template_id: template.id }, "canonical");
    const detail = getAttemptDetail(db, created.attempt_id) as any;
    submitAttempt(db, created.attempt_id, "canonical");
    const responseId = detail.responses[0].id;

    gradeResponse(db, responseId, { grader: "self", score: 0 }, "canonical");
    gradeResponse(db, responseId, { grader: "self", score: 1 }, "canonical");

    const count = (db.prepare("SELECT COUNT(*) AS n FROM outbox").get() as { n: number }).n;
    expect(count).toBe(0);
  });
});

describe("createDailyAttempt", () => {
  it("creates an attempt with the exact given question set, in order, referencing daily_draw_id", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q1 = insertQuestion(db, { tags: ["a"] });
    const q2 = insertQuestion(db, { tags: ["a"], type: "written" });
    db.prepare("INSERT INTO daily_draw (id, draw_date, kind) VALUES ('dd1', '2026-08-20', 'quiz')").run();

    const result = createDailyAttempt(db, {
      node_id: "n1",
      kind: "daily_quiz",
      daily_draw_id: "dd1",
      questions: [
        { id: q1.id, lineage_id: q1.lineage_id, type: "mc" },
        { id: q2.id, lineage_id: q2.lineage_id, type: "written" },
      ],
    });

    const attempt = db.prepare("SELECT source, daily_draw_id, template_id FROM attempt WHERE id = ?").get(result.attempt_id) as any;
    expect(attempt.source).toBe("daily_quiz");
    expect(attempt.daily_draw_id).toBe("dd1");
    expect(attempt.template_id).toBeNull();

    const responses = db.prepare("SELECT question_id, ordinal FROM response WHERE attempt_id = ? ORDER BY ordinal").all(result.attempt_id) as any[];
    expect(responses.map((r) => r.question_id)).toEqual([q1.id, q2.id]);
  });

  it("does not enqueue an outbox row itself (only submit does, per the existing attempt lifecycle)", () => {
    const db = openTestDb();
    insertTag(db, "a");
    const q1 = insertQuestion(db, { tags: ["a"] });
    db.prepare("INSERT INTO daily_draw (id, draw_date, kind) VALUES ('dd2', '2026-08-20', 'question')").run();

    createDailyAttempt(db, {
      node_id: "n1", kind: "daily_question", daily_draw_id: "dd2",
      questions: [{ id: q1.id, lineage_id: q1.lineage_id, type: "mc" }],
    }, "local");

    const outboxCount = (db.prepare("SELECT COUNT(*) AS n FROM outbox").get() as { n: number }).n;
    expect(outboxCount).toBe(0);
  });
});
