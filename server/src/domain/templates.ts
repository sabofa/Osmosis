import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "./errors.js";
import { countEligible, resolveDrawFromParams, type EligibilityParams } from "./draw.js";
import type { TagQuery } from "./tagQuery.js";
import { addSlice, removeSlice } from "./sync.js";

// The deduplicated union of every tag literal a tag_query references —
// `all`, `any`, and `none` alike — since a Library download needs the
// content behind each one locally, regardless of which clause it's used in.
export function referencedTagLiterals(query: TagQuery): string[] {
  return [...new Set([...(query.all ?? []), ...(query.any ?? []), ...(query.none ?? [])])];
}

const CALCULATOR_POLICIES = new Set(["allowed", "forbidden", "any"]);
const WEIGHTINGS = new Set(["random", "weak_weighted"]);

export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  tag_query: string; // JSON in the DB
  question_count: number;
  mc_ratio: number | null;
  difficulty_min: number | null;
  difficulty_max: number | null;
  calculator_policy: "allowed" | "forbidden" | "any";
  weighting: "random" | "weak_weighted" | null;
  frozen: 0 | 1;
  time_limit_sec: number | null;
  session_id: string | null;
  created_at: string;
  updated_at: string;
  retired_at: string | null;
}

export interface TemplateInput {
  name: string;
  tag_query: TagQuery;
  question_count: number;
  description?: string | null;
  mc_ratio?: number | null;
  difficulty_min?: number | null;
  difficulty_max?: number | null;
  calculator_policy?: string;
  weighting?: string | null;
  frozen?: boolean;
  time_limit_sec?: number | null;
  // Optional: a template with session_id IS NULL is an ordinary bank template
  // (homework, the general list). A session-scoped one shows up under its
  // session in the app instead. See migration 010.
  session_id?: string | null;
}

function validateTemplateFields(input: {
  question_count?: number;
  mc_ratio?: number | null;
  difficulty_min?: number | null;
  difficulty_max?: number | null;
  calculator_policy?: string;
  weighting?: string | null;
}): void {
  if (input.question_count !== undefined && (!Number.isInteger(input.question_count) || input.question_count <= 0)) {
    throw new DomainError("invalid_question_count", "question_count must be a positive integer.");
  }
  if (input.mc_ratio !== undefined && input.mc_ratio !== null && (input.mc_ratio < 0 || input.mc_ratio > 1)) {
    throw new DomainError("invalid_mc_ratio", "mc_ratio must be between 0 and 1.");
  }
  if (
    input.difficulty_min !== undefined &&
    input.difficulty_min !== null &&
    (!Number.isInteger(input.difficulty_min) || input.difficulty_min < 1 || input.difficulty_min > 5)
  ) {
    throw new DomainError("invalid_difficulty", "difficulty_min must be an integer between 1 and 5.");
  }
  if (
    input.difficulty_max !== undefined &&
    input.difficulty_max !== null &&
    (!Number.isInteger(input.difficulty_max) || input.difficulty_max < 1 || input.difficulty_max > 5)
  ) {
    throw new DomainError("invalid_difficulty", "difficulty_max must be an integer between 1 and 5.");
  }
  if (
    input.difficulty_min !== undefined &&
    input.difficulty_min !== null &&
    input.difficulty_max !== undefined &&
    input.difficulty_max !== null &&
    input.difficulty_min > input.difficulty_max
  ) {
    throw new DomainError("invalid_difficulty_range", "difficulty_min must be <= difficulty_max.");
  }
  if (input.calculator_policy !== undefined && !CALCULATOR_POLICIES.has(input.calculator_policy)) {
    throw new DomainError(
      "invalid_calculator_policy",
      `calculator_policy must be one of ${[...CALCULATOR_POLICIES].join(", ")}.`
    );
  }
  if (input.weighting !== undefined && input.weighting !== null && !WEIGHTINGS.has(input.weighting)) {
    throw new DomainError("invalid_weighting", `weighting must be one of ${[...WEIGHTINGS].join(", ")}.`);
  }
}

function eligibilityParamsFor(row: {
  tag_query: TagQuery;
  difficulty_min?: number | null;
  difficulty_max?: number | null;
  calculator_policy?: string;
}): EligibilityParams {
  return {
    tag_query: row.tag_query,
    difficulty_min: row.difficulty_min ?? null,
    difficulty_max: row.difficulty_max ?? null,
    calculator_policy: (row.calculator_policy as EligibilityParams["calculator_policy"]) ?? "any",
  };
}

// Rough estimate only — nothing in the schema tracks real byte size for a
// template's slice, and there's no actual pull mechanism computing one.
// Good enough to show a plausible number on the Library cards.
const ESTIMATED_BYTES_PER_QUESTION = 1400;

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  tag_query: TagQuery;
  question_count: number;
  mc_ratio: number | null;
  difficulty_min: number | null;
  difficulty_max: number | null;
  calculator_policy: string;
  weighting: string | null;
  frozen: boolean;
  time_limit_sec: number | null;
  session_id: string | null;
  eligible_count: number;
  attempt_count: number;
  mean_score: number | null;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
  downloaded: boolean;
  downloaded_at: string | null;
  update_available: boolean;
  estimated_bytes: number;
}

// A template is "downloaded" on this node when every tag literal its
// tag_query references is a held slice. Local draws are only meaningful then;
// otherwise the template is a cloud test (see sync/client.ts
// fetchAndApplyTemplateDraw). Canonical holds the whole bank and never asks.
export function isTemplateDownloaded(db: DatabaseSync, templateId: string): boolean {
  const row = db.prepare("SELECT tag_query FROM template WHERE id = ?").get(templateId) as { tag_query: string } | undefined;
  if (!row) throw new DomainError("not_found", `Template "${templateId}" does not exist.`);
  const literals = referencedTagLiterals(JSON.parse(row.tag_query) as TagQuery);
  if (literals.length === 0) return false;
  const held = (
    db.prepare(`SELECT COUNT(*) AS n FROM local_slice WHERE tag_slug IN (${literals.map(() => "?").join(",")})`).get(...literals) as { n: number }
  ).n;
  return held === literals.length;
}

function toSummary(db: DatabaseSync, row: TemplateRow): TemplateSummary {
  const tagQuery = JSON.parse(row.tag_query) as TagQuery;
  const eligibleCount = countEligible(db, eligibilityParamsFor({ ...row, tag_query: tagQuery }));

  const stats = db
    .prepare(
      `SELECT COUNT(*) AS attempt_count, AVG(m.attempt_mean) AS mean_score
       FROM (
         SELECT a.id, AVG(rs.score) AS attempt_mean
         FROM attempt a
         LEFT JOIN response_score rs ON rs.attempt_id = a.id
         WHERE a.template_id = ? AND a.submitted_at IS NOT NULL AND a.abandoned_at IS NULL
         GROUP BY a.id
       ) m`
    )
    .get(row.id) as { attempt_count: number; mean_score: number | null };

  const literals = referencedTagLiterals(tagQuery);
  const sliceRows =
    literals.length > 0
      ? (db
          .prepare(
            `SELECT tag_slug, pulled_at FROM local_slice WHERE tag_slug IN (${literals.map(() => "?").join(",")})`
          )
          .all(...literals) as { tag_slug: string; pulled_at: string }[])
      : [];
  const downloaded = literals.length > 0 && sliceRows.length === literals.length;
  const downloadedAt = downloaded ? sliceRows.reduce((min, r) => (r.pulled_at < min ? r.pulled_at : min), sliceRows[0].pulled_at) : null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tag_query: tagQuery,
    question_count: row.question_count,
    mc_ratio: row.mc_ratio,
    difficulty_min: row.difficulty_min,
    difficulty_max: row.difficulty_max,
    calculator_policy: row.calculator_policy,
    weighting: row.weighting,
    frozen: row.frozen === 1,
    time_limit_sec: row.time_limit_sec,
    session_id: row.session_id,
    eligible_count: eligibleCount,
    attempt_count: stats.attempt_count,
    mean_score: stats.mean_score,
    retired_at: row.retired_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    downloaded,
    downloaded_at: downloadedAt,
    update_available: downloaded && downloadedAt! < row.updated_at,
    estimated_bytes: row.question_count * ESTIMATED_BYTES_PER_QUESTION,
  };
}

export function listTemplates(
  db: DatabaseSync,
  opts: { includeRetired?: boolean; limit?: number; offset?: number } = {}
): TemplateSummary[] {
  const where = opts.includeRetired ? "" : "WHERE retired_at IS NULL";
  const rows =
    opts.limit === undefined
      ? (db.prepare(`SELECT * FROM template ${where} ORDER BY created_at DESC`).all() as unknown as TemplateRow[])
      : (db
          .prepare(`SELECT * FROM template ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
          .all(opts.limit, opts.offset ?? 0) as unknown as TemplateRow[]);
  return rows.map((r) => toSummary(db, r));
}

export function countTemplates(db: DatabaseSync, opts: { includeRetired?: boolean } = {}): number {
  const where = opts.includeRetired ? "" : "WHERE retired_at IS NULL";
  const row = db.prepare(`SELECT COUNT(*) AS n FROM template ${where}`).get() as { n: number };
  return row.n;
}

export function getTemplateDetail(db: DatabaseSync, id: string): TemplateSummary {
  const row = db.prepare("SELECT * FROM template WHERE id = ?").get(id) as TemplateRow | undefined;
  if (!row) throw new DomainError("not_found", `Template "${id}" does not exist.`);
  return toSummary(db, row);
}

export interface TemplateQuestionPreview {
  id: string;
  type: "mc" | "written";
  prompt: string;
  difficulty: number;
  created_at: string;
}

// Frozen templates have a fixed set — show it as-is. A non-frozen template
// re-draws at attempt time (random or weak_weighted), so there's no single
// "the" question set to show; this resolves one live preview draw using the
// same logic an actual attempt would use, purely for display. created_at is
// included so the frontend can flag questions added to the bank since the
// template was last downloaded.
export function getTemplateQuestions(db: DatabaseSync, id: string): TemplateQuestionPreview[] {
  const row = db.prepare("SELECT * FROM template WHERE id = ?").get(id) as TemplateRow | undefined;
  if (!row) throw new DomainError("not_found", `Template "${id}" does not exist.`);

  if (row.frozen === 1) {
    return db
      .prepare(
        `SELECT q.id, q.type, q.prompt, q.difficulty, q.created_at
         FROM template_frozen_question tfq
         JOIN question q ON q.id = tfq.question_id
         WHERE tfq.template_id = ?
         ORDER BY tfq.ordinal`
      )
      .all(id) as unknown as TemplateQuestionPreview[];
  }

  const tagQuery = JSON.parse(row.tag_query) as TagQuery;
  const draw = resolveDrawFromParams(db, {
    tag_query: tagQuery,
    question_count: row.question_count,
    mc_ratio: row.mc_ratio,
    difficulty_min: row.difficulty_min,
    difficulty_max: row.difficulty_max,
    calculator_policy: row.calculator_policy as EligibilityParams["calculator_policy"],
    weighting: row.weighting as "random" | "weak_weighted" | null,
  });
  if (draw.questions.length === 0) return [];

  const placeholders = draw.questions.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT id, type, prompt, difficulty, created_at FROM question WHERE id IN (${placeholders})`)
    .all(...draw.questions.map((q) => q.id)) as unknown as TemplateQuestionPreview[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return draw.questions.map((q) => byId.get(q.id)).filter((r): r is TemplateQuestionPreview => !!r);
}

export function createTemplate(
  db: DatabaseSync,
  input: TemplateInput
): { id: string; eligible_count: number; short: boolean } {
  validateTemplateFields(input);

  const calculatorPolicy = input.calculator_policy ?? "any";
  const weighting = input.weighting ?? null;
  const eligibleCount = countEligible(
    db,
    eligibilityParamsFor({
      tag_query: input.tag_query,
      difficulty_min: input.difficulty_min,
      difficulty_max: input.difficulty_max,
      calculator_policy: calculatorPolicy,
    })
  );

  if (input.session_id) {
    const session = db.prepare("SELECT id FROM tutor_session WHERE id = ?").get(input.session_id);
    if (!session) throw new DomainError("not_found", `Session "${input.session_id}" does not exist.`);
  }

  const id = uuidv4();
  const frozen = input.frozen ?? false;

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO template
         (id, name, description, tag_query, question_count, mc_ratio,
          difficulty_min, difficulty_max, calculator_policy, weighting, frozen, time_limit_sec, session_id)
       VALUES
         (@id, @name, @description, @tag_query, @question_count, @mc_ratio,
          @difficulty_min, @difficulty_max, @calculator_policy, @weighting, @frozen, @time_limit_sec, @session_id)`
    ).run({
      id,
      name: input.name,
      description: input.description ?? null,
      tag_query: JSON.stringify(input.tag_query ?? {}),
      question_count: input.question_count,
      mc_ratio: input.mc_ratio ?? null,
      difficulty_min: input.difficulty_min ?? null,
      difficulty_max: input.difficulty_max ?? null,
      calculator_policy: calculatorPolicy,
      weighting,
      frozen: frozen ? 1 : 0,
      time_limit_sec: input.time_limit_sec ?? null,
      session_id: input.session_id ?? null,
    });

    if (frozen) {
      freezeDraw(db, id, {
        tag_query: input.tag_query,
        question_count: input.question_count,
        mc_ratio: input.mc_ratio ?? null,
        difficulty_min: input.difficulty_min ?? null,
        difficulty_max: input.difficulty_max ?? null,
        calculator_policy: calculatorPolicy as EligibilityParams["calculator_policy"],
        weighting: weighting as "random" | "weak_weighted" | null,
      });
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { id, eligible_count: eligibleCount, short: eligibleCount < input.question_count };
}

function freezeDraw(
  db: DatabaseSync,
  templateId: string,
  params: {
    tag_query: TagQuery;
    question_count: number;
    mc_ratio: number | null;
    difficulty_min: number | null;
    difficulty_max: number | null;
    calculator_policy: EligibilityParams["calculator_policy"];
    weighting: "random" | "weak_weighted" | null;
  }
): void {
  db.prepare("DELETE FROM template_frozen_question WHERE template_id = ?").run(templateId);

  const draw = resolveDrawFromParams(db, params);
  const insert = db.prepare(
    "INSERT INTO template_frozen_question (template_id, question_id, ordinal) VALUES (?, ?, ?)"
  );
  draw.questions.forEach((q, i) => insert.run(templateId, q.id, i));
}

export interface EditTemplateChanges {
  name?: string;
  description?: string | null;
  tag_query?: TagQuery;
  question_count?: number;
  mc_ratio?: number | null;
  difficulty_min?: number | null;
  difficulty_max?: number | null;
  calculator_policy?: string;
  weighting?: string | null;
  frozen?: boolean;
  time_limit_sec?: number | null;
  confirm_refreeze?: boolean;
}

export function editTemplate(
  db: DatabaseSync,
  id: string,
  changes: EditTemplateChanges
): { id: string; eligible_count: number; short: boolean } {
  const current = db.prepare("SELECT * FROM template WHERE id = ?").get(id) as TemplateRow | undefined;
  if (!current) throw new DomainError("not_found", `Template "${id}" does not exist.`);

  validateTemplateFields(changes);

  const merged = {
    name: changes.name ?? current.name,
    description: changes.description !== undefined ? changes.description : current.description,
    tag_query: changes.tag_query ?? (JSON.parse(current.tag_query) as TagQuery),
    question_count: changes.question_count ?? current.question_count,
    mc_ratio: changes.mc_ratio !== undefined ? changes.mc_ratio : current.mc_ratio,
    difficulty_min: changes.difficulty_min !== undefined ? changes.difficulty_min : current.difficulty_min,
    difficulty_max: changes.difficulty_max !== undefined ? changes.difficulty_max : current.difficulty_max,
    calculator_policy: changes.calculator_policy ?? current.calculator_policy,
    weighting: changes.weighting !== undefined ? changes.weighting : current.weighting,
    frozen: changes.frozen ?? current.frozen === 1,
    time_limit_sec: changes.time_limit_sec !== undefined ? changes.time_limit_sec : current.time_limit_sec,
  };

  validateTemplateFields(merged);

  const wasFrozen = current.frozen === 1;
  const setBecomesFrozen = merged.frozen;
  const drawAffectingChange = changes.tag_query !== undefined || changes.question_count !== undefined;

  // Re-resolving is required whenever the frozen set could now be stale: an
  // already-frozen template whose draw params changed, or a template newly
  // becoming frozen. Only the former needs confirm_refreeze, since it's the
  // only case that can invalidate comparability with prior attempts.
  const needsRefreeze = setBecomesFrozen && (wasFrozen ? drawAffectingChange : true);
  if (wasFrozen && drawAffectingChange && !changes.confirm_refreeze) {
    throw new DomainError(
      "confirm_refreeze_required",
      "Editing a frozen template's tag_query or question_count re-resolves the frozen set and invalidates " +
        "comparability with prior attempts. Pass confirm_refreeze: true to proceed."
    );
  }

  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE template
       SET name = @name, description = @description, tag_query = @tag_query, question_count = @question_count,
           mc_ratio = @mc_ratio, difficulty_min = @difficulty_min, difficulty_max = @difficulty_max,
           calculator_policy = @calculator_policy, weighting = @weighting, frozen = @frozen,
           time_limit_sec = @time_limit_sec, updated_at = datetime('now')
       WHERE id = @id`
    ).run({
      id,
      name: merged.name,
      description: merged.description,
      tag_query: JSON.stringify(merged.tag_query),
      question_count: merged.question_count,
      mc_ratio: merged.mc_ratio,
      difficulty_min: merged.difficulty_min,
      difficulty_max: merged.difficulty_max,
      calculator_policy: merged.calculator_policy,
      weighting: merged.weighting,
      frozen: merged.frozen ? 1 : 0,
      time_limit_sec: merged.time_limit_sec,
    });

    if (needsRefreeze) {
      freezeDraw(db, id, {
        tag_query: merged.tag_query,
        question_count: merged.question_count,
        mc_ratio: merged.mc_ratio,
        difficulty_min: merged.difficulty_min,
        difficulty_max: merged.difficulty_max,
        calculator_policy: merged.calculator_policy as EligibilityParams["calculator_policy"],
        weighting: merged.weighting as "random" | "weak_weighted" | null,
      });
    } else if (wasFrozen && !merged.frozen) {
      db.prepare("DELETE FROM template_frozen_question WHERE template_id = ?").run(id);
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const eligibleCount = countEligible(
    db,
    eligibilityParamsFor({
      tag_query: merged.tag_query,
      difficulty_min: merged.difficulty_min,
      difficulty_max: merged.difficulty_max,
      calculator_policy: merged.calculator_policy,
    })
  );

  return { id, eligible_count: eligibleCount, short: eligibleCount < merged.question_count };
}

export function downloadTemplate(db: DatabaseSync, id: string): { id: string; downloaded_at: string } {
  const row = db.prepare("SELECT tag_query FROM template WHERE id = ?").get(id) as
    | { tag_query: string }
    | undefined;
  if (!row) throw new DomainError("not_found", `Template "${id}" does not exist.`);

  const literals = referencedTagLiterals(JSON.parse(row.tag_query) as TagQuery);
  if (literals.length === 0) {
    throw new DomainError(
      "no_slices_to_download",
      `Template "${id}" has no tags to download — nothing to sync.`
    );
  }
  for (const tag of literals) addSlice(db, tag);

  const sliceRows =
    literals.length > 0
      ? (db
          .prepare(
            `SELECT pulled_at FROM local_slice WHERE tag_slug IN (${literals.map(() => "?").join(",")})`
          )
          .all(...literals) as { pulled_at: string }[])
      : [];
  const downloadedAt = sliceRows.reduce(
    (min, r) => (min === null || r.pulled_at < min ? r.pulled_at : min),
    null as string | null
  );

  return { id, downloaded_at: downloadedAt as string };
}

export function deleteLocalTemplate(db: DatabaseSync, id: string): { id: string } {
  const row = db.prepare("SELECT tag_query FROM template WHERE id = ?").get(id) as
    | { tag_query: string }
    | undefined;
  if (!row) throw new DomainError("not_found", `Template "${id}" does not exist.`);

  const literals = referencedTagLiterals(JSON.parse(row.tag_query) as TagQuery);
  const presentSlices =
    literals.length > 0
      ? (db
          .prepare(
            `SELECT tag_slug FROM local_slice WHERE tag_slug IN (${literals.map(() => "?").join(",")})`
          )
          .all(...literals) as { tag_slug: string }[])
      : [];

  // Partial-download states are now possible (a template can reference
  // several tags, each downloaded/removed independently). Throw only if
  // NONE of the referenced slices exist locally — "delete what's there" is
  // the more useful behavior for a partial state than an all-or-nothing
  // error.
  if (presentSlices.length === 0) {
    throw new DomainError("not_found", `Template "${id}" is not downloaded.`);
  }

  // A literal still needed by another currently-downloaded template must not
  // have its slice removed — that would silently gut the other template.
  const otherTemplates = db
    .prepare("SELECT * FROM template WHERE id != ? AND retired_at IS NULL")
    .all(id) as unknown as TemplateRow[];
  const stillNeeded = new Set<string>();
  for (const other of otherTemplates) {
    const summary = toSummary(db, other);
    if (!summary.downloaded) continue;
    for (const tag of referencedTagLiterals(summary.tag_query)) stillNeeded.add(tag);
  }

  for (const tag of literals) {
    if (stillNeeded.has(tag)) continue;
    removeSlice(db, tag);
  }
  return { id };
}

export function retireTemplate(db: DatabaseSync, id: string): { id: string; retired_at: string } {
  const current = db.prepare("SELECT retired_at FROM template WHERE id = ?").get(id) as
    | { retired_at: string | null }
    | undefined;
  if (!current) throw new DomainError("not_found", `Template "${id}" does not exist.`);
  if (current.retired_at) throw new DomainError("already_retired", `Template "${id}" is already retired.`);

  db.prepare("UPDATE template SET retired_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(
    id
  );

  const row = db.prepare("SELECT retired_at FROM template WHERE id = ?").get(id) as { retired_at: string };
  return { id, retired_at: row.retired_at };
}
