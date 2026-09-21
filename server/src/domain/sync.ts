import type { DatabaseSync } from "node:sqlite";
import { resolveTemplateDraw } from "./draw.js";
import { PROTOCOL_VERSION } from "../protocol.js";
import { listThemesForSync, getActiveThemeId, applyThemesFromPull, type ThemeRow } from "./themes.js";

// ----------------------------------------------------------------------------
// Pull protocol: bank content (tags/questions/templates/grades) flows down
// from the canonical node to a local node holding a tag-based slice of it.
// ----------------------------------------------------------------------------

// The template columns that actually travel between nodes. session_id is
// deliberately absent: tutor_session is a node-local grouping (it is never
// synced), so a template that crossed the wire carrying one would land as a
// dangling FK on the other side. Same allowlist discipline as
// ATTEMPT_COLUMNS on the push side.
const TEMPLATE_SYNC_COLUMNS = [
  "id",
  "name",
  "description",
  "tag_query",
  "question_count",
  "mc_ratio",
  "difficulty_min",
  "difficulty_max",
  "calculator_policy",
  "weighting",
  "frozen",
  "time_limit_sec",
  "created_at",
  "updated_at",
  "retired_at",
] as const;

export interface PullRequest {
  node_id: string;
  protocol_version: number;
  slices: string[]; // tag slugs; descendants expand server-side
  since: string | null; // null = full pull of those slices
  include_grades_for_node: boolean;
}

export interface PullResponse {
  protocol_version: number;
  server_time: string;
  tags: {
    slug: string;
    label: string;
    parent_slug: string | null;
    description: string | null;
    retired_at: string | null;
  }[];
  questions: Record<string, unknown>[]; // full question row shape incl. graph/desmos/document_* + tags[] + choices[]
  templates: Record<string, unknown>[];
  grades: {
    id: string;
    response_id: string;
    grader: string;
    score: number;
    feedback: string | null;
    model_name: string | null;
    graded_at: string;
    superseded_at: string | null;
  }[];
  frozen_questions: { template_id: string; question_id: string; ordinal: number }[];
  // User preferences that follow the user across nodes (migration 016). The
  // full set every pull — it's tiny — tombstones included. Optional so a
  // response from an older canonical still applies.
  themes?: ThemeRow[];
  active_theme_id?: string | null;
  cursor: string;
}

// Sentinel pulled_at meaning "slice recorded, never successfully pulled".
// addSlice stamps it on first insert; a real pull replaces it with the pull's
// cursor (see applyPullResponse). runSync scans for it to issue a full
// backfill pull for slices added while offline.
export const NEVER_PULLED = "1970-01-01 00:00:00";

export interface ApplyPullResult {
  tags_applied: number;
  questions_applied: number;
  templates_applied: number;
  grades_applied: number;
  cursor: string;
}

// Same prefix-match idiom as tags.ts's listTags(prefix) and tagQuery.ts's
// matchGroupSql: "math" matches "math" and "math:*" via a plain LIKE, since
// slug format guarantees ":" only ever separates hierarchy levels.
function sliceMatchClause(column: string, slices: string[]): { sql: string; params: string[] } {
  const params: string[] = [];
  const ors = slices.map((slug) => {
    params.push(slug, `${slug}:%`);
    return `(${column} = ? OR ${column} LIKE ?)`;
  });
  return { sql: `(${ors.join(" OR ")})`, params };
}

interface QuestionRow {
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
  created_by: string;
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
  updated_at: string | null;
}

export const QUESTION_COLUMNS = [
  "id",
  "lineage_id",
  "version",
  "supersedes_id",
  "type",
  "prompt",
  "explanation",
  "model_answer",
  "rubric",
  "difficulty",
  "calculator_policy",
  "source_note",
  "created_by",
  "created_at",
  "retired_at",
  "retired_reason",
  "graph_spec",
  "desmos_allowed",
  "document_id",
  "document_anchor_label",
  "document_anchor_start",
  "document_anchor_end",
  "document_marker_offset",
  "claim_rung",
  "tests_error",
  "provenance",
  "node_key",
  "updated_at",
] as const;

// ----------------------------------------------------------------------------
// buildQuestionPayloads: given an explicit list of question IDs (not a tag
// slice), select those exact rows in the same QUESTION_COLUMNS shape and
// attach tags/choices the same way buildPullResponse's per-question loop
// does. Used directly by daily-draw sync, where the question set is fixed by
// resolveDailyDraw rather than derived from a tag-scoped query.
// ----------------------------------------------------------------------------

export function buildQuestionPayloads(db: DatabaseSync, questionIds: string[]): Record<string, unknown>[] {
  if (questionIds.length === 0) return [];

  const questionStmt = db.prepare(
    `SELECT ${QUESTION_COLUMNS.map((c) => `q.${c}`).join(", ")}
     FROM question q
     WHERE q.id IN (${questionIds.map(() => "?").join(",")})
     ORDER BY q.id`
  );
  const questionRows = questionStmt.all(...questionIds) as unknown as QuestionRow[];

  const tagsByQuestion = db.prepare("SELECT tag_slug FROM question_tag WHERE question_id = ?");
  const choicesByQuestion = db.prepare(
    "SELECT id, body, is_correct, ordinal, misconception FROM choice WHERE question_id = ? ORDER BY ordinal"
  );

  const questions: Record<string, unknown>[] = [];
  for (const q of questionRows) {
    const qTags = (tagsByQuestion.all(q.id) as { tag_slug: string }[]).map((t) => t.tag_slug);
    const choices =
      q.type === "mc"
        ? (choicesByQuestion.all(q.id) as {
            id: string;
            body: string;
            is_correct: number;
            ordinal: number;
            misconception: string | null;
          }[])
        : [];
    questions.push({ ...q, tags: qTags, choices });
  }
  return questions;
}

// ----------------------------------------------------------------------------
// buildTemplateDrawResponse (canonical side of a "cloud test"): resolve a
// template's draw here, on the full bank, and ship the drawn questions plus
// the tag closure they need, so a local node that never downloaded the
// template's slices can still run it while online. Same shape and mirroring
// contract as /sync/daily-draw.
// ----------------------------------------------------------------------------

export interface TemplateDrawResponse {
  protocol_version: number;
  template_id: string;
  tags: PullResponse["tags"];
  questions: Record<string, unknown>[];
  question_order: string[];
  short_draw: boolean;
  requested: number;
  returned: number;
  mix_adjusted: boolean;
}

export function buildTemplateDrawResponse(db: DatabaseSync, templateId: string): TemplateDrawResponse {
  const draw = resolveTemplateDraw(db, templateId); // throws not_found / template_retired
  const order = draw.questions.map((q) => q.id);
  const questions = buildQuestionPayloads(db, order);
  const usedTagSlugs = [...new Set(questions.flatMap((q) => (q as { tags: string[] }).tags))];
  return {
    protocol_version: PROTOCOL_VERSION,
    template_id: templateId,
    tags: fetchTagAncestorClosure(db, usedTagSlugs),
    questions,
    question_order: order,
    short_draw: draw.short_draw,
    requested: draw.requested,
    returned: draw.returned,
    mix_adjusted: draw.mix_adjusted ?? false,
  };
}

// ----------------------------------------------------------------------------
// fetchTagAncestorClosure: given a set of tag slugs, return the full set of
// tag rows for those slugs PLUS every ancestor reachable by walking
// parent_slug upward — ordered so a parent always appears before its
// children. tag.parent_slug REFERENCES tag(slug), so upsertBankContent (used
// by both applyPullResponse and fetchAndApplyDailyDraw) will FK-fail on any
// row whose parent isn't present yet (or already local) unless the caller
// supplies the full ancestor chain in a safe insertion order. Walks
// parent_slug explicitly rather than splitting the slug string on ":", since
// the FK — and therefore correctness here — is defined on parent_slug, not
// on slug's textual shape.
// ----------------------------------------------------------------------------

export function fetchTagAncestorClosure(
  db: DatabaseSync,
  initialSlugs: string[]
): PullResponse["tags"] {
  if (initialSlugs.length === 0) return [];

  const parentOf = db.prepare("SELECT slug, parent_slug FROM tag WHERE slug = ?");

  // BFS discovers the full ancestor-inclusive closure set. This part is
  // still correct and unchanged: allSlugs ends up containing every initially
  // used slug plus every ancestor reachable by walking parent_slug upward,
  // and the allSlugs.has() guard makes it cycle-safe.
  const allSlugs = new Set<string>(initialSlugs);
  let frontier = [...new Set(initialSlugs)];
  while (frontier.length > 0) {
    const nextParents = new Set<string>();
    for (const slug of frontier) {
      const row = parentOf.get(slug) as { slug: string; parent_slug: string | null } | undefined;
      const parentSlug = row?.parent_slug ?? null;
      if (parentSlug !== null && !allSlugs.has(parentSlug)) {
        nextParents.add(parentSlug);
      }
    }
    if (nextParents.size === 0) break;
    const nextLevel = [...nextParents];
    for (const s of nextLevel) allSlugs.add(s);
    frontier = nextLevel;
  }

  const allSlugsList = [...allSlugs];
  const rowsBySlug = new Map(
    (
      db
        .prepare(
          `SELECT slug, label, parent_slug, description, retired_at FROM tag WHERE slug IN (${allSlugsList.map(() => "?").join(",")})`
        )
        .all(...allSlugsList) as unknown as PullResponse["tags"]
    ).map((row) => [row.slug, row])
  );

  // Order by true tree depth (root-most first), not BFS-discovery level: two
  // directly-used tags can themselves be in an ancestor/descendant
  // relationship, or a draw's questions can use tags at different depths of
  // the same hierarchy, in which case BFS-discovery level does not track
  // tree depth and can ship a child before its parent, violating
  // tag.parent_slug's FK in upsertBankContent. Depth is computed by walking
  // parent_slug through rowsBySlug (the in-memory closure), not the DB, and
  // memoized. The walk is bounded by rowsBySlug.size: a real parent_slug
  // cycle can't touch more distinct nodes than that, so this can't loop
  // forever even if the cycle-safety upstream were ever violated.
  const depthCache = new Map<string, number>();
  function depthOf(slug: string): number {
    const cached = depthCache.get(slug);
    if (cached !== undefined) return cached;

    let depth = 0;
    let current = slug;
    const guard = rowsBySlug.size + 1;
    for (let steps = 0; steps < guard; steps++) {
      const row = rowsBySlug.get(current);
      const parentSlug = row?.parent_slug ?? null;
      if (parentSlug === null || !rowsBySlug.has(parentSlug)) break;
      const parentCached = depthCache.get(parentSlug);
      if (parentCached !== undefined) {
        depth = parentCached + depth + 1;
        depthCache.set(slug, depth);
        return depth;
      }
      depth += 1;
      current = parentSlug;
    }
    depthCache.set(slug, depth);
    return depth;
  }

  return allSlugsList
    .map((slug) => rowsBySlug.get(slug))
    .filter((r): r is PullResponse["tags"][number] => !!r)
    .sort((a, b) => depthOf(a.slug) - depthOf(b.slug));
}

// ----------------------------------------------------------------------------
// buildPullResponse (canonical side)
// ----------------------------------------------------------------------------

export function buildPullResponse(db: DatabaseSync, request: PullRequest): PullResponse {
  const cursor = (db.prepare("SELECT datetime('now') AS t").get() as { t: string }).t;

  const tags: PullResponse["tags"] = [];
  const questions: Record<string, unknown>[] = [];

  if (request.slices.length > 0) {
    const tagMatch = sliceMatchClause("slug", request.slices);
    const tagRows = db
      .prepare(
        `SELECT slug, label, parent_slug, description, retired_at FROM tag WHERE ${tagMatch.sql} ORDER BY slug`
      )
      .all(...tagMatch.params) as unknown as PullResponse["tags"];

    const questionTagMatch = sliceMatchClause("qt.tag_slug", request.slices);
    // Comparison is inclusive (>=) rather than strict: SQLite's datetime('now')
    // is second-precision, so a cursor captured and a subsequent change in the
    // same wall-clock second would otherwise compare equal and be dropped by a
    // strict '>'. applyPullResponse is idempotent (upsert, not insert-only), so
    // re-fetching a row already applied on a prior pull is harmless.
    //
    // Three change markers, because a question row can change in three
    // ways that leave the others untouched: a new row (created_at — covers
    // creation and versioned edits), a retirement (retired_at), and an
    // in-place edit or merge_tags repoint (updated_at, migration 014).
    const sinceClause =
      request.since !== null ? "AND (q.created_at >= ? OR q.retired_at >= ? OR q.updated_at >= ?)" : "";
    const params: unknown[] =
      request.since !== null
        ? [...questionTagMatch.params, request.since, request.since, request.since]
        : [...questionTagMatch.params];

    const questionStmt = db.prepare(
      `SELECT ${QUESTION_COLUMNS.map((c) => `q.${c}`).join(", ")}
       FROM question q
       WHERE EXISTS (
         SELECT 1 FROM question_tag qt WHERE qt.question_id = q.id AND ${questionTagMatch.sql}
       )
       ${sinceClause}
       ORDER BY q.id`
    );
    const questionRows = questionStmt.all(...(params as any[])) as unknown as QuestionRow[];

    const tagsByQuestion = db.prepare("SELECT tag_slug FROM question_tag WHERE question_id = ?");
    const choicesByQuestion = db.prepare(
      "SELECT id, body, is_correct, ordinal, misconception FROM choice WHERE question_id = ? ORDER BY ordinal"
    );

    const referencedSlugs = new Set<string>(tagRows.map((t) => t.slug));
    for (const q of questionRows) {
      const qTags = (tagsByQuestion.all(q.id) as { tag_slug: string }[]).map((t) => t.tag_slug);
      for (const slug of qTags) referencedSlugs.add(slug);
      const choices =
        q.type === "mc"
          ? (choicesByQuestion.all(q.id) as {
              id: string;
              body: string;
              is_correct: number;
              ordinal: number;
              misconception: string | null;
            }[])
          : [];
      questions.push({ ...q, tags: qTags, choices });
    }

    // tagRows alone can omit two things applyPullResponse's tag/question_tag
    // FKs require: (1) a requested slice's own ancestors, when the slice
    // isn't a root tag (slug LIKE 'slug:%' only matches descendants, never
    // ancestors); (2) a cross-cutting tag a pulled question carries outside
    // the requested slice(s) entirely. fetchTagAncestorClosure — the same
    // helper /sync/daily-draw already relies on — closes over every ancestor
    // of every referenced slug and orders the result parent-before-child, so
    // upsertBankContent's tag insert never FK-fails on either gap.
    tags.push(...fetchTagAncestorClosure(db, [...referencedSlugs]));
  }

  // Retired templates travel too: retired_at is one of the synced columns
  // and the local upsert writes it, so a retirement on canonical is a
  // tombstone the local node must see — otherwise it keeps offering (and
  // starting attempts on) a template canonical already took out of service.
  const templates = db
    .prepare(`SELECT ${TEMPLATE_SYNC_COLUMNS.join(", ")} FROM template ORDER BY id`)
    .all() as unknown as Record<string, unknown>[];

  // A frozen template's fixed question set is part of the template's meaning —
  // without it a "frozen" template re-resolves a different draw locally.
  const templateIds = templates.map((t) => t.id as string);
  const frozenQuestions: PullResponse["frozen_questions"] =
    templateIds.length > 0
      ? (db
          .prepare(
            `SELECT template_id, question_id, ordinal FROM template_frozen_question
             WHERE template_id IN (${templateIds.map(() => "?").join(",")})
             ORDER BY template_id, ordinal`
          )
          .all(...templateIds) as unknown as PullResponse["frozen_questions"])
      : [];

  const grades: PullResponse["grades"] = [];
  if (request.include_grades_for_node) {
    // A supersede is a change to an OLD row: the self-grade being superseded
    // may have been graded (and pushed) long before this cursor. If only
    // graded_at were checked, the local node would receive the new live model
    // grade but not the supersede of its own still-live self-grade, collide
    // on grade_one_live_per_response, roll the whole pull back, and stay
    // jammed on every subsequent sync.
    const gradeSinceClause = request.since !== null ? "AND (g.graded_at >= ? OR g.superseded_at >= ?)" : "";
    const gradeStmt = db.prepare(
      `SELECT g.id, g.response_id, g.grader, g.score, g.feedback, g.model_name, g.graded_at, g.superseded_at
       FROM grade g
       JOIN response r ON r.id = g.response_id
       JOIN attempt a ON a.id = r.attempt_id
       WHERE a.node_id = ? AND (g.grader = 'model' OR g.superseded_at IS NOT NULL)
       ${gradeSinceClause}
       ORDER BY g.id`
    );
    const gradeParams: unknown[] =
      request.since !== null ? [request.node_id, request.since, request.since] : [request.node_id];
    grades.push(...(gradeStmt.all(...(gradeParams as any[])) as unknown as PullResponse["grades"]));
  }

  return {
    protocol_version: request.protocol_version,
    server_time: cursor,
    tags,
    questions,
    templates,
    grades,
    frozen_questions: frozenQuestions,
    themes: listThemesForSync(db),
    active_theme_id: getActiveThemeId(db),
    cursor,
  };
}

// ----------------------------------------------------------------------------
// upsertBankContent: the tag-upsert and question-upsert (incl. question_tag/
// choice delete-then-reinsert, and the document-asset-nulling guard) shared
// by applyPullResponse and the daily-draw local mirroring path. Does NOT open
// its own transaction — the caller owns transaction boundaries, since this
// runs as one step inside a larger atomic apply (applyPullResponse's own
// BEGIN/COMMIT, or fetchAndApplyDailyDraw's).
// ----------------------------------------------------------------------------

export function upsertBankContent(
  db: DatabaseSync,
  tags: PullResponse["tags"],
  questions: Record<string, unknown>[]
): { tagsApplied: number; questionsApplied: number } {
  const upsertTag = db.prepare(
    `INSERT INTO tag (slug, label, parent_slug, description, retired_at)
     VALUES (@slug, @label, @parent_slug, @description, @retired_at)
     ON CONFLICT (slug) DO UPDATE SET
       label = excluded.label,
       parent_slug = excluded.parent_slug,
       description = excluded.description,
       retired_at = excluded.retired_at`
  );

  const upsertQuestion = db.prepare(
    `INSERT INTO question (${QUESTION_COLUMNS.join(", ")})
     VALUES (${QUESTION_COLUMNS.map((c) => `@${c}`).join(", ")})
     ON CONFLICT (id) DO UPDATE SET
       ${QUESTION_COLUMNS.filter((c) => c !== "id")
         .map((c) => `${c} = excluded.${c}`)
         .join(", ")}`
  );

  const deleteQuestionTags = db.prepare("DELETE FROM question_tag WHERE question_id = ?");
  const insertQuestionTag = db.prepare("INSERT INTO question_tag (question_id, tag_slug) VALUES (?, ?)");
  const deleteChoices = db.prepare("DELETE FROM choice WHERE question_id = ?");
  const insertChoice = db.prepare(
    "INSERT INTO choice (id, question_id, body, is_correct, ordinal, misconception) VALUES (?, ?, ?, ?, ?, ?)"
  );

  const findAsset = db.prepare("SELECT id FROM asset WHERE id = ?");

  let tagsApplied = 0;
  let questionsApplied = 0;

  for (const tag of tags) {
    upsertTag.run({
      slug: tag.slug,
      label: tag.label,
      parent_slug: tag.parent_slug,
      description: tag.description,
      retired_at: tag.retired_at,
    });
    tagsApplied += 1;
  }

  for (const q of questions as unknown as (QuestionRow & {
    tags: string[];
    choices: { id: string; body: string; is_correct: number; ordinal: number; misconception: string | null }[];
  })[]) {
    const fields: Record<string, unknown> = {};
    for (const c of QUESTION_COLUMNS) fields[c] = (q as unknown as Record<string, unknown>)[c] ?? null;

    // question.document_id REFERENCES asset(id), but asset rows are not part
    // of the sync protocol (asset sync is a separate future spec). Rather
    // than let an FK violation roll back — and permanently jam — the whole
    // pull, sync the question without its document-panel linkage.
    if (fields.document_id != null && !findAsset.get(fields.document_id as string)) {
      fields.document_id = null;
      fields.document_anchor_label = null;
      fields.document_anchor_start = null;
      fields.document_anchor_end = null;
      fields.document_marker_offset = null;
    }

    upsertQuestion.run(fields as Record<string, any>);

    deleteQuestionTags.run(q.id);
    for (const slug of q.tags ?? []) insertQuestionTag.run(q.id, slug);

    deleteChoices.run(q.id);
    for (const c of q.choices ?? [])
      insertChoice.run(c.id, q.id, c.body, c.is_correct, c.ordinal, c.misconception ?? null);

    questionsApplied += 1;
  }

  return { tagsApplied, questionsApplied };
}

// ----------------------------------------------------------------------------
// applyPullResponse (local side)
// ----------------------------------------------------------------------------

export function applyPullResponse(
  db: DatabaseSync,
  response: PullResponse,
  slices: string[] = []
): ApplyPullResult {
  const upsertTemplate = db.prepare(
    `INSERT INTO template (${TEMPLATE_SYNC_COLUMNS.join(", ")})
     VALUES (${TEMPLATE_SYNC_COLUMNS.map((c) => `@${c}`).join(", ")})
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       tag_query = excluded.tag_query,
       question_count = excluded.question_count,
       mc_ratio = excluded.mc_ratio,
       difficulty_min = excluded.difficulty_min,
       difficulty_max = excluded.difficulty_max,
       calculator_policy = excluded.calculator_policy,
       weighting = excluded.weighting,
       frozen = excluded.frozen,
       time_limit_sec = excluded.time_limit_sec,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       retired_at = excluded.retired_at`
  );

  const findGrade = db.prepare("SELECT id, superseded_at FROM grade WHERE id = ?");
  const supersedeGrade = db.prepare("UPDATE grade SET superseded_at = ? WHERE id = ?");
  const insertGrade = db.prepare(
    `INSERT INTO grade (id, response_id, grader, score, feedback, model_name, graded_at, superseded_at)
     VALUES (@id, @response_id, @grader, @score, @feedback, @model_name, @graded_at, @superseded_at)`
  );

  const deleteFrozen = db.prepare("DELETE FROM template_frozen_question WHERE template_id = ?");
  const insertFrozen = db.prepare(
    "INSERT INTO template_frozen_question (template_id, question_id, ordinal) VALUES (?, ?, ?)"
  );

  let tagsApplied = 0;
  let questionsApplied = 0;
  let templatesApplied = 0;
  let gradesApplied = 0;

  db.exec("BEGIN");
  try {
    ({ tagsApplied, questionsApplied } = upsertBankContent(db, response.tags, response.questions));

    const frozenByTemplate = new Map<string, PullResponse["frozen_questions"]>();
    for (const f of response.frozen_questions ?? []) {
      const list = frozenByTemplate.get(f.template_id) ?? [];
      list.push(f);
      frozenByTemplate.set(f.template_id, list);
    }

    const findLocalQuestion = db.prepare("SELECT id FROM question WHERE id = ?");

    for (const t of response.templates as Record<string, unknown>[]) {
      // Column allowlist, mirroring applyPushRequest's ATTEMPT_COLUMNS: a peer
      // on a different schema version (or a node-local-only column such as
      // session_id) must not reach the prepared statement's named parameters.
      const fields: Record<string, unknown> = {};
      for (const c of TEMPLATE_SYNC_COLUMNS) fields[c] = t[c] ?? null;
      upsertTemplate.run(fields as Record<string, any>);
      templatesApplied += 1;

      const frozen = frozenByTemplate.get(t.id as string);
      if (frozen && frozen.length > 0) {
        deleteFrozen.run(t.id as string);
        for (const f of frozen) {
          // A frozen question outside this node's slices was never pulled;
          // skip it rather than FK-fail the whole pull.
          if (!findLocalQuestion.get(f.question_id)) continue;
          insertFrozen.run(f.template_id, f.question_id, f.ordinal);
        }
      }
    }

    // Two-pass apply, mirroring applyPushRequest's supersede-then-insert
    // ordering: a supersede-update always lands before a new live grade
    // insert, regardless of array order, so the new live row never collides
    // with the still-live old one on the grade_one_live_per_response partial
    // unique index.
    //
    // Pass 1: grades already present locally (matched by id). A non-null
    // incoming superseded_at over a locally-live row is a real synced change
    // (live -> superseded is monotonic, so this can never un-supersede
    // anything). If nothing changed, it's the local's own copy pulled back or
    // an earlier partial/retried pull — already applied, skip it.
    const newGrades: PullResponse["grades"] = [];
    for (const g of response.grades) {
      const existing = findGrade.get(g.id) as { id: string; superseded_at: string | null } | undefined;
      if (!existing) {
        newGrades.push(g);
        continue;
      }
      if (g.superseded_at !== null && existing.superseded_at === null) {
        supersedeGrade.run(g.superseded_at, g.id);
        gradesApplied += 1;
      }
    }

    // Pass 2: genuinely new grades, inserted after every supersede above has
    // vacated its one-live-per-response slot.
    for (const g of newGrades) {
      insertGrade.run({
        id: g.id,
        response_id: g.response_id,
        grader: g.grader,
        score: g.score,
        feedback: g.feedback,
        model_name: g.model_name,
        graded_at: g.graded_at,
        superseded_at: g.superseded_at,
      });
      gradesApplied += 1;
    }

    if (response.themes) applyThemesFromPull(db, response.themes, response.active_theme_id);

    // Freshness bookkeeping for the slices this pull covered: a real pulled_at
    // (replacing the NEVER_PULLED sentinel) and a live local question count,
    // so Settings shows real numbers and runSync stops treating the slice as
    // needing a backfill.
    const findSlice = db.prepare("SELECT tag_slug FROM local_slice WHERE tag_slug = ?");
    const countQuestions = db.prepare(
      `SELECT COUNT(DISTINCT q.id) AS n FROM question q
       JOIN question_tag qt ON qt.question_id = q.id
       WHERE (qt.tag_slug = ? OR qt.tag_slug LIKE ?) AND q.retired_at IS NULL`
    );
    const updateSlice = db.prepare(
      "UPDATE local_slice SET pulled_at = ?, question_count = ? WHERE tag_slug = ?"
    );
    for (const slug of slices) {
      if (!findSlice.get(slug)) continue;
      const { n } = countQuestions.get(slug, `${slug}:%`) as { n: number };
      updateSlice.run(response.cursor, n, slug);
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return {
    tags_applied: tagsApplied,
    questions_applied: questionsApplied,
    templates_applied: templatesApplied,
    grades_applied: gradesApplied,
    cursor: response.cursor,
  };
}

// ----------------------------------------------------------------------------
// Push protocol: a local node's attempts/responses/grades flow up to
// canonical, idempotently — pushing the same payload twice is a no-op.
// ----------------------------------------------------------------------------

export interface PushRequest {
  node_id: string;
  protocol_version: number;
  attempts: Record<string, unknown>[]; // shape matches the `attempt` table columns
  responses: Record<string, unknown>[]; // shape matches the `response` table columns
  grades: Record<string, unknown>[]; // shape matches the `grade` table columns
}

export interface PushResult {
  protocol_version: number;
  accepted: string[];
  duplicate: string[];
  rejected: { id: string; reason: string; detail?: string }[];
  regrade_queued: string[];
}

const ATTEMPT_COLUMNS = [
  "id",
  "node_id",
  "source",
  "template_id",
  "daily_draw_id",
  "started_at",
  "submitted_at",
  "abandoned_at",
  "paused_at",
  "paused_ms",
  "offline",
] as const;

const RESPONSE_COLUMNS = [
  "id",
  "attempt_id",
  "question_id",
  "ordinal",
  "selected_choice_id",
  "response_text",
  "skipped",
  "answered_at",
  "elapsed_ms",
  "confidence",
  "idk",
  "misapplied_method",
  "best_guess_choice_id",
  "diagnosis",
] as const;

const GRADE_COLUMNS = [
  "id",
  "response_id",
  "grader",
  "score",
  "feedback",
  "rubric_version",
  "model_name",
  "graded_at",
  "superseded_at",
] as const;

export function applyPushRequest(db: DatabaseSync, request: PushRequest): PushResult {
  const accepted: string[] = [];
  const duplicate: string[] = [];
  const rejected: { id: string; reason: string; detail?: string }[] = [];
  const newlyAcceptedResponses = new Map<string, Record<string, unknown>>();
  const newlyAcceptedGrades: Record<string, unknown>[] = [];

  const findAttempt = db.prepare("SELECT id FROM attempt WHERE id = ?");
  const insertAttempt = db.prepare(
    `INSERT INTO attempt (${ATTEMPT_COLUMNS.join(", ")})
     VALUES (${ATTEMPT_COLUMNS.map((c) => `@${c}`).join(", ")})`
  );

  const findQuestion = db.prepare("SELECT id FROM question WHERE id = ?");
  const findResponse = db.prepare("SELECT id FROM response WHERE id = ?");
  const insertResponse = db.prepare(
    `INSERT INTO response (${RESPONSE_COLUMNS.join(", ")})
     VALUES (${RESPONSE_COLUMNS.map((c) => `@${c}`).join(", ")})`
  );

  const findGrade = db.prepare("SELECT id, superseded_at FROM grade WHERE id = ?");
  const supersedeGrade = db.prepare("UPDATE grade SET superseded_at = ? WHERE id = ?");
  const insertGrade = db.prepare(
    `INSERT INTO grade (${GRADE_COLUMNS.join(", ")})
     VALUES (${GRADE_COLUMNS.map((c) => `@${c}`).join(", ")})`
  );

  db.exec("BEGIN");
  try {
    const requestAttemptIds = new Set(request.attempts.map((a) => a.id as string));
    const requestResponseIds = new Set(request.responses.map((r) => r.id as string));

    for (const attempt of request.attempts) {
      const id = attempt.id as string;
      if (findAttempt.get(id)) {
        duplicate.push(id);
        continue;
      }
      try {
        const fields: Record<string, unknown> = {};
        // paused_ms is NOT NULL DEFAULT 0 (migration 017): a payload from a
        // node that predates pause accounting simply has no paused time.
        for (const c of ATTEMPT_COLUMNS) fields[c] = attempt[c] ?? (c === "paused_ms" ? 0 : null);
        insertAttempt.run(fields as Record<string, any>);
        accepted.push(id);
      } catch (err) {
        rejected.push({ id, reason: "insert_failed", detail: (err as Error).message });
      }
    }

    for (const response of request.responses) {
      const id = response.id as string;
      if (findResponse.get(id)) {
        duplicate.push(id);
        continue;
      }

      const questionId = response.question_id as string;
      if (!findQuestion.get(questionId)) {
        rejected.push({ id, reason: "unknown_question_id" });
        continue;
      }

      const attemptId = response.attempt_id as string;
      if (!requestAttemptIds.has(attemptId) && !findAttempt.get(attemptId)) {
        rejected.push({ id, reason: "unknown_attempt_id" });
        continue;
      }

      try {
        const fields: Record<string, unknown> = {};
        for (const c of RESPONSE_COLUMNS) {
          // response.idk is NOT NULL DEFAULT 0 (no CHECK allows NULL, unlike
          // confidence/misapplied_method): an explicit column list in the
          // INSERT bypasses the schema default, so an older/offline payload
          // that predates this field (and omits it) must fall back to 0, not
          // null, or the insert violates the NOT NULL constraint.
          fields[c] = c === "idk" ? (response[c] ?? 0) : response[c] ?? null;
        }
        insertResponse.run(fields as Record<string, any>);
        accepted.push(id);
        newlyAcceptedResponses.set(id, response);
      } catch (err) {
        rejected.push({ id, reason: "insert_failed", detail: (err as Error).message });
      }
    }

    // Grades go in two passes so a supersede-update always lands before a new
    // live grade insert, regardless of array order — otherwise the incoming
    // grade collides with the still-live old one on the
    // grade_one_live_per_response partial unique index and gets rejected.
    //
    // Pass 1: grades already present locally. A non-null incoming
    // superseded_at over a locally-live row is a real synced change (live ->
    // superseded is monotonic, so this can never un-supersede anything).
    const newGrades: Record<string, unknown>[] = [];
    for (const grade of request.grades) {
      const id = grade.id as string;
      const existing = findGrade.get(id) as { id: string; superseded_at: string | null } | undefined;
      if (!existing) {
        newGrades.push(grade);
        continue;
      }
      const incomingSuperseded = (grade.superseded_at as string | null) ?? null;
      if (incomingSuperseded !== null && existing.superseded_at === null) {
        try {
          supersedeGrade.run(incomingSuperseded, id);
          accepted.push(id);
        } catch (err) {
          rejected.push({ id, reason: "update_failed", detail: (err as Error).message });
        }
      } else {
        duplicate.push(id);
      }
    }

    // Pass 2: genuinely new grades, inserted after every supersede above has
    // vacated its one-live-per-response slot.
    for (const grade of newGrades) {
      const id = grade.id as string;
      const responseId = grade.response_id as string;
      if (!requestResponseIds.has(responseId) && !findResponse.get(responseId)) {
        rejected.push({ id, reason: "unknown_response_id" });
        continue;
      }

      try {
        const fields: Record<string, unknown> = {};
        for (const c of GRADE_COLUMNS) fields[c] = grade[c] ?? null;
        insertGrade.run(fields as Record<string, any>);
        accepted.push(id);
        newlyAcceptedGrades.push(grade);
      } catch (err) {
        rejected.push({ id, reason: "insert_failed", detail: (err as Error).message });
      }
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const regradeQueued: string[] = [];
  const gradesByResponse = new Map<string, Record<string, unknown>[]>();
  for (const grade of newlyAcceptedGrades) {
    const responseId = grade.response_id as string;
    const list = gradesByResponse.get(responseId) ?? [];
    list.push(grade);
    gradesByResponse.set(responseId, list);
  }
  for (const [responseId, response] of newlyAcceptedResponses) {
    if (response.response_text == null) continue;
    const grades = gradesByResponse.get(responseId) ?? [];
    const nonSelfGrades = grades.filter((g) => g.grader !== "self");
    if (grades.length > 0 && nonSelfGrades.length === 0) {
      regradeQueued.push(responseId);
    }
  }

  return {
    protocol_version: request.protocol_version,
    accepted,
    duplicate,
    rejected,
    regrade_queued: regradeQueued,
  };
}

// ----------------------------------------------------------------------------
// Slice management: which tag slices this local node holds. Adding a slice
// records intent immediately (the actual content pull is a separate step,
// see sync/client.ts's pullOneSlice); removing a slice drops the local_slice
// row and prunes any questions in that slice that no local response
// references, so we don't accumulate content nobody on this node ever used.
// ----------------------------------------------------------------------------

export function addSlice(db: DatabaseSync, tagSlug: string): void {
  // local_slice.tag_slug FKs to tag(slug), but a fresh local node has no tag
  // rows for a slice it doesn't hold yet. Insert a minimal stub so the FK is
  // satisfied; the next pull's tag upsert (ON CONFLICT DO UPDATE, which
  // overwrites every field) transparently replaces it with the real tag.
  db.prepare(
    `INSERT INTO tag (slug, label, parent_slug, description) VALUES (?, ?, NULL, NULL)
     ON CONFLICT (slug) DO NOTHING`
  ).run(tagSlug, tagSlug);

  // A brand new slice is "recorded but never pulled" — the sentinel, not
  // datetime('now'). Only a successful pull (applyPullResponse) stamps a real
  // pulled_at; until then runSync knows to issue a full backfill for it.
  db.prepare(
    `INSERT INTO local_slice (tag_slug, pulled_at) VALUES (?, ?)
     ON CONFLICT (tag_slug) DO NOTHING`
  ).run(tagSlug, NEVER_PULLED);
}

export function removeSlice(db: DatabaseSync, tagSlug: string): { pruned_questions: number } {
  const questionIds = (
    db.prepare(
      `SELECT DISTINCT q.id FROM question q
       JOIN question_tag qt ON qt.question_id = q.id
       WHERE (qt.tag_slug = ? OR qt.tag_slug LIKE ?)
         AND NOT EXISTS (SELECT 1 FROM response r WHERE r.question_id = q.id)
         -- Both of these FK to question with ON DELETE RESTRICT; excluding
         -- them up front beats letting the delete raise and roll back.
         AND NOT EXISTS (SELECT 1 FROM template_frozen_question tfq WHERE tfq.question_id = q.id)
         AND NOT EXISTS (SELECT 1 FROM daily_draw_question ddq WHERE ddq.question_id = q.id)
         -- A question also covered by another held slice belongs to that
         -- slice too; removing this one must not gut the other.
         AND NOT EXISTS (
           SELECT 1 FROM question_tag qt2
           JOIN local_slice ls ON ls.tag_slug != ?
             AND (qt2.tag_slug = ls.tag_slug OR qt2.tag_slug LIKE ls.tag_slug || ':%')
           WHERE qt2.question_id = q.id
         )`
    ).all(tagSlug, `${tagSlug}:%`, tagSlug) as { id: string }[]
  ).map((r) => r.id);

  db.exec("BEGIN");
  try {
    for (const id of questionIds) db.prepare("DELETE FROM question WHERE id = ?").run(id);
    db.prepare("DELETE FROM local_slice WHERE tag_slug = ?").run(tagSlug);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { pruned_questions: questionIds.length };
}
