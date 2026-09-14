import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "./errors.js";
import { resolveTemplateDraw, getEligibleQuestions, type DrawResult, type EligibleQuestion } from "./draw.js";
import type { TagQuery } from "./tagQuery.js";

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

export function questionSnapshot(
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
  | {
      node_id: string;
      source: "template";
      template_id: string;
      // A draw already resolved elsewhere (the canonical node, for a cloud
      // test). When present the local pool is not consulted at all.
      questions?: EligibleQuestion[];
    }
  | {
      node_id: string;
      source: "adhoc";
      question_ids: string[];
      delivery_mode: "app_live" | "chat_quick_check";
      // Optional by design: an adhoc attempt with session_id IS NULL behaves
      // exactly as it did before sessions existed. See migration 010.
      session_id?: string;
    };

export function createAttempt(
  db: DatabaseSync,
  input: CreateAttemptInput,
  role: "canonical" | "local" = "canonical"
): { attempt_id: string; questions: { id: string; lineage_id: string; type: "mc" | "written" }[] } {
  sweepAbandonedAttempts(db);

  if (input.source === "template") {
    let questions: EligibleQuestion[];
    if (input.questions) {
      const exists = db.prepare("SELECT retired_at FROM template WHERE id = ?").get(input.template_id) as { retired_at: string | null } | undefined;
      if (!exists) throw new DomainError("not_found", `Template "${input.template_id}" does not exist.`);
      if (exists.retired_at) throw new DomainError("template_retired", `Template "${input.template_id}" is retired.`);
      questions = input.questions;
    } else {
      questions = resolveTemplateDraw(db, input.template_id).questions;
    }
    // An attempt with no responses can't be taken (the Take screen has nothing
    // to show) and would sit in history as a phantom zero — refuse it.
    if (questions.length === 0) {
      throw new DomainError("empty_draw", "No eligible questions for this template on this node.");
    }

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
      questions.forEach((q, i) => insertResponse.run(uuidv4(), attemptId, q.id, i));

      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    return { attempt_id: attemptId, questions };
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

  // A bad session id would otherwise surface as a raw SQLite FK error (or, on a
  // connection without foreign_keys ON, silently write a dangling reference).
  if (input.session_id) {
    const session = db.prepare("SELECT id FROM tutor_session WHERE id = ?").get(input.session_id);
    if (!session) throw new DomainError("not_found", `Session "${input.session_id}" does not exist.`);
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
      `INSERT INTO attempt (id, node_id, source, delivery_mode, session_id, started_at)
       VALUES (?, ?, 'adhoc', ?, ?, datetime('now'))`
    ).run(attemptId, input.node_id, input.delivery_mode, input.session_id ?? null);

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
// Present item (live, app-rendered) — creates an adhoc/app_live attempt for a
// single question and returns a withheld snapshot for the tutor's own
// bookkeeping. The app is what actually shows this to the learner.
// ----------------------------------------------------------------------------

export interface PresentItemInput {
  node_id: string;
  question_id?: string;
  tag_query?: TagQuery;
  // Optional (see Task 1.6's decision point): present_item still works
  // standalone, but every real tutor-driven call supplies the session it
  // belongs to, so the app's live screen only ever surfaces this session's item.
  session_id?: string;
}

export function presentItem(
  db: DatabaseSync,
  input: PresentItemInput
): { attempt_id: string; response_id: string; question: Record<string, unknown> } {
  let questionId: string;

  if (input.question_id) {
    questionId = input.question_id;
  } else if (input.tag_query) {
    const eligible = getEligibleQuestions(db, { tag_query: input.tag_query });
    if (eligible.length === 0) {
      throw new DomainError("no_eligible_questions", "No question matches the given tag_query.");
    }
    questionId = eligible[Math.floor(Math.random() * eligible.length)].id;
  } else {
    throw new DomainError("selection_required", "present_item requires either question_id or tag_query.");
  }

  const { attempt_id, questions } = createAttempt(db, {
    node_id: input.node_id,
    source: "adhoc",
    question_ids: [questionId],
    delivery_mode: "app_live",
    session_id: input.session_id,
  });

  const response = db.prepare("SELECT id FROM response WHERE attempt_id = ?").get(attempt_id) as { id: string };

  return {
    attempt_id,
    response_id: response.id,
    question: questionSnapshot(db, questions[0].id, false),
  };
}

// ----------------------------------------------------------------------------
// Quick check (chat-mediated, free-response only) — the narrow in-node
// comprehension check that stays in the conversation instead of switching to
// the app. Same shape as presentItem, but restricted to type "written" (a
// real runtime check, not just convention — see Global Constraints) and
// tagged delivery_mode: "chat_quick_check" so Task 1.4's app-polling route
// never picks it up.
// ----------------------------------------------------------------------------

export interface QuickCheckInput {
  node_id: string;
  question_id?: string;
  tag_query?: TagQuery;
  // Optional, mirrors presentItem's session_id: quick_check still works
  // standalone, but a tutor-driven call inside a session should pass it so
  // this check's history groups under that session too.
  session_id?: string;
}

export function quickCheck(
  db: DatabaseSync,
  input: QuickCheckInput
): { attempt_id: string; response_id: string; question: Record<string, unknown> } {
  let questionId: string;

  if (input.question_id) {
    questionId = input.question_id;
  } else if (input.tag_query) {
    const eligible = getEligibleQuestions(db, { tag_query: input.tag_query });
    const written = eligible.filter((q) => q.type === "written");
    if (written.length === 0) {
      throw new DomainError("no_eligible_questions", "No written question matches the given tag_query.");
    }
    questionId = written[Math.floor(Math.random() * written.length)].id;
  } else {
    throw new DomainError("selection_required", "quick_check requires either question_id or tag_query.");
  }

  const question = db.prepare("SELECT type FROM question WHERE id = ?").get(questionId) as
    | { type: string }
    | undefined;
  if (!question) throw new DomainError("not_found", `Question "${questionId}" does not exist.`);
  if (question.type !== "written") {
    throw new DomainError("mc_not_allowed", "quick_check is free-response only — use present_item for mc items.");
  }

  const { attempt_id, questions } = createAttempt(db, {
    node_id: input.node_id,
    source: "adhoc",
    question_ids: [questionId],
    delivery_mode: "chat_quick_check",
    session_id: input.session_id,
  });

  const response = db.prepare("SELECT id FROM response WHERE attempt_id = ?").get(attempt_id) as { id: string };

  return { attempt_id, response_id: response.id, question: questionSnapshot(db, questions[0].id, false) };
}

export function submitQuickCheck(
  db: DatabaseSync,
  input: {
    response_id: string;
    response_text: string;
    confidence?: "unsure" | "somewhat" | "confident";
    idk?: boolean;
    misapplied_method?: string;
  }
): AnsweredOutcome {
  const row = db.prepare("SELECT attempt_id, question_id FROM response WHERE id = ?").get(input.response_id) as
    | { attempt_id: string; question_id: string }
    | undefined;
  if (!row) throw new DomainError("not_found", `Response "${input.response_id}" does not exist.`);

  answerResponse(db, row.attempt_id, input.response_id, {
    response_text: input.response_text,
    confidence: input.confidence,
    idk: input.idk,
    misapplied_method: input.misapplied_method,
  });
  submitAttempt(db, row.attempt_id);

  const outcome = getItemOutcome(db, input.response_id);
  if (outcome.status !== "answered") {
    throw new DomainError("internal_error", "quick check did not resolve to an answered outcome");
  }
  return outcome;
}

// ----------------------------------------------------------------------------
// Await item outcome — non-blocking read of whether the app-side answer (via
// the existing PATCH .../responses/:id + POST .../submit routes, which call
// answerResponse/submitAttempt above) has landed yet. The MCP layer wraps
// this in a bounded poll (Task 1.3 Step 5); this function itself never waits.
// ----------------------------------------------------------------------------

export type OutcomeLabel = "correct" | "partial" | "incorrect" | "dont_know" | "ungraded";

// The tutor's outcome ∈ {correct, incorrect, dont_know} plus the two states a
// written item passes through before a grade exists / when a self-grade is
// 0.5. "I don't know" wins over any score, since idk is a deliberate third
// answer, not a wrong one.
export function deriveOutcome(idk: boolean, score: number | null): OutcomeLabel {
  if (idk) return "dont_know";
  if (score === null) return "ungraded";
  if (score >= 1) return "correct";
  if (score <= 0) return "incorrect";
  return "partial";
}

export type AnsweredOutcome = {
  status: "answered";
  outcome: OutcomeLabel;
  score: number | null;
  correct: boolean | null;
  selected_choice_id: string | null;
  chosen_misconception: string | null;
  correct_choice_id: string | null;
  response_text: string | null;
  confidence: "unsure" | "somewhat" | "confident" | null;
  idk: boolean;
  misapplied_method: string | null;
  elapsed_ms: number | null;
  answered_at: string | null;
  explanation: string | null;
  model_answer: string | null;
};

export type ItemOutcome = { status: "pending" } | { status: "abandoned" } | AnsweredOutcome;

export function getItemOutcome(db: DatabaseSync, responseId: string): ItemOutcome {
  sweepAbandonedAttempts(db);

  const row = db
    .prepare(
      `SELECT r.attempt_id, r.question_id, a.submitted_at, a.abandoned_at,
              r.selected_choice_id, r.response_text, r.elapsed_ms, r.answered_at,
              r.confidence, r.idk, r.misapplied_method
       FROM response r JOIN attempt a ON a.id = r.attempt_id
       WHERE r.id = ?`
    )
    .get(responseId) as
    | {
        attempt_id: string; question_id: string; submitted_at: string | null; abandoned_at: string | null;
        selected_choice_id: string | null; response_text: string | null; elapsed_ms: number | null;
        answered_at: string | null; confidence: "unsure" | "somewhat" | "confident" | null; idk: number;
        misapplied_method: string | null;
      }
    | undefined;
  if (!row) throw new DomainError("not_found", `Response "${responseId}" does not exist.`);

  if (row.abandoned_at && !row.submitted_at) return { status: "abandoned" };
  if (!row.submitted_at) return { status: "pending" };

  const question = db.prepare("SELECT type, explanation, model_answer FROM question WHERE id = ?").get(
    row.question_id
  ) as { type: "mc" | "written"; explanation: string | null; model_answer: string | null };

  const liveGrade = db
    .prepare("SELECT score FROM grade WHERE response_id = ? AND superseded_at IS NULL")
    .get(responseId) as { score: number } | undefined;
  const score = liveGrade ? liveGrade.score : null;

  const correctChoice =
    question.type === "mc"
      ? (db.prepare("SELECT id FROM choice WHERE question_id = ? AND is_correct = 1").get(row.question_id) as
          | { id: string }
          | undefined)
      : undefined;
  const chosen = row.selected_choice_id
    ? (db.prepare("SELECT misconception FROM choice WHERE id = ?").get(row.selected_choice_id) as
        | { misconception: string | null }
        | undefined)
    : undefined;

  return {
    status: "answered",
    outcome: deriveOutcome(row.idk === 1, score),
    score,
    correct: question.type === "mc" ? score === 1 : null,
    selected_choice_id: row.selected_choice_id,
    chosen_misconception: chosen?.misconception ?? null,
    correct_choice_id: correctChoice?.id ?? null,
    response_text: row.response_text,
    confidence: row.confidence,
    idk: row.idk === 1,
    misapplied_method: row.misapplied_method,
    elapsed_ms: row.elapsed_ms,
    answered_at: row.answered_at,
    explanation: question.explanation,
    model_answer: question.model_answer,
  };
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
  session_id: string | null;
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
  confidence: "unsure" | "somewhat" | "confident" | null;
  idk: number;
  misapplied_method: string | null;
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
    session_id: attempt.session_id,
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
        confidence: r.confidence,
        idk: r.idk === 1,
        misapplied_method: r.misapplied_method,
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
              (SELECT AVG(rs.score) FROM response_score rs WHERE rs.attempt_id = a.id) AS mean_score,
              (SELECT COUNT(*) FROM response_score rs WHERE rs.attempt_id = a.id AND rs.score IS NULL) AS ungraded
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
    ungraded: number;
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
      ungraded: r.ungraded,
    })),
  };
}

// ----------------------------------------------------------------------------
// Update a response in progress
// ----------------------------------------------------------------------------

// Mirrors migration 012's CHECK on response.confidence, so a bad value is a
// legible DomainError (400 over HTTP) rather than a raw SQLite constraint error.
const CONFIDENCE_LEVELS = new Set(["unsure", "somewhat", "confident"]);

export interface AnswerResponseChanges {
  selected_choice_id?: string | null;
  response_text?: string | null;
  skipped?: boolean;
  elapsed_ms?: number;
  confidence?: "unsure" | "somewhat" | "confident" | null;
  idk?: boolean;
  misapplied_method?: string | null;
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

  const response = db
    .prepare("SELECT id, question_id FROM response WHERE id = ? AND attempt_id = ?")
    .get(responseId, attemptId) as { id: string; question_id: string } | undefined;
  if (!response) throw new DomainError("not_found", `Response "${responseId}" does not exist on this attempt.`);

  // submitAttempt grades an mc response by looking its choice up by id alone,
  // so a choice id from any other question would be scored against that
  // question's answer key. Pin the choice to this response's question here.
  if (changes.selected_choice_id != null) {
    const choice = db
      .prepare("SELECT id FROM choice WHERE id = ? AND question_id = ?")
      .get(changes.selected_choice_id, response.question_id);
    if (!choice) {
      throw new DomainError(
        "invalid_choice",
        `Choice "${changes.selected_choice_id}" does not belong to this response's question.`
      );
    }
  }
  if (changes.confidence != null && !CONFIDENCE_LEVELS.has(changes.confidence)) {
    throw new DomainError(
      "invalid_confidence",
      `confidence must be one of ${[...CONFIDENCE_LEVELS].join(", ")}, got ${JSON.stringify(changes.confidence)}.`
    );
  }
  if (changes.elapsed_ms != null && (!Number.isFinite(changes.elapsed_ms) || changes.elapsed_ms < 0)) {
    throw new DomainError("invalid_elapsed_ms", "elapsed_ms must be a non-negative number.");
  }

  // PATCH semantics: a key that is absent leaves the column alone; a key
  // that is present — including an explicit null — is written as given, so
  // a caller can clear a choice/confidence/misapplied_method again (e.g.
  // switching from a picked choice to "I don't know" and back).
  const sets: string[] = ["answered_at = datetime('now')"];
  const values: Record<string, unknown> = { id: responseId };
  const assign = (column: string, value: unknown) => {
    sets.push(`${column} = @${column}`);
    values[column] = value;
  };
  if (changes.selected_choice_id !== undefined) assign("selected_choice_id", changes.selected_choice_id);
  if (changes.response_text !== undefined) assign("response_text", changes.response_text);
  if (changes.skipped !== undefined) assign("skipped", changes.skipped ? 1 : 0);
  if (changes.elapsed_ms !== undefined) assign("elapsed_ms", changes.elapsed_ms);
  if (changes.confidence !== undefined) assign("confidence", changes.confidence);
  if (changes.idk !== undefined) assign("idk", changes.idk ? 1 : 0);
  if (changes.misapplied_method !== undefined) assign("misapplied_method", changes.misapplied_method);

  db.prepare(`UPDATE response SET ${sets.join(", ")} WHERE id = @id`).run(values as Record<string, any>);

  const updated = db.prepare("SELECT * FROM response WHERE id = ?").get(responseId) as unknown as ResponseRow;
  return {
    id: updated.id,
    selected_choice_id: updated.selected_choice_id,
    response_text: updated.response_text,
    skipped: updated.skipped === 1,
    answered_at: updated.answered_at,
    elapsed_ms: updated.elapsed_ms,
    confidence: updated.confidence,
    idk: updated.idk === 1,
    misapplied_method: updated.misapplied_method,
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
