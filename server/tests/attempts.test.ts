import { describe, it, expect } from "vitest";
import { createTemplate } from "../src/domain/templates.js";
import {
  createAttempt,
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

  it("refuses a plain self-grade over a live model grade without override", () => {
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
    db.prepare("INSERT INTO grade (id, response_id, grader, score, model_name) VALUES ('m1', ?, 'model', 0.8, 'test-model')").run(
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
});
