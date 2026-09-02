import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "./errors.js";
import { resolveTemplateDraw, type DrawResult } from "./draw.js";

// Unsubmitted attempts older than this many hours are considered abandoned.
// Swept lazily (no background timer) whenever attempts are read or created.
function abandonAfterHours(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM config WHERE key = 'abandon_after_hours'").get() as
    | { value: string }
    | undefined;
  return row ? Number(JSON.parse(row.value)) : 24;
}

export function sweepAbandonedAttempts(db: DatabaseSync): void {
  const hours = abandonAfterHours(db);
  db.prepare(
    `UPDATE attempt
     SET abandoned_at = datetime('now')
     WHERE submitted_at IS NULL
       AND abandoned_at IS NULL
       AND started_at <= datetime('now', ?)`
  ).run(`-${hours} hours`);
}

// ----------------------------------------------------------------------------
// Question snapshot shown to the client. Correctness (`is_correct`) and the
// answer key (`explanation`, `model_answer`, `rubric`) are withheld until the
// attempt is submitted, so an in-progress Take screen can't peek at answers.
// ----------------------------------------------------------------------------

interface QuestionRow {
  id: string;
  type: "mc" | "written";
  prompt: string;
  difficulty: number;
  calculator_policy: string;
  explanation: string | null;
  model_answer: string | null;
  rubric: string | null;
  graph_spec: string | null;
  desmos_allowed: number;
  document_id: string | null;
  document_anchor_label: string | null;
  document_anchor_start: number | null;
  document_anchor_end: number | null;
  document_marker_offset: number | null;
}

interface ChoiceRow {
  id: string;
  question_id: string;
  body: string;
  is_correct: number;
  ordinal: number;
}

function questionSnapshot(
  db: DatabaseSync,
  questionId: string,
  revealAnswer: boolean
): Record<string, unknown> {
  const q = db.prepare("SELECT * FROM question WHERE id = ?").get(questionId) as unknown as QuestionRow;
  const choices =
    q.type === "mc"
      ? (db
          .prepare("SELECT id, body, is_correct, ordinal FROM choice WHERE question_id = ? ORDER BY ordinal")
          .all(questionId) as unknown as ChoiceRow[])
      : [];

  const tags = (
    db.prepare("SELECT tag_slug FROM question_tag WHERE question_id = ?").all(questionId) as {
      tag_slug: string;
    }[]
  ).map((t) => t.tag_slug);

  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    difficulty: q.difficulty,
    calculator_policy: q.calculator_policy,
    tags,
    graph_spec: q.graph_spec,
    desmos_allowed: q.desmos_allowed === 1,
    document_id: q.document_id,
    document_anchor_label: q.document_anchor_label,
    document_anchor_start: q.document_anchor_start,
    document_anchor_end: q.document_anchor_end,
    document_marker_offset: q.document_marker_offset,
    choices: choices.map((c) => ({
      id: c.id,
      body: c.body,
      ordinal: c.ordinal,
      ...(revealAnswer ? { is_correct: c.is_correct === 1 } : {}),
    })),
    ...(revealAnswer
      ? { explanation: q.explanation, model_answer: q.model_answer, rubric: q.rubric ? JSON.parse(q.rubric) : null }
      : {}),
  };
}

// ----------------------------------------------------------------------------
// Outbox (local nodes only) — populated on submit and grade write so the
// sync engine (Task 5) has real rows to push. See spec §7.1, §8.3.
// ----------------------------------------------------------------------------

function enqueueOutbox(db: DatabaseSync, entityType: "attempt" | "response" | "grade", entityId: string, payload: unknown): void {
  db.prepare(
    `INSERT INTO outbox (entity_type, entity_id, payload) VALUES (?, ?, ?)
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET payload = excluded.payload`
  ).run(entityType, entityId, JSON.stringify(payload));
}

// ----------------------------------------------------------------------------
// Create
// ----------------------------------------------------------------------------

export type CreateAttemptInput =
  | { node_id: string; source: "template"; template_id: string }
  | { node_id: string; source: "adhoc"; question_ids: string[] };

export function createAttempt(
  db: DatabaseSync,
  input: CreateAttemptInput,
  role: "canonical" | "local" = "canonical"
): { attempt_id: string; questions: { id: string; lineage_id: string; type: "mc" | "written" }[] } {
  sweepAbandonedAttempts(db);

  if (input.source === "template") {
    const draw = resolveTemplateDraw(db, input.template_id);
    const attemptId = uuidv4();

    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO attempt (id, node_id, source, template_id, started_at)
         VALUES (?, ?, 'template', ?, datetime('now'))`
      ).run(attemptId, input.node_id, input.template_id);

      const insertResponse = db.prepare(
        "INSERT INTO response (id, attempt_id, question_id, ordinal) VALUES (?, ?, ?, ?)"
      );
      draw.questions.forEach((q, i) => insertResponse.run(uuidv4(), attemptId, q.id, i));

      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    return { attempt_id: attemptId, questions: draw.questions };
  }

  // source === "adhoc"
  if (!input.question_ids || input.question_ids.length === 0) {
    throw new DomainError("empty_question_ids", "source 'adhoc' requires at least one question_id.");
  }

  // Check for duplicate question_ids before querying the database.
  const uniqueIds = new Set(input.question_ids);
  if (uniqueIds.size !== input.question_ids.length) {
    const duplicates = input.question_ids.filter((id, i) => input.question_ids.indexOf(id) !== i);
    const uniqueDuplicates = [...new Set(duplicates)];
    throw new DomainError("duplicate_question_ids", `Question IDs must be unique; found duplicate(s): ${uniqueDuplicates.join(", ")}`);
  }

  const placeholders = input.question_ids.map(() => "?").join(",");
  const found = db
    .prepare(`SELECT id, lineage_id, type FROM question WHERE id IN (${placeholders}) AND retired_at IS NULL`)
    .all(...input.question_ids) as { id: string; lineage_id: string; type: "mc" | "written" }[];
  if (found.length !== input.question_ids.length) {
    const foundIds = new Set(found.map((q) => q.id));
    const missing = input.question_ids.filter((id) => !foundIds.has(id));
    throw new DomainError("question_not_found", `Question(s) not found or retired: ${missing.join(", ")}`);
  }
  // Preserve caller-specified order, not the SQL IN(...) result order.
  const byId = new Map(found.map((q) => [q.id, q]));
  const questions = input.question_ids.map((id) => byId.get(id)!);

  const attemptId = uuidv4();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO attempt (id, node_id, source, started_at) VALUES (?, ?, 'adhoc', datetime('now'))`
    ).run(attemptId, input.node_id);

    const insertResponse = db.prepare(
      "INSERT INTO response (id, attempt_id, question_id, ordinal) VALUES (?, ?, ?, ?)"
    );
    questions.forEach((q, i) => insertResponse.run(uuidv4(), attemptId, q.id, i));

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { attempt_id: attemptId, questions };
}

// ----------------------------------------------------------------------------
// Create Daily Attempt
// ----------------------------------------------------------------------------

export interface CreateDailyAttemptInput {
  node_id: string;
  kind: "daily_question" | "daily_quiz";
  daily_draw_id: string;
  questions: { id: string; lineage_id: string; type: "mc" | "written" }[];
}

export function createDailyAttempt(
  db: DatabaseSync,
  input: CreateDailyAttemptInput,
  role: "canonical" | "local" = "canonical"
): { attempt_id: string; questions: { id: string; lineage_id: string; type: "mc" | "written" }[] } {
  sweepAbandonedAttempts(db);

  const attemptId = uuidv4();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO attempt (id, node_id, source, daily_draw_id, started_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).run(attemptId, input.node_id, input.kind, input.daily_draw_id);

    const insertResponse = db.prepare(
      "INSERT INTO response (id, attempt_id, question_id, ordinal) VALUES (?, ?, ?, ?)"
    );
    input.questions.forEach((q, i) => insertResponse.run(uuidv4(), attemptId, q.id, i));

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { attempt_id: attemptId, questions: input.questions };
}

// ----------------------------------------------------------------------------
// Read
// ----------------------------------------------------------------------------

interface AttemptRow {
  id: string;
  node_id: string;
  source: string;
  template_id: string | null;
  daily_draw_id: string | null;
  started_at: string;
  submitted_at: string | null;
  abandoned_at: string | null;
  offline: number;
  synced_at: string | null;
}

interface ResponseRow {
  id: string;
  attempt_id: string;
  question_id: string;
  ordinal: number;
  selected_choice_id: string | null;
  response_text: string | null;
  skipped: number;
  answered_at: string | null;
  elapsed_ms: number | null;
}

interface GradeRow {
  id: string;
  response_id: string;
  grader: "auto_mc" | "self" | "model";
  score: number;
  feedback: string | null;
  rubric_version: string | null;
  model_name: string | null;
  graded_at: string;
}

export function getAttemptDetail(db: DatabaseSync, attemptId: string): Record<string, unknown> {
  sweepAbandonedAttempts(db);

  const attempt = db.prepare("SELECT * FROM attempt WHERE id = ?").get(attemptId) as unknown as
    | AttemptRow
    | undefined;
  if (!attempt) throw new DomainError("not_found", `Attempt "${attemptId}" does not exist.`);

  const revealAnswer = attempt.submitted_at !== null;
  const responses = db
    .prepare("SELECT * FROM response WHERE attempt_id = ? ORDER BY ordinal")
    .all(attemptId) as unknown as ResponseRow[];

  const liveGrade = db.prepare(
    "SELECT * FROM grade WHERE response_id = ? AND superseded_at IS NULL"
  );

  return {
    id: attempt.id,
    node_id: attempt.node_id,
    source: attempt.source,
    template_id: attempt.template_id,
    daily_draw_id: attempt.daily_draw_id,
    started_at: attempt.started_at,
    submitted_at: attempt.submitted_at,
    abandoned_at: attempt.abandoned_at,
    offline: attempt.offline === 1,
    responses: responses.map((r) => {
      const grade = liveGrade.get(r.id) as unknown as GradeRow | undefined;
      return {
        id: r.id,
        ordinal: r.ordinal,
        question: questionSnapshot(db, r.question_id, revealAnswer),
        selected_choice_id: r.selected_choice_id,
        response_text: r.response_text,
        skipped: r.skipped === 1,
        answered_at: r.answered_at,
        elapsed_ms: r.elapsed_ms,
        grade: grade
          ? { grader: grade.grader, score: grade.score, feedback: grade.feedback, graded_at: grade.graded_at }
          : null,
      };
    }),
  };
}

export function listAttempts(
  db: DatabaseSync,
  opts: { limit?: number; offset?: number } = {}
): { total: number; attempts: Record<string, unknown>[] } {
  sweepAbandonedAttempts(db);

  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const total = (db.prepare("SELECT COUNT(*) AS n FROM attempt").get() as { n: number }).n;

  const rows = db
    .prepare(
      `SELECT a.id, a.source, a.template_id, t.name AS template_name, a.submitted_at, a.abandoned_at, a.offline,
              (SELECT COUNT(*) FROM response r WHERE r.attempt_id = a.id) AS question_count,
              (SELECT AVG(COALESCE(rs.score, 0)) FROM response_score rs WHERE rs.attempt_id = a.id) AS mean_score
       FROM attempt a
       LEFT JOIN template t ON t.id = a.template_id
       ORDER BY a.started_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as {
    id: string;
    source: string;
    template_id: string | null;
    template_name: string | null;
    submitted_at: string | null;
    abandoned_at: string | null;
    offline: number;
    question_count: number;
    mean_score: number | null;
  }[];

  return {
    total,
    attempts: rows.map((r) => ({
      id: r.id,
      source: r.source,
      template_id: r.template_id,
      template_name: r.template_name,
      submitted_at: r.submitted_at,
      abandoned_at: r.abandoned_at,
      offline: r.offline === 1,
      question_count: r.question_count,
      mean_score: r.mean_score,
    })),
  };
}

// ----------------------------------------------------------------------------
// Update a response in progress
// ----------------------------------------------------------------------------

export interface AnswerResponseChanges {
  selected_choice_id?: string | null;
  response_text?: string | null;
  skipped?: boolean;
  elapsed_ms?: number;
}

export function answerResponse(
  db: DatabaseSync,
  attemptId: string,
  responseId: string,
  changes: AnswerResponseChanges
): Record<string, unknown> {
  const attempt = db.prepare("SELECT submitted_at, abandoned_at FROM attempt WHERE id = ?").get(attemptId) as
    | { submitted_at: string | null; abandoned_at: string | null }
    | undefined;
  if (!attempt) throw new DomainError("not_found", `Attempt "${attemptId}" does not exist.`);
  if (attempt.submitted_at) throw new DomainError("attempt_submitted", "Cannot edit responses after submit.");
  if (attempt.abandoned_at) throw new DomainError("attempt_abandoned", "This attempt was abandoned.");

  const response = db.prepare("SELECT id FROM response WHERE id = ? AND attempt_id = ?").get(responseId, attemptId);
  if (!response) throw new DomainError("not_found", `Response "${responseId}" does not exist on this attempt.`);

  db.prepare(
    `UPDATE response
     SET selected_choice_id = COALESCE(@selected_choice_id, selected_choice_id),
         response_text = COALESCE(@response_text, response_text),
         skipped = COALESCE(@skipped, skipped),
         elapsed_ms = COALESCE(@elapsed_ms, elapsed_ms),
         answered_at = datetime('now')
     WHERE id = @id`
  ).run({
    id: responseId,
    selected_choice_id: changes.selected_choice_id ?? null,
    response_text: changes.response_text ?? null,
    skipped: changes.skipped === undefined ? null : changes.skipped ? 1 : 0,
    elapsed_ms: changes.elapsed_ms ?? null,
  });

  const updated = db.prepare("SELECT * FROM response WHERE id = ?").get(responseId) as unknown as ResponseRow;
  return {
    id: updated.id,
    selected_choice_id: updated.selected_choice_id,
    response_text: updated.response_text,
    skipped: updated.skipped === 1,
    answered_at: updated.answered_at,
    elapsed_ms: updated.elapsed_ms,
  };
}

// ----------------------------------------------------------------------------
// Submit — grades all mc responses immediately (auto_mc)
// ----------------------------------------------------------------------------

export function submitAttempt(
  db: DatabaseSync,
  attemptId: string,
  role: "canonical" | "local" = "canonical"
): Record<string, unknown> {
  const attempt = db.prepare("SELECT submitted_at, abandoned_at FROM attempt WHERE id = ?").get(attemptId) as
    | { submitted_at: string | null; abandoned_at: string | null }
    | undefined;
  if (!attempt) throw new DomainError("not_found", `Attempt "${attemptId}" does not exist.`);
  if (attempt.submitted_at) throw new DomainError("attempt_submitted", "This attempt was already submitted.");
  if (attempt.abandoned_at) throw new DomainError("attempt_abandoned", "This attempt was abandoned.");

  const mcResponses = db
    .prepare(
      `SELECT r.id AS response_id, r.selected_choice_id
       FROM response r
       JOIN question q ON q.id = r.question_id
       WHERE r.attempt_id = ? AND q.type = 'mc'`
    )
    .all(attemptId) as { response_id: string; selected_choice_id: string | null }[];

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE attempt SET submitted_at = datetime('now') WHERE id = ?").run(attemptId);

    const insertGrade = db.prepare(
      "INSERT INTO grade (id, response_id, grader, score, graded_at) VALUES (?, ?, 'auto_mc', ?, datetime('now'))"
    );
    const insertedGradeIds: string[] = [];
    for (const r of mcResponses) {
      const isCorrect = r.selected_choice_id
        ? (db.prepare("SELECT is_correct FROM choice WHERE id = ?").get(r.selected_choice_id) as
            | { is_correct: number }
            | undefined)
        : undefined;
      const score = isCorrect?.is_correct === 1 ? 1.0 : 0.0;
      const gradeId = uuidv4();
      insertGrade.run(gradeId, r.response_id, score);
      insertedGradeIds.push(gradeId);
    }

    if (role === "local") {
      const attemptRow = db.prepare("SELECT * FROM attempt WHERE id = ?").get(attemptId);
      enqueueOutbox(db, "attempt", attemptId, attemptRow);

      const responseRows = db.prepare("SELECT * FROM response WHERE attempt_id = ?").all(attemptId) as unknown as ResponseRow[];
      for (const r of responseRows) {
        enqueueOutbox(db, "response", r.id, r);
      }

      for (const gradeId of insertedGradeIds) {
        const gradeRow = db.prepare("SELECT * FROM grade WHERE id = ?").get(gradeId);
        enqueueOutbox(db, "grade", gradeId, gradeRow);
      }
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return getAttemptDetail(db, attemptId);
}

// ----------------------------------------------------------------------------
// Self-grading and supersede rules (spec 6.3)
// ----------------------------------------------------------------------------

export interface GradeResponseInput {
  grader: "self";
  score: number;
  feedback?: string | null;
  override?: boolean;
}

export function gradeResponse(
  db: DatabaseSync,
  responseId: string,
  input: GradeResponseInput,
  role: "canonical" | "local" = "canonical"
): Record<string, unknown> {
  if (![0, 0.5, 1].includes(input.score)) {
    throw new DomainError("invalid_score", "Self-grade score must be 0, 0.5, or 1.");
  }

  const response = db.prepare("SELECT id FROM response WHERE id = ?").get(responseId);
  if (!response) throw new DomainError("not_found", `Response "${responseId}" does not exist.`);

  const live = db.prepare("SELECT * FROM grade WHERE response_id = ? AND superseded_at IS NULL").get(
    responseId
  ) as unknown as GradeRow | undefined;

  if (live?.grader === "auto_mc") {
    throw new DomainError("not_self_gradable", "This response was auto-graded (mc) and cannot be self-graded.");
  }
  if (live?.grader === "model" && !input.override) {
    throw new DomainError(
      "model_grade_live",
      "A model grade is live for this response. Pass override: true to manually replace it."
    );
  }

  const id = uuidv4();
  db.exec("BEGIN");
  try {
    if (live) {
      db.prepare("UPDATE grade SET superseded_at = datetime('now') WHERE id = ?").run(live.id);
    }
    db.prepare(
      "INSERT INTO grade (id, response_id, grader, score, feedback, graded_at) VALUES (?, ?, 'self', ?, ?, datetime('now'))"
    ).run(id, responseId, input.score, input.feedback ?? null);

    if (role === "local") {
      // The supersede is itself a change canonical needs: without it, the new
      // grade collides with the still-live old one on canonical's
      // grade_one_live_per_response index and dead-letters, leaving the stale
      // score authoritative. Re-read after the UPDATE so the payload carries
      // the real superseded_at.
      if (live) {
        const oldGradeRow = db.prepare("SELECT * FROM grade WHERE id = ?").get(live.id);
        enqueueOutbox(db, "grade", live.id, oldGradeRow);
      }
      const gradeRow = db.prepare("SELECT * FROM grade WHERE id = ?").get(id);
      enqueueOutbox(db, "grade", id, gradeRow);
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const grade = db.prepare("SELECT * FROM grade WHERE id = ?").get(id) as unknown as GradeRow;
  return { id: grade.id, response_id: grade.response_id, grader: grade.grader, score: grade.score, graded_at: grade.graded_at };
}
