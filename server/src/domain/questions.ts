import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "./errors.js";
import { buildTagQueryClause, type TagQuery } from "./tagQuery.js";
import { getAsset } from "./assets.js";
import {
  nodeKeyFields,
  nodeKeyFilterClause,
  getNodeKeys,
  primaryNodeKey,
  replaceNodeKeys,
  resolveNodeKeys,
  validateNodeKeys,
} from "./nodeKeys.js";
import { assertSessionOpen } from "./sessions.js";
// TODO: once graph-engine is published as a built package (a parallel effort
// is packaging it as `graph-engine/parser` exporting `parseSpec`), this import
// resolves at runtime. The import itself is correct today; only the dist
// build's presence is unverified as of writing.
import { parseSpec } from "graph-engine/parser";
import { findTokenSpan } from "document-engine/core";

export type QuestionType = "mc" | "written";
export type CalculatorPolicy = "allowed" | "forbidden" | "n_a";

export interface ChoiceInput {
  body: string;
  is_correct: boolean;
  misconception?: string | null;
}

export interface QuestionInput {
  type: string;
  prompt: string;
  tags: string[];
  difficulty?: number;
  calculator_policy?: string;
  explanation?: string | null;
  source_note?: string | null;
  choices?: ChoiceInput[];
  model_answer?: string | null;
  rubric?: unknown;
  graph_spec?: string | null;
  desmos_allowed?: boolean;
  document_id?: string | null;
  document_anchor_label?: string | null;
  document_anchor_start?: number | null;
  document_anchor_end?: number | null;
  document_marker_offset?: number | null;
  claim_rung?: "can_state" | "can_apply" | "can_discriminate" | "can_explain_why" | "can_transfer" | null;
  tests_error?: string | null;
  provenance?: "tutor_authored" | "textbook_sourced" | null;
  node_key?: string | null;
  node_keys?: string[] | null;
}

export interface QuestionRow {
  id: string;
  lineage_id: string;
  version: number;
  supersedes_id: string | null;
  type: QuestionType;
  prompt: string;
  explanation: string | null;
  model_answer: string | null;
  rubric: string | null;
  difficulty: number;
  calculator_policy: CalculatorPolicy;
  source_note: string | null;
  created_by: "claude" | "human";
  created_at: string;
  retired_at: string | null;
  retired_reason: string | null;
  graph_spec: string | null;
  desmos_allowed: number;
  document_id: string | null;
  document_anchor_label: string | null;
  document_anchor_start: number | null;
  document_anchor_end: number | null;
  document_marker_offset: number | null;
  claim_rung: string | null;
  tests_error: string | null;
  provenance: string | null;
  node_key: string | null;
  ephemeral: number;
  session_id: string | null;
  updated_at: string | null;
}

const CALCULATOR_POLICIES = new Set(["allowed", "forbidden", "n_a"]);

function normalizeTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0)
  );
}

// Function words carry no signal about what a question tests; "what is the"
// alone was enough to push two unrelated arithmetic prompts over the
// duplicate threshold. Kept deliberately small and English-only — the goal
// is to stop stem boilerplate dominating, not to do NLP.
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "of", "to", "in", "on", "at", "for", "and", "or",
  "what", "which", "who", "how", "why", "when", "does", "do", "did", "this", "that", "these", "those",
  "it", "its", "as", "by", "with", "from", "into", "if", "then", "than", "not", "following", "true",
  "correct", "best", "describes", "statement", "select", "choose",
]);

// Tokens for the similarity score (not the FTS prefilter): math atoms stay
// whole ("1/2", "2x", "x^2", "3.14") and operators count as tokens, so
// "1/2 ÷ 2/3" and "1/8 + 1/2" share far less than their digits suggest.
function similarityTokens(text: string): Set<string> {
  const out = new Set<string>();
  const re = /[a-z0-9]+(?:[/.^][a-z0-9]+)*|[+\-−×÷*=<>≤≥]/g;
  for (const m of text.toLowerCase().matchAll(re)) {
    const t = m[0];
    if (!STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function ftsQueryFor(text: string): string | null {
  const tokens = [...normalizeTokens(text)].slice(0, 32);
  if (tokens.length === 0) return null;
  // Trailing `*` makes each token a prefix match in FTS5 syntax, so
  // searching "expl" matches "explain"/"explanation" instead of requiring
  // the whole word to be typed.
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" OR ");
}

export interface PossibleDuplicate {
  existing_id: string;
  existing_prompt: string;
  similarity: number;
  shared_tags: string[];
}

const MAX_DUPLICATES_PER_QUESTION = 3;
const DUPLICATE_PROMPT_PREVIEW_LENGTH = 120;

function findPossibleDuplicates(
  db: DatabaseSync,
  prompt: string,
  tags: string[],
  threshold: number,
  excludeId?: string
): PossibleDuplicate[] {
  const ftsQuery = ftsQueryFor(prompt);
  if (!ftsQuery || tags.length === 0) return [];

  const placeholders = tags.map(() => "?").join(", ");
  const candidates = db
    .prepare(
      `SELECT DISTINCT q.id, q.prompt
       FROM question_fts f
       JOIN question q ON q.rowid = f.rowid
       JOIN question_tag qt ON qt.question_id = q.id
       WHERE question_fts MATCH ?
         AND q.retired_at IS NULL
         AND qt.tag_slug IN (${placeholders})
         AND q.id != ?`
    )
    .all(ftsQuery, ...tags, excludeId ?? "") as { id: string; prompt: string }[];

  const newTokens = similarityTokens(prompt);
  const results: PossibleDuplicate[] = [];

  for (const candidate of candidates) {
    const similarity = jaccard(newTokens, similarityTokens(candidate.prompt));
    if (similarity < threshold) continue;

    const candidateTags = (
      db.prepare("SELECT tag_slug FROM question_tag WHERE question_id = ?").all(candidate.id) as {
        tag_slug: string;
      }[]
    ).map((r) => r.tag_slug);

    results.push({
      existing_id: candidate.id,
      existing_prompt:
        candidate.prompt.length > DUPLICATE_PROMPT_PREVIEW_LENGTH
          ? `${candidate.prompt.slice(0, DUPLICATE_PROMPT_PREVIEW_LENGTH)}...`
          : candidate.prompt,
      similarity: Math.round(similarity * 1000) / 1000,
      shared_tags: candidateTags.filter((t) => tags.includes(t)),
    });
  }

  // Capped per question: on a large batch, unbounded near-duplicate reports
  // across many questions can dwarf the batch's own content in the response.
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, MAX_DUPLICATES_PER_QUESTION);
}

function validateQuestionInput(
  db: DatabaseSync,
  q: QuestionInput
): { reason: string; detail: string } | null {
  if (q.type !== "mc" && q.type !== "written") {
    return { reason: "invalid_type", detail: `type must be "mc" or "written", got "${q.type}"` };
  }
  if (!q.tags || q.tags.length === 0) {
    return { reason: "no_tags", detail: "at least one tag is required" };
  }

  const unknown = q.tags.filter((slug) => {
    const row = db.prepare("SELECT slug FROM tag WHERE slug = ? AND retired_at IS NULL").get(slug);
    return !row;
  });
  if (unknown.length > 0) {
    return { reason: "unknown_tag", detail: `unknown or retired tag slug(s): ${unknown.join(", ")}` };
  }

  if (q.difficulty !== undefined && (!Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > 5)) {
    return { reason: "invalid_difficulty", detail: "difficulty must be an integer between 1 and 5" };
  }

  if (q.calculator_policy !== undefined && !CALCULATOR_POLICIES.has(q.calculator_policy)) {
    return {
      reason: "invalid_calculator_policy",
      detail: `calculator_policy must be one of ${[...CALCULATOR_POLICIES].join(", ")}`,
    };
  }

  const CLAIM_RUNGS = new Set(["can_state", "can_apply", "can_discriminate", "can_explain_why", "can_transfer"]);
  if (q.claim_rung != null && !CLAIM_RUNGS.has(q.claim_rung)) {
    return { reason: "invalid_claim_rung", detail: `claim_rung must be one of ${[...CLAIM_RUNGS].join(", ")}` };
  }
  const PROVENANCE_VALUES = new Set(["tutor_authored", "textbook_sourced"]);
  if (q.provenance != null && !PROVENANCE_VALUES.has(q.provenance)) {
    return { reason: "invalid_provenance", detail: `provenance must be one of ${[...PROVENANCE_VALUES].join(", ")}` };
  }

  const badNodeKeys = validateNodeKeys(q);
  if (badNodeKeys) return badNodeKeys;

  if (q.type === "mc") {
    if (!q.choices || q.choices.length < 2) {
      return { reason: "mc_without_choices", detail: "mc questions need 2 or more choices" };
    }
    const correctCount = q.choices.filter((c) => c.is_correct).length;
    if (correctCount === 0) {
      return { reason: "mc_without_correct", detail: "mc questions need exactly one correct choice" };
    }
    // The app's answer UI is single-select and grading resolves one
    // correct_choice_id, so a second correct choice would be silently
    // collapsed at grading time. Catch it at authoring time instead.
    if (correctCount > 1) {
      return {
        reason: "mc_multiple_correct",
        detail: `mc questions need exactly one correct choice, got ${correctCount}; multi-select is not supported — split into separate questions or rewrite as written`,
      };
    }
  }

  if (q.type === "written" && !q.model_answer) {
    return { reason: "written_without_model_answer", detail: "written questions require model_answer" };
  }

  if (q.graph_spec) {
    const result = parseSpec(q.graph_spec);
    if (result.errors.length > 0) {
      return {
        reason: "invalid_graph_spec",
        detail: `graph_spec failed to parse: ${result.errors.map((e: { message: string }) => e.message).join("; ")}`,
      };
    }
  }

  let documentText: string | null | undefined;
  let documentType: "url" | "text" | "file" | undefined;
  if (q.document_id) {
    let asset;
    try {
      asset = getAsset(db, q.document_id);
    } catch (err) {
      if (err instanceof DomainError && err.code === "not_found") {
        return { reason: "unknown_document", detail: `unknown document_id: ${q.document_id}` };
      }
      throw err;
    }
    documentText = asset.extracted_text;
    documentType = asset.type;
  }

  const hasAnchor =
    (q.document_anchor_start !== undefined && q.document_anchor_start !== null) ||
    (q.document_marker_offset !== undefined && q.document_marker_offset !== null);
  // url assets never have extracted_text (fetching arbitrary URLs server-side
  // is out of scope for SSRF reasons — see lib/extract/index.ts), so an
  // anchor/marker against one can't be bounds-checked at all. Reject outright
  // rather than silently accepting an unverifiable offset.
  if (hasAnchor && documentType === "url") {
    return {
      reason: "invalid_document_anchor",
      detail: "document_anchor_* and document_marker_offset require a document with extracted text; url assets have none",
    };
  }

  if (q.document_anchor_start !== undefined && q.document_anchor_start !== null) {
    if (q.document_anchor_end === undefined || q.document_anchor_end === null) {
      return { reason: "invalid_document_anchor", detail: "document_anchor_end is required when document_anchor_start is set" };
    }
    if (q.document_anchor_start < 0 || q.document_anchor_start > q.document_anchor_end) {
      return {
        reason: "invalid_document_anchor",
        detail: "document_anchor_start must be >= 0 and <= document_anchor_end",
      };
    }
    if (documentText != null && q.document_anchor_end > documentText.length) {
      return {
        reason: "invalid_document_anchor",
        detail: "document_anchor_end exceeds the referenced document's extracted text length",
      };
    }
  }

  if (q.document_marker_offset !== undefined && q.document_marker_offset !== null) {
    if (!q.document_id) {
      return {
        reason: "invalid_document_marker",
        detail: "document_marker_offset requires document_id to be set",
      };
    }
    if (documentText != null) {
      if (q.document_marker_offset < 0 || q.document_marker_offset > documentText.length) {
        return {
          reason: "invalid_document_marker",
          detail: "document_marker_offset must be within the referenced document's extracted text length",
        };
      }
      // findTokenSpan tolerates an offset on the space right after a word
      // (it snaps back to that word so the renderer can size a span), but an
      // author-set marker must point at the token itself: the readme promises
      // that, and a marker that "works" only via the snap is one character
      // away from being wrong.
      const markedChar = documentText[q.document_marker_offset];
      if (markedChar === undefined || /\s/.test(markedChar) || findTokenSpan(documentText, q.document_marker_offset) === null) {
        return {
          reason: "invalid_document_marker",
          detail: "document_marker_offset does not land on a token in the referenced document's text (it's in whitespace)",
        };
      }
    }
  }

  return null;
}

function insertQuestionRow(
  db: DatabaseSync,
  fields: {
    id: string;
    lineage_id: string;
    version: number;
    supersedes_id: string | null;
    type: string;
    prompt: string;
    explanation: string | null;
    model_answer: string | null;
    rubric: string | null;
    difficulty: number;
    calculator_policy: string;
    source_note: string | null;
    graph_spec: string | null;
    desmos_allowed: number;
    document_id: string | null;
    document_anchor_label: string | null;
    document_anchor_start: number | null;
    document_anchor_end: number | null;
    document_marker_offset: number | null;
    claim_rung: string | null;
    tests_error: string | null;
    provenance: string | null;
    node_key: string | null;
    ephemeral?: number;
    session_id?: string | null;
  }
): void {
  db.prepare(
    `INSERT INTO question
       (id, lineage_id, version, supersedes_id, type, prompt, explanation,
        model_answer, rubric, difficulty, calculator_policy, source_note,
        graph_spec, desmos_allowed, document_id, document_anchor_label,
        document_anchor_start, document_anchor_end, document_marker_offset,
        claim_rung, tests_error, provenance, node_key, ephemeral, session_id)
     VALUES
       (@id, @lineage_id, @version, @supersedes_id, @type, @prompt, @explanation,
        @model_answer, @rubric, @difficulty, @calculator_policy, @source_note,
        @graph_spec, @desmos_allowed, @document_id, @document_anchor_label,
        @document_anchor_start, @document_anchor_end, @document_marker_offset,
        @claim_rung, @tests_error, @provenance, @node_key, @ephemeral, @session_id)`
  ).run({ ephemeral: 0, session_id: null, ...fields });
}

function replaceTags(db: DatabaseSync, questionId: string, tags: string[]): void {
  db.prepare("DELETE FROM question_tag WHERE question_id = ?").run(questionId);
  const insert = db.prepare("INSERT INTO question_tag (question_id, tag_slug) VALUES (?, ?)");
  for (const slug of new Set(tags)) insert.run(questionId, slug);
}

// A misconception is optional — NULL means "nobody recorded which wrong model
// this distractor represents", which is different from "it represents none".
// Empty strings and the tutor's own placeholder for an unrecorded one both
// collapse to NULL so no read path mistakes a placeholder for real content.
const UNRECORDED_MISCONCEPTION = "distractor (imported; misconception not recorded)";

function normalizeMisconception(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === UNRECORDED_MISCONCEPTION) return null;
  return value ?? null;
}

function replaceChoices(db: DatabaseSync, questionId: string, choices: ChoiceInput[]): void {
  db.prepare("DELETE FROM choice WHERE question_id = ?").run(questionId);
  const insert = db.prepare(
    "INSERT INTO choice (id, question_id, body, is_correct, ordinal, misconception) VALUES (?, ?, ?, ?, ?, ?)"
  );
  choices.forEach((c, i) =>
    insert.run(uuidv4(), questionId, c.body, c.is_correct ? 1 : 0, i, normalizeMisconception(c.misconception))
  );
}

export interface CreateQuestionsResult {
  created: { id: string; lineage_id: string; prompt_preview: string }[];
  rejected: { index: number; reason: string; detail: string }[];
  warnings: { index: number; message: string }[];
  // Present (and true) only on a replay of a stored idempotency_key: nothing
  // was written this time, this is the first call's own result.
  replayed?: true;
  possible_duplicates: {
    new_index: number;
    existing_id: string;
    existing_prompt: string;
    similarity: number;
    shared_tags: string[];
  }[];
}

export interface CreateQuestionsOptions {
  // Batch-level, not per question: a batch written for one live moment is
  // ephemeral as a whole, and it belongs to the session that moment is in.
  ephemeral?: boolean;
  session_id?: string;
  // Replay protection for the one write that is expensive to repeat. The
  // stored result comes back verbatim with replayed: true.
  idempotency_key?: string;
}

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export function createQuestions(
  db: DatabaseSync,
  questions: QuestionInput[],
  options: CreateQuestionsOptions = {}
): CreateQuestionsResult {
  const key = options.idempotency_key;
  if (key !== undefined) {
    if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new DomainError(
        "invalid_idempotency_key",
        `idempotency_key must be 1..${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`
      );
    }
    const stored = db.prepare("SELECT result_json FROM create_questions_batch WHERE idempotency_key = ?").get(key) as
      | { result_json: string }
      | undefined;
    // Verbatim: the tutor sees exactly what the first call returned, plus the
    // flag telling it nothing new was written this time.
    if (stored) return { ...(JSON.parse(stored.result_json) as CreateQuestionsResult), replayed: true };
  }

  if (options.ephemeral && !options.session_id) {
    throw new DomainError(
      "ephemeral_requires_session",
      "ephemeral: true requires session_id — an ephemeral question is retired when its session ends, so it needs one."
    );
  }
  if (options.session_id) assertSessionOpen(db, options.session_id);

  const threshold = Number(
    JSON.parse(
      (db.prepare("SELECT value FROM config WHERE key = 'duplicate_similarity_threshold'").get() as {
        value: string;
      }).value
    )
  );

  const result: CreateQuestionsResult = { created: [], rejected: [], warnings: [], possible_duplicates: [] };

  questions.forEach((q, index) => {
    const invalid = validateQuestionInput(db, q);
    if (invalid) {
      result.rejected.push({ index, ...invalid });
      return;
    }

    // Non-blocking: readme()'s prompt_conventions documents "4 choices,
    // exactly one correct unless testing a multi-select concept" as an
    // authoring convention, not a schema constraint (mc_without_choices
    // above only requires >= 2). A deviation is still allowed to commit —
    // an author may have a real reason — but should get a signal instead of
    // total silence, the same way possible_duplicates flags without rejecting.
    if (q.type === "mc" && q.choices && q.choices.length !== 4) {
      result.warnings.push({
        index,
        message: `mc question has ${q.choices.length} choices; readme()'s convention is 4 choices, unless intentionally testing a multi-select concept`,
      });
    }

    const duplicates = findPossibleDuplicates(db, q.prompt, q.tags, threshold);
    for (const dup of duplicates) {
      result.possible_duplicates.push({ new_index: index, ...dup });
    }

    const id = uuidv4();
    const lineageId = uuidv4();

    db.exec("BEGIN");
    try {
      insertQuestionRow(db, {
        id,
        lineage_id: lineageId,
        version: 1,
        supersedes_id: null,
        type: q.type,
        prompt: q.prompt,
        explanation: q.explanation ?? null,
        model_answer: q.model_answer ?? null,
        rubric: q.rubric !== undefined ? JSON.stringify(q.rubric) : null,
        difficulty: q.difficulty ?? 3,
        calculator_policy: q.calculator_policy ?? "n_a",
        source_note: q.source_note ?? null,
        graph_spec: q.graph_spec ?? null,
        desmos_allowed: q.desmos_allowed ? 1 : 0,
        document_id: q.document_id ?? null,
        document_anchor_label: q.document_anchor_label ?? null,
        document_anchor_start: q.document_anchor_start ?? null,
        document_anchor_end: q.document_anchor_end ?? null,
        document_marker_offset: q.document_marker_offset ?? null,
        claim_rung: q.claim_rung ?? null,
        tests_error: q.tests_error ?? null,
        provenance: q.provenance ?? null,
        node_key: primaryNodeKey(q),
        ephemeral: options.ephemeral ? 1 : 0,
        session_id: options.session_id ?? null,
      });
      replaceTags(db, id, q.tags);
      replaceNodeKeys(db, id, resolveNodeKeys(q));
      if (q.type === "mc") replaceChoices(db, id, q.choices!);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    result.created.push({ id, lineage_id: lineageId, prompt_preview: q.prompt.slice(0, 120) });
  });

  if (key !== undefined) {
    db.prepare("INSERT INTO create_questions_batch (idempotency_key, result_json) VALUES (?, ?)").run(
      key,
      JSON.stringify(result)
    );
  }

  return result;
}

export interface EditQuestionChanges {
  prompt?: string;
  explanation?: string | null;
  tags?: string[];
  difficulty?: number;
  calculator_policy?: string;
  model_answer?: string | null;
  rubric?: unknown;
  choices?: ChoiceInput[];
  source_note?: string | null;
  graph_spec?: string | null;
  desmos_allowed?: boolean;
  document_id?: string | null;
  document_anchor_label?: string | null;
  document_anchor_start?: number | null;
  document_anchor_end?: number | null;
  document_marker_offset?: number | null;
  claim_rung?: "can_state" | "can_apply" | "can_discriminate" | "can_explain_why" | "can_transfer" | null;
  tests_error?: string | null;
  provenance?: "tutor_authored" | "textbook_sourced" | null;
  node_key?: string | null;
  node_keys?: string[] | null;
}

export interface EditQuestionResult {
  id: string;
  lineage_id: string;
  version: number;
  versioned: boolean;
  supersedes_id: string | null;
}

export function editQuestion(
  db: DatabaseSync,
  id: string,
  changes: EditQuestionChanges
): EditQuestionResult {
  const current = db.prepare("SELECT * FROM question WHERE id = ?").get(id) as QuestionRow | undefined;
  if (!current) throw new DomainError("not_found", `Question "${id}" does not exist.`);

  const currentTags = (
    db.prepare("SELECT tag_slug FROM question_tag WHERE question_id = ?").all(id) as { tag_slug: string }[]
  ).map((r) => r.tag_slug);
  const currentChoices =
    current.type === "mc"
      ? (db
          .prepare("SELECT body, is_correct, misconception FROM choice WHERE question_id = ? ORDER BY ordinal")
          .all(id) as { body: string; is_correct: number; misconception: string | null }[])
      : [];

  const merged: QuestionInput = {
    type: current.type,
    prompt: changes.prompt ?? current.prompt,
    tags: changes.tags ?? currentTags,
    difficulty: changes.difficulty ?? current.difficulty,
    calculator_policy: changes.calculator_policy ?? current.calculator_policy,
    explanation: changes.explanation !== undefined ? changes.explanation : current.explanation,
    source_note: changes.source_note !== undefined ? changes.source_note : current.source_note,
    choices:
      changes.choices ??
      currentChoices.map((c) => ({ body: c.body, is_correct: c.is_correct === 1, misconception: c.misconception })),
    model_answer: changes.model_answer !== undefined ? changes.model_answer : current.model_answer,
    rubric: changes.rubric !== undefined ? changes.rubric : current.rubric ? JSON.parse(current.rubric) : undefined,
    graph_spec: changes.graph_spec !== undefined ? changes.graph_spec : current.graph_spec,
    desmos_allowed: changes.desmos_allowed !== undefined ? changes.desmos_allowed : Boolean(current.desmos_allowed),
    document_id: changes.document_id !== undefined ? changes.document_id : current.document_id,
    document_anchor_label:
      changes.document_anchor_label !== undefined ? changes.document_anchor_label : current.document_anchor_label,
    document_anchor_start:
      changes.document_anchor_start !== undefined ? changes.document_anchor_start : current.document_anchor_start,
    document_anchor_end:
      changes.document_anchor_end !== undefined ? changes.document_anchor_end : current.document_anchor_end,
    document_marker_offset:
      changes.document_marker_offset !== undefined ? changes.document_marker_offset : current.document_marker_offset,
    claim_rung: changes.claim_rung !== undefined ? changes.claim_rung : (current.claim_rung as QuestionInput["claim_rung"]),
    tests_error: changes.tests_error !== undefined ? changes.tests_error : current.tests_error,
    provenance: changes.provenance !== undefined ? changes.provenance : (current.provenance as QuestionInput["provenance"]),
    node_key: changes.node_key !== undefined ? changes.node_key : current.node_key,
  };

  const invalid = validateQuestionInput(db, merged);
  if (invalid) throw new DomainError(invalid.reason, invalid.detail);

  // Only what the caller actually sent is held to the node-key grammar — an
  // item's already-stored keys (including anything 018 backfilled from the
  // old free-form column) must not make an unrelated edit unsavable.
  const badNodeKeys = validateNodeKeys({ node_key: changes.node_key, node_keys: changes.node_keys });
  if (badNodeKeys) throw new DomainError(badNodeKeys.reason, badNodeKeys.detail);

  // node_keys replaces the whole set; a singular node_key on its own replaces
  // it with that one key; neither given leaves the set as it is.
  const nextNodeKeys =
    changes.node_keys !== undefined
      ? resolveNodeKeys({ node_key: changes.node_key, node_keys: changes.node_keys })
      : changes.node_key !== undefined
        ? resolveNodeKeys({ node_key: changes.node_key })
        : getNodeKeys(db, id);
  const primary = nextNodeKeys[0] ?? null;

  const hasAttempts = db.prepare("SELECT 1 FROM response WHERE question_id = ? LIMIT 1").get(id);

  if (hasAttempts) {
    const newId = uuidv4();
    const newVersion = current.version + 1;

    db.exec("BEGIN");
    try {
      insertQuestionRow(db, {
        id: newId,
        lineage_id: current.lineage_id,
        version: newVersion,
        supersedes_id: current.id,
        type: current.type,
        prompt: merged.prompt,
        explanation: merged.explanation ?? null,
        model_answer: merged.model_answer ?? null,
        rubric: merged.rubric !== undefined ? JSON.stringify(merged.rubric) : null,
        difficulty: merged.difficulty!,
        calculator_policy: merged.calculator_policy!,
        source_note: merged.source_note ?? null,
        graph_spec: merged.graph_spec ?? null,
        desmos_allowed: merged.desmos_allowed ? 1 : 0,
        document_id: merged.document_id ?? null,
        document_anchor_label: merged.document_anchor_label ?? null,
        document_anchor_start: merged.document_anchor_start ?? null,
        document_anchor_end: merged.document_anchor_end ?? null,
        document_marker_offset: merged.document_marker_offset ?? null,
        claim_rung: merged.claim_rung ?? null,
        tests_error: merged.tests_error ?? null,
        provenance: merged.provenance ?? null,
        node_key: primary,
        ephemeral: current.ephemeral,
        session_id: current.session_id,
      });
      replaceTags(db, newId, merged.tags);
      replaceNodeKeys(db, newId, nextNodeKeys);
      if (current.type === "mc") replaceChoices(db, newId, merged.choices!);
      db.prepare(
        "UPDATE question SET retired_at = datetime('now'), retired_reason = ? WHERE id = ?"
      ).run(`superseded by version ${newVersion}`, current.id);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    return { id: newId, lineage_id: current.lineage_id, version: newVersion, versioned: true, supersedes_id: current.id };
  }

  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE question
       SET prompt = @prompt, explanation = @explanation, model_answer = @model_answer,
           rubric = @rubric, difficulty = @difficulty, calculator_policy = @calculator_policy,
           source_note = @source_note, graph_spec = @graph_spec, desmos_allowed = @desmos_allowed,
           document_id = @document_id, document_anchor_label = @document_anchor_label,
           document_anchor_start = @document_anchor_start, document_anchor_end = @document_anchor_end,
           document_marker_offset = @document_marker_offset,
           claim_rung = @claim_rung, tests_error = @tests_error, provenance = @provenance, node_key = @node_key,
           updated_at = datetime('now')
       WHERE id = @id`
    ).run({
      id,
      prompt: merged.prompt,
      explanation: merged.explanation ?? null,
      model_answer: merged.model_answer ?? null,
      rubric: merged.rubric !== undefined ? JSON.stringify(merged.rubric) : null,
      difficulty: merged.difficulty!,
      calculator_policy: merged.calculator_policy!,
      source_note: merged.source_note ?? null,
      graph_spec: merged.graph_spec ?? null,
      desmos_allowed: merged.desmos_allowed ? 1 : 0,
      document_id: merged.document_id ?? null,
      document_anchor_label: merged.document_anchor_label ?? null,
      document_anchor_start: merged.document_anchor_start ?? null,
      document_anchor_end: merged.document_anchor_end ?? null,
      document_marker_offset: merged.document_marker_offset ?? null,
      claim_rung: merged.claim_rung ?? null,
      tests_error: merged.tests_error ?? null,
      provenance: merged.provenance ?? null,
      node_key: primary,
    });
    if (changes.tags) replaceTags(db, id, changes.tags);
    replaceNodeKeys(db, id, nextNodeKeys);
    if (changes.choices && current.type === "mc") replaceChoices(db, id, changes.choices);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { id: current.id, lineage_id: current.lineage_id, version: current.version, versioned: false, supersedes_id: null };
}

export function retireQuestion(db: DatabaseSync, id: string, reason: string): { id: string; retired_at: string } {
  const current = db.prepare("SELECT retired_at FROM question WHERE id = ?").get(id) as
    | { retired_at: string | null }
    | undefined;
  if (!current) throw new DomainError("not_found", `Question "${id}" does not exist.`);
  if (current.retired_at) throw new DomainError("already_retired", `Question "${id}" is already retired.`);

  db.prepare("UPDATE question SET retired_at = datetime('now'), retired_reason = ? WHERE id = ?").run(
    reason,
    id
  );

  const row = db.prepare("SELECT retired_at FROM question WHERE id = ?").get(id) as { retired_at: string };
  return { id, retired_at: row.retired_at };
}

export interface QuestionSummary {
  id: string;
  lineage_id: string;
  version: number;
  type: QuestionType;
  prompt: string;
  difficulty: number;
  calculator_policy: CalculatorPolicy;
  source_note: string | null;
  created_by: "claude" | "human";
  created_at: string;
  retired_at: string | null;
  tags: string[];
  has_graph: boolean;
  desmos_allowed: boolean;
  has_document: boolean;
  claim_rung: string | null;
  tests_error: string | null;
  provenance: string | null;
  node_key: string | null;
  node_keys: string[];
  ephemeral: boolean;
  session_id: string | null;
}

export interface SearchQuestionsParams {
  tag_query?: TagQuery;
  text?: string;
  type?: "mc" | "written";
  difficulty_min?: number;
  difficulty_max?: number;
  calculator_policy?: CalculatorPolicy;
  include_retired?: boolean;
  latest_version_only?: boolean;
  // Exact match, or a prefix match when the value ends with ":" —
  // "node:ebbing11e:2.4:" matches every key under that section.
  node_key?: string;
  session_id?: string;
  // Ephemeral items are written for one live moment and stay out of every
  // listing unless asked for by name.
  include_ephemeral?: boolean;
  limit?: number;
  offset?: number;
}

export function searchQuestions(
  db: DatabaseSync,
  params: SearchQuestionsParams
): { total: number; questions: QuestionSummary[] } {
  const clauses: string[] = [];
  const args: unknown[] = [];
  let joinFts = "";

  if (!params.include_retired) clauses.push("q.retired_at IS NULL");
  if (!params.include_ephemeral) clauses.push("q.ephemeral = 0");
  if (params.session_id) {
    clauses.push("q.session_id = ?");
    args.push(params.session_id);
  }
  if (params.node_key) {
    const filter = nodeKeyFilterClause(params.node_key);
    clauses.push(filter.sql);
    args.push(...filter.params);
  }
  if (params.latest_version_only ?? true) {
    clauses.push(
      "NOT EXISTS (SELECT 1 FROM question q2 WHERE q2.lineage_id = q.lineage_id AND q2.version > q.version)"
    );
  }
  if (params.type) {
    clauses.push("q.type = ?");
    args.push(params.type);
  }
  if (params.difficulty_min !== undefined) {
    clauses.push("q.difficulty >= ?");
    args.push(params.difficulty_min);
  }
  if (params.difficulty_max !== undefined) {
    clauses.push("q.difficulty <= ?");
    args.push(params.difficulty_max);
  }
  if (params.calculator_policy) {
    clauses.push("q.calculator_policy = ?");
    args.push(params.calculator_policy);
  }
  if (params.text) {
    const ftsQuery = ftsQueryFor(params.text);
    if (ftsQuery) {
      joinFts = "JOIN question_fts f ON f.rowid = q.rowid";
      clauses.push("question_fts MATCH ?");
      args.push(ftsQuery);
    }
  }

  const tagClause = params.tag_query ? buildTagQueryClause(params.tag_query) : { sql: "", params: [] };

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const fullWhere = `${where} ${tagClause.sql}`.trim();

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM question q ${joinFts} ${fullWhere}`)
      .get(...(([...args, ...tagClause.params]) as any[])) as { n: number }
  ).n;

  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  const rows = db
    .prepare(
      `SELECT q.id, q.lineage_id, q.version, q.type, q.prompt, q.difficulty, q.calculator_policy,
              q.source_note, q.created_by, q.created_at, q.retired_at,
              (q.graph_spec IS NOT NULL) AS has_graph,
              q.desmos_allowed AS desmos_allowed,
              (q.document_id IS NOT NULL) AS has_document,
              q.claim_rung, q.tests_error, q.provenance, q.node_key, q.ephemeral, q.session_id
       FROM question q ${joinFts}
       ${fullWhere}
       ORDER BY q.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...(([...args, ...tagClause.params, limit, offset]) as any[])) as unknown as (Omit<
    QuestionSummary,
    "tags" | "has_graph" | "desmos_allowed" | "has_document" | "node_keys" | "ephemeral"
  > & { has_graph: number; desmos_allowed: number; has_document: number; ephemeral: number })[];

  const tagsByQuestion = db.prepare("SELECT tag_slug FROM question_tag WHERE question_id = ?");
  const questions = rows.map((r) => ({
    ...r,
    has_graph: Boolean(r.has_graph),
    desmos_allowed: Boolean(r.desmos_allowed),
    has_document: Boolean(r.has_document),
    ephemeral: r.ephemeral === 1,
    tags: (tagsByQuestion.all(r.id) as { tag_slug: string }[]).map((t) => t.tag_slug),
    ...nodeKeyFields(db, r.id),
  }));

  return { total, questions };
}

export interface QuestionDetail extends Omit<QuestionRow, "desmos_allowed" | "ephemeral"> {
  desmos_allowed: boolean;
  ephemeral: boolean;
  node_keys: string[];
  tags: string[];
  choices: { id: string; body: string; is_correct: boolean; ordinal: number; misconception: string | null }[];
}

export function getQuestionDetail(db: DatabaseSync, id: string): QuestionDetail {
  const question = db.prepare("SELECT * FROM question WHERE id = ?").get(id) as QuestionRow | undefined;
  if (!question) throw new DomainError("not_found", `Question "${id}" does not exist.`);

  const tags = (
    db.prepare("SELECT tag_slug FROM question_tag WHERE question_id = ?").all(id) as { tag_slug: string }[]
  ).map((r) => r.tag_slug);

  const choices = (
    db
      .prepare("SELECT id, body, is_correct, ordinal, misconception FROM choice WHERE question_id = ? ORDER BY ordinal")
      .all(id) as { id: string; body: string; is_correct: number; ordinal: number; misconception: string | null }[]
  ).map((c) => ({ ...c, is_correct: c.is_correct === 1 }));

  return {
    ...question,
    desmos_allowed: Boolean(question.desmos_allowed),
    ephemeral: question.ephemeral === 1,
    ...nodeKeyFields(db, id),
    tags,
    choices,
  };
}

export interface DocumentMarkerSummary {
  id: string;
  document_marker_offset: number;
}

// Lightweight sibling list for the document viewer: every non-retired,
// latest-version question that has a marker inside the given document, so
// all of them can render as clickable inline markers at once — not just the
// one question currently being viewed.
export function getDocumentMarkers(db: DatabaseSync, documentId: string): DocumentMarkerSummary[] {
  return db
    .prepare(
      `SELECT id, document_marker_offset
       FROM question
       WHERE document_id = ?
         AND document_marker_offset IS NOT NULL
         AND retired_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM question q2 WHERE q2.lineage_id = question.lineage_id AND q2.version > question.version)`
    )
    .all(documentId) as unknown as DocumentMarkerSummary[];
}
