import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "./errors.js";
import { emitSessionEvent } from "../lib/events.js";
import { resolveTemplateDraw, getEligibleQuestions, type DrawResult, type EligibleQuestion } from "./draw.js";
import type { TagQuery } from "./tagQuery.js";
import { assertSessionOpen, sessionIsOpen, sessionRevealDefault, type Reveal } from "./sessions.js";
import { nodeKeyFields } from "./nodeKeys.js";
import { serializeContext, parseContext, type ItemContext } from "./context.js";

// Unsubmitted attempts older than this many hours are considered abandoned.
// Swept lazily (no background timer) whenever attempts are read or created.
function abandonAfterHours(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM config WHERE key = 'abandon_after_hours'").get() as
    | { value: string }
    | undefined;
  return row ? Number(JSON.parse(row.value)) : 24;
}

// A paused attempt is never abandoned (the learner stepped away on purpose,
// §2.8), and time already spent paused is discounted from the window — an
// attempt started 25h ago with 10h of pause has only been "live" for 15h.
export function sweepAbandonedAttempts(db: DatabaseSync): void {
  const hours = abandonAfterHours(db);
  db.prepare(
    `UPDATE attempt
     SET abandoned_at = datetime('now')
     WHERE submitted_at IS NULL
       AND abandoned_at IS NULL
       AND paused_at IS NULL
       AND datetime(started_at, '+' || (paused_ms / 1000) || ' seconds') <= datetime('now', ?)`
  ).run(`-${hours} hours`);
}

// ----------------------------------------------------------------------------
// Pause / resume (§2.8) — the learner stepping away from a live item.
// ----------------------------------------------------------------------------

function assertAttemptOpen(
  db: DatabaseSync,
  attemptId: string
): { paused_at: string | null; paused_ms: number } {
  const attempt = db
    .prepare("SELECT submitted_at, abandoned_at, paused_at, paused_ms FROM attempt WHERE id = ?")
    .get(attemptId) as
    | { submitted_at: string | null; abandoned_at: string | null; paused_at: string | null; paused_ms: number }
    | undefined;
  if (!attempt) throw new DomainError("not_found", `Attempt "${attemptId}" does not exist.`);
  if (attempt.submitted_at) throw new DomainError("attempt_submitted", "This attempt was already submitted.");
  if (attempt.abandoned_at) throw new DomainError("attempt_abandoned", "This attempt was abandoned.");
  return { paused_at: attempt.paused_at, paused_ms: attempt.paused_ms };
}

// Which session (if any) an attempt belongs to — the address an event is
// published to. An attempt outside a session simply has nobody listening, and
// emitSessionEvent treats a null id as a no-op.
function attemptSessionId(db: DatabaseSync, attemptId: string): string | null {
  const row = db.prepare("SELECT session_id FROM attempt WHERE id = ?").get(attemptId) as
    | { session_id: string | null }
    | undefined;
  return row?.session_id ?? null;
}

export function pauseAttempt(db: DatabaseSync, attemptId: string): { id: string; paused_at: string } {
  const attempt = assertAttemptOpen(db, attemptId);
  if (attempt.paused_at) {
    throw new DomainError("already_paused", `Attempt "${attemptId}" is already paused since ${attempt.paused_at}.`);
  }
  db.prepare("UPDATE attempt SET paused_at = datetime('now') WHERE id = ?").run(attemptId);
  const row = db.prepare("SELECT paused_at FROM attempt WHERE id = ?").get(attemptId) as { paused_at: string };
  emitSessionEvent(attemptSessionId(db, attemptId), { type: "attempt_paused", attempt_id: attemptId });
  return { id: attemptId, paused_at: row.paused_at };
}

export function resumeAttempt(
  db: DatabaseSync,
  attemptId: string
): { id: string; paused_at: null; paused_ms: number } {
  const attempt = assertAttemptOpen(db, attemptId);
  if (!attempt.paused_at) throw new DomainError("not_paused", `Attempt "${attemptId}" is not paused.`);
  const resumed = resumeIfPaused(db, attemptId);
  emitSessionEvent(attemptSessionId(db, attemptId), { type: "attempt_resumed", attempt_id: attemptId });
  return resumed;
}

// The unguarded half of resumeAttempt: answerResponse calls it so an answer
// arriving on a paused attempt resumes it instead of being refused. The
// duration floors at 0: a clock that moved backwards while paused would
// otherwise store a negative paused_ms, and the sweep's '+-N seconds'
// modifier would exempt the attempt from ever being abandoned.
function resumeIfPaused(
  db: DatabaseSync,
  attemptId: string
): { id: string; paused_at: null; paused_ms: number } {
  db.prepare(
    `UPDATE attempt
     SET paused_ms = paused_ms + MAX(0, strftime('%s', 'now') - strftime('%s', paused_at)) * 1000,
         paused_at = NULL
     WHERE id = ? AND paused_at IS NOT NULL`
  ).run(attemptId);
  const row = db.prepare("SELECT paused_ms FROM attempt WHERE id = ?").get(attemptId) as { paused_ms: number };
  return { id: attemptId, paused_at: null, paused_ms: row.paused_ms };
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
    ...nodeKeyFields(db, questionId),
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
      // Whether the learner sees the answer key on submit ('immediate') or
      // only once the session ends ('deferred'). Defaults to immediate.
      reveal?: Reveal;
      // Optional by design: an adhoc attempt with session_id IS NULL behaves
      // exactly as it did before sessions existed. See migration 010.
      session_id?: string;
      // The tutor's breadcrumb for this item, already serialized (§5.1).
      // Stored verbatim and only ever displayed — see domain/context.ts.
      context_json?: string | null;
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
  if (input.session_id) assertSessionOpen(db, input.session_id);

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
      `INSERT INTO attempt (id, node_id, source, delivery_mode, session_id, reveal, context_json, started_at)
       VALUES (?, ?, 'adhoc', ?, ?, ?, ?, datetime('now'))`
    ).run(
      attemptId,
      input.node_id,
      input.delivery_mode,
      input.session_id ?? null,
      input.reveal ?? "immediate",
      input.context_json ?? null
    );

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
  // Overrides the session's reveal_default for this one item.
  reveal?: Reveal;
  // Where in the course this item comes from, and how long it is meant to
  // take — the same object present_show carries, so the app's banner reads
  // the same whichever kind of entry is newest (§5.1).
  context?: ItemContext | null;
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

  // An ephemeral item belongs to the session it was written in and is
  // presentable only while that session is still running.
  const ephemeral = db.prepare("SELECT ephemeral, session_id FROM question WHERE id = ?").get(questionId) as
    | { ephemeral: number; session_id: string | null }
    | undefined;
  if (ephemeral?.ephemeral === 1) {
    if (!ephemeral.session_id) {
      throw new DomainError("not_found", `Ephemeral question "${questionId}" has no session and cannot be presented.`);
    }
    assertSessionOpen(db, ephemeral.session_id);
  }

  const reveal = input.reveal ?? (input.session_id ? sessionRevealDefault(db, input.session_id) : "immediate");

  const { attempt_id, questions } = createAttempt(db, {
    node_id: input.node_id,
    source: "adhoc",
    question_ids: [questionId],
    delivery_mode: "app_live",
    session_id: input.session_id,
    reveal,
    context_json: serializeContext(input.context),
  });

  const response = db.prepare("SELECT id FROM response WHERE attempt_id = ?").get(attempt_id) as { id: string };

  // The app's live screen is waiting on exactly this: told now rather than up
  // to a poll interval later. Emitted after createAttempt committed, so the
  // re-read this triggers already finds the item.
  emitSessionEvent(input.session_id ?? null, {
    type: "item_presented",
    attempt_id,
    response_id: response.id,
  });

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

export type Confidence = "unsure" | "somewhat" | "confident";

// The numeric scale readme() documents under prompt_conventions.confidence_scale,
// so the tutor's typed channel and Osmosis agree on what "somewhat" is worth.
export const CONFIDENCE_NUMERIC: Record<Confidence, number> = { unsure: 1, somewhat: 3, confident: 5 };

export function confidenceNumeric(confidence: Confidence | null): number | null {
  return confidence ? CONFIDENCE_NUMERIC[confidence] : null;
}

// The "best guess anyway" a learner names after an idk (§2.3). Graded
// server-side for the tutor's benefit, never scored: the response stays an idk.
export function bestGuessCorrect(db: DatabaseSync, choiceId: string | null): boolean | null {
  if (!choiceId) return null;
  const choice = db.prepare("SELECT is_correct FROM choice WHERE id = ?").get(choiceId) as
    | { is_correct: number }
    | undefined;
  return choice ? choice.is_correct === 1 : null;
}

export type AnsweredOutcome = {
  status: "answered";
  outcome: OutcomeLabel;
  score: number | null;
  grader: GradeRow["grader"] | null;
  correct: boolean | null;
  selected_choice_id: string | null;
  chosen_misconception: string | null;
  correct_choice_id: string | null;
  best_guess_choice_id: string | null;
  best_guess_correct: boolean | null;
  response_text: string | null;
  confidence: Confidence | null;
  confidence_numeric: number | null;
  idk: boolean;
  misapplied_method: string | null;
  diagnosis: string | null;
  elapsed_ms: number | null;
  answered_at: string | null;
  explanation: string | null;
  model_answer: string | null;
  // Which teachable idea this item was targeting, so the tutor can file the
  // outcome without a second read (§3.10). Primary first.
  node_key: string | null;
  node_keys: string[];
};

export type ItemOutcome =
  | { status: "pending" }
  | { status: "abandoned" }
  | { status: "paused"; paused_at: string }
  | AnsweredOutcome;

export function getItemOutcome(db: DatabaseSync, responseId: string): ItemOutcome {
  sweepAbandonedAttempts(db);

  const row = db
    .prepare(
      `SELECT r.attempt_id, r.question_id, a.submitted_at, a.abandoned_at, a.paused_at,
              r.selected_choice_id, r.response_text, r.elapsed_ms, r.answered_at,
              r.confidence, r.idk, r.misapplied_method, r.best_guess_choice_id, r.diagnosis
       FROM response r JOIN attempt a ON a.id = r.attempt_id
       WHERE r.id = ?`
    )
    .get(responseId) as
    | {
        attempt_id: string; question_id: string; submitted_at: string | null; abandoned_at: string | null;
        paused_at: string | null;
        selected_choice_id: string | null; response_text: string | null; elapsed_ms: number | null;
        answered_at: string | null; confidence: Confidence | null; idk: number;
        misapplied_method: string | null; best_guess_choice_id: string | null; diagnosis: string | null;
      }
    | undefined;
  if (!row) throw new DomainError("not_found", `Response "${responseId}" does not exist.`);

  if (row.abandoned_at && !row.submitted_at) return { status: "abandoned" };
  if (row.paused_at && !row.submitted_at) return { status: "paused", paused_at: row.paused_at };
  if (!row.submitted_at) return { status: "pending" };

  const question = db.prepare("SELECT type, explanation, model_answer FROM question WHERE id = ?").get(
    row.question_id
  ) as { type: "mc" | "written"; explanation: string | null; model_answer: string | null };

  const liveGrade = db
    .prepare("SELECT score, grader FROM grade WHERE response_id = ? AND superseded_at IS NULL")
    .get(responseId) as { score: number; grader: GradeRow["grader"] } | undefined;
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
    grader: liveGrade?.grader ?? null,
    correct: question.type === "mc" ? score === 1 : null,
    selected_choice_id: row.selected_choice_id,
    chosen_misconception: chosen?.misconception ?? null,
    correct_choice_id: correctChoice?.id ?? null,
    best_guess_choice_id: row.best_guess_choice_id,
    best_guess_correct: bestGuessCorrect(db, row.best_guess_choice_id),
    response_text: row.response_text,
    confidence: row.confidence,
    confidence_numeric: confidenceNumeric(row.confidence),
    idk: row.idk === 1,
    misapplied_method: row.misapplied_method,
    diagnosis: row.diagnosis,
    elapsed_ms: row.elapsed_ms,
    answered_at: row.answered_at,
    explanation: question.explanation,
    model_answer: question.model_answer,
    ...nodeKeyFields(db, row.question_id),
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
  reveal: Reveal;
  context_json: string | null;
  started_at: string;
  submitted_at: string | null;
  abandoned_at: string | null;
  paused_at: string | null;
  paused_ms: number;
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
  confidence: Confidence | null;
  idk: number;
  misapplied_method: string | null;
  best_guess_choice_id: string | null;
  diagnosis: string | null;
}

interface GradeRow {
  id: string;
  response_id: string;
  grader: "auto_mc" | "self" | "model" | "oracle" | "judge";
  score: number;
  feedback: string | null;
  rubric_version: string | null;
  model_name: string | null;
  graded_at: string;
}

// Who is reading. 'learner' is the app — the Take/Review screens and the
// submit response — and is the only viewer a deferred attempt withholds from.
// 'tutor' is every MCP tool: the tutor is not the learner, and a reveal
// policy written for the learner's screen must never blind the tutor to what
// its own item did (§3.1).
//
// The default is 'learner', and deliberately the cautious one: a caller that
// forgets to say gets the withheld view, not the answer key. The tutor's
// reads are few and all go through the MCP layer, so they can afford to name
// themselves.
export type AttemptViewer = "learner" | "tutor";

export function getAttemptDetail(
  db: DatabaseSync,
  attemptId: string,
  opts: { viewer?: AttemptViewer } = {}
): Record<string, unknown> {
  sweepAbandonedAttempts(db);

  const attempt = db.prepare("SELECT * FROM attempt WHERE id = ?").get(attemptId) as unknown as
    | AttemptRow
    | undefined;
  if (!attempt) throw new DomainError("not_found", `Attempt "${attemptId}" does not exist.`);

  const viewer = opts.viewer ?? "learner";
  // A deferred attempt holds its key back from the learner until the session
  // it belongs to ends. With no session there is nothing to wait for, so it
  // reveals on submit exactly like an immediate one.
  const deferredHold =
    viewer === "learner" &&
    attempt.reveal === "deferred" &&
    attempt.session_id !== null &&
    sessionIsOpen(db, attempt.session_id);

  const revealAnswer = !deferredHold && attempt.submitted_at !== null;
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
    reveal: attempt.reveal,
    // Whether this payload carries the answer key at all.
    revealed: revealAnswer,
    template_id: attempt.template_id,
    daily_draw_id: attempt.daily_draw_id,
    session_id: attempt.session_id,
    // The tutor's breadcrumb, if it named one (§5.1). Never answer-key
    // material — it says where the item came from, not what it answers to.
    context: parseContext(attempt.context_json),
    started_at: attempt.started_at,
    submitted_at: attempt.submitted_at,
    abandoned_at: attempt.abandoned_at,
    paused_at: attempt.paused_at,
    paused_ms: attempt.paused_ms,
    offline: attempt.offline === 1,
    responses: responses.map((r) => {
      const grade = liveGrade.get(r.id) as unknown as GradeRow | undefined;
      const chosen = r.selected_choice_id
        ? (db.prepare("SELECT misconception FROM choice WHERE id = ?").get(r.selected_choice_id) as
            | { misconception: string | null }
            | undefined)
        : undefined;
      return {
        id: r.id,
        ordinal: r.ordinal,
        question: questionSnapshot(db, r.question_id, revealAnswer),
        selected_choice_id: r.selected_choice_id,
        // Both of these are answer-key material (a misconception only hangs on
        // a distractor; best_guess_correct is correctness outright), so they
        // stay withheld until submit, exactly like questionSnapshot's key.
        chosen_misconception: revealAnswer ? chosen?.misconception ?? null : null,
        best_guess_choice_id: r.best_guess_choice_id,
        best_guess_correct: revealAnswer ? bestGuessCorrect(db, r.best_guess_choice_id) : null,
        response_text: r.response_text,
        skipped: r.skipped === 1,
        answered_at: r.answered_at,
        elapsed_ms: r.elapsed_ms,
        confidence: r.confidence,
        confidence_numeric: confidenceNumeric(r.confidence),
        idk: r.idk === 1,
        misapplied_method: r.misapplied_method,
        // The verdict itself — outcome, score, the tutor's diagnosis — is
        // answer-key material under a deferred reveal, so it is omitted
        // outright rather than nulled: an absent key reads as "not yet",
        // a null would read as "no verdict".
        ...(deferredHold
          ? {}
          : {
              diagnosis: r.diagnosis,
              outcome: deriveOutcome(r.idk === 1, grade ? grade.score : null),
              grade: grade
                ? { grader: grade.grader, score: grade.score, feedback: grade.feedback, graded_at: grade.graded_at }
                : null,
            }),
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
              CASE WHEN a.session_id IS NOT NULL OR a.delivery_mode = 'app_live' THEN 'tutor' ELSE 'self' END AS source_kind,
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
    source_kind: "tutor" | "self";
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
      // Who set this attempt going: the tutor (it belongs to a session, or it
      // was delivered live into the app) or Ben himself.
      source_kind: r.source_kind,
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
  confidence?: Confidence | null;
  idk?: boolean;
  misapplied_method?: string | null;
  best_guess_choice_id?: string | null;
}

export function answerResponse(
  db: DatabaseSync,
  attemptId: string,
  responseId: string,
  changes: AnswerResponseChanges
): Record<string, unknown> {
  const attempt = db
    .prepare("SELECT submitted_at, abandoned_at, paused_at, session_id FROM attempt WHERE id = ?")
    .get(attemptId) as
    | { submitted_at: string | null; abandoned_at: string | null; paused_at: string | null; session_id: string | null }
    | undefined;
  if (!attempt) throw new DomainError("not_found", `Attempt "${attemptId}" does not exist.`);
  if (attempt.submitted_at) throw new DomainError("attempt_submitted", "Cannot edit responses after submit.");
  if (attempt.abandoned_at) throw new DomainError("attempt_abandoned", "This attempt was abandoned.");

  const response = db
    .prepare("SELECT id, question_id, idk FROM response WHERE id = ? AND attempt_id = ?")
    .get(responseId, attemptId) as { id: string; question_id: string; idk: number } | undefined;
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
  // The guess is asked *after* the blank decision and only then (§2.3): a
  // guess without an idk would be an ordinary answer wearing a second name.
  if (changes.best_guess_choice_id != null) {
    const idkAfter = changes.idk !== undefined ? changes.idk : response.idk === 1;
    if (!idkAfter) {
      throw new DomainError(
        "best_guess_requires_idk",
        "best_guess_choice_id is only meaningful on an idk response — pass idk: true with it."
      );
    }
    const guess = db
      .prepare("SELECT id FROM choice WHERE id = ? AND question_id = ?")
      .get(changes.best_guess_choice_id, response.question_id);
    if (!guess) {
      throw new DomainError(
        "invalid_choice",
        `Choice "${changes.best_guess_choice_id}" does not belong to this response's question.`
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
  if (changes.best_guess_choice_id !== undefined) assign("best_guess_choice_id", changes.best_guess_choice_id);
  // Taking the idk back takes the guess with it. Otherwise a stored
  // {idk, guess} could be flipped to a plain answer by a later PATCH and
  // still carry a guess — scored as an ordinary answer *and* reported as a
  // best guess, which is exactly what best_guess_requires_idk forbids.
  else if (changes.idk === false) assign("best_guess_choice_id", null);

  db.prepare(`UPDATE response SET ${sets.join(", ")} WHERE id = @id`).run(values as Record<string, any>);

  // An answer arriving on a paused attempt means the learner is back: resume
  // rather than refuse, so the app never has to sequence resume-then-answer.
  if (attempt.paused_at) resumeIfPaused(db, attemptId);

  // No item_answered here. This is a draft save — a choice, then another, then
  // a confidence — and every one of them announcing an "answer" made the live
  // screens re-read an attempt that was still being typed. The event belongs
  // to submitAttempt, which is where an outcome actually gets recorded.

  const updated = db.prepare("SELECT * FROM response WHERE id = ?").get(responseId) as unknown as ResponseRow;
  return {
    id: updated.id,
    selected_choice_id: updated.selected_choice_id,
    // The guess itself echoes back; whether it was right does not — that is
    // answer-key material, withheld until the attempt is submitted.
    best_guess_choice_id: updated.best_guess_choice_id,
    response_text: updated.response_text,
    skipped: updated.skipped === 1,
    answered_at: updated.answered_at,
    elapsed_ms: updated.elapsed_ms,
    confidence: updated.confidence,
    confidence_numeric: confidenceNumeric(updated.confidence),
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
  const attempt = db
    .prepare("SELECT submitted_at, abandoned_at, session_id FROM attempt WHERE id = ?")
    .get(attemptId) as
    | { submitted_at: string | null; abandoned_at: string | null; session_id: string | null }
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

  // After COMMIT, never inside it: a listener that re-reads on this event has
  // to find the grades, not the transaction that was about to write them. A
  // live item is one question, so its response id is unambiguous; a multi-
  // question attempt names none and the listener re-reads the attempt.
  const answered = db.prepare("SELECT id FROM response WHERE attempt_id = ?").all(attemptId) as unknown as {
    id: string;
  }[];
  emitSessionEvent(attempt.session_id, {
    type: "item_answered",
    attempt_id: attemptId,
    response_id: answered.length === 1 ? answered[0].id : null,
  });

  // The learner's view: this return is what the app's submit route hands
  // straight back to the screen, and a deferred attempt must not put its key
  // there. The tutor reads the same attempt through get_attempt, which names
  // itself.
  return getAttemptDetail(db, attemptId, { viewer: "learner" });
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

// ----------------------------------------------------------------------------
// The tutor's own grade (spec §2.9) — an oracle (the tutor knows the answer)
// or judge (the tutor is judging a written answer) verdict, plus the one-line
// diagnosis that goes back on the response itself.
// ----------------------------------------------------------------------------

export interface TutorGradeInput {
  grader: "oracle" | "judge";
  score?: number;
  diagnosis?: string | null;
}

export function gradeResponseByTutor(
  db: DatabaseSync,
  responseId: string,
  input: TutorGradeInput,
  role: "canonical" | "local" = "canonical"
): Record<string, unknown> {
  if (input.score !== undefined && (!Number.isFinite(input.score) || input.score < 0 || input.score > 1)) {
    throw new DomainError("invalid_score", "score must be a number between 0 and 1.");
  }

  const response = db
    .prepare(
      `SELECT r.id, q.type, a.submitted_at
       FROM response r
       JOIN question q ON q.id = r.question_id
       JOIN attempt a ON a.id = r.attempt_id
       WHERE r.id = ?`
    )
    .get(responseId) as { id: string; type: "mc" | "written"; submitted_at: string | null } | undefined;
  if (!response) throw new DomainError("not_found", `Response "${responseId}" does not exist.`);
  if (!response.submitted_at) {
    throw new DomainError("attempt_not_submitted", "Grade a response only after its attempt is submitted.");
  }

  db.exec("BEGIN");
  try {
    // PATCH semantics, as answerResponse has: an omitted diagnosis leaves the
    // recorded one alone, an explicit null clears it.
    if (input.diagnosis !== undefined) {
      db.prepare("UPDATE response SET diagnosis = ? WHERE id = ?").run(input.diagnosis, responseId);
    }

    // An mc item is already graded against its own key; a tutor verdict would
    // only ever disagree with the key. Take the diagnosis, leave the score.
    if (response.type === "written" && input.score !== undefined) {
      const live = db.prepare("SELECT * FROM grade WHERE response_id = ? AND superseded_at IS NULL").get(
        responseId
      ) as unknown as GradeRow | undefined;
      if (live) db.prepare("UPDATE grade SET superseded_at = datetime('now') WHERE id = ?").run(live.id);

      const id = uuidv4();
      db.prepare(
        "INSERT INTO grade (id, response_id, grader, score, graded_at) VALUES (?, ?, ?, ?, datetime('now'))"
      ).run(id, responseId, input.grader, input.score);

      if (role === "local") {
        if (live) enqueueOutbox(db, "grade", live.id, db.prepare("SELECT * FROM grade WHERE id = ?").get(live.id));
        enqueueOutbox(db, "grade", id, db.prepare("SELECT * FROM grade WHERE id = ?").get(id));
      }
    }

    if (role === "local") {
      enqueueOutbox(db, "response", responseId, db.prepare("SELECT * FROM response WHERE id = ?").get(responseId));
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const grade = db.prepare("SELECT * FROM grade WHERE response_id = ? AND superseded_at IS NULL").get(
    responseId
  ) as unknown as GradeRow | undefined;
  const stored = db.prepare("SELECT diagnosis FROM response WHERE id = ?").get(responseId) as {
    diagnosis: string | null;
  };
  return {
    response_id: responseId,
    grader: grade?.grader ?? null,
    score: grade?.score ?? null,
    graded_at: grade?.graded_at ?? null,
    diagnosis: stored.diagnosis,
  };
}
