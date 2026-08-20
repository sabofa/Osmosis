import type { DatabaseSync } from "node:sqlite";

// ----------------------------------------------------------------------------
// Pull protocol: bank content (tags/questions/templates/grades) flows down
// from the canonical node to a local node holding a tag-based slice of it.
// ----------------------------------------------------------------------------

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
  tags: { slug: string; label: string; parent_slug: string | null; retired_at: string | null }[];
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
  cursor: string;
}

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
}

const QUESTION_COLUMNS = [
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
] as const;

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
      .prepare(`SELECT slug, label, parent_slug, retired_at FROM tag WHERE ${tagMatch.sql} ORDER BY slug`)
      .all(...tagMatch.params) as unknown as PullResponse["tags"];
    tags.push(...tagRows);

    const questionTagMatch = sliceMatchClause("qt.tag_slug", request.slices);
    // Comparison is inclusive (>=) rather than strict: SQLite's datetime('now')
    // is second-precision, so a cursor captured and a subsequent change in the
    // same wall-clock second would otherwise compare equal and be dropped by a
    // strict '>'. applyPullResponse is idempotent (upsert, not insert-only), so
    // re-fetching a row already applied on a prior pull is harmless.
    const sinceClause = request.since !== null ? "AND (q.created_at >= ? OR q.retired_at >= ?)" : "";
    const params: unknown[] =
      request.since !== null
        ? [...questionTagMatch.params, request.since, request.since]
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
      "SELECT id, body, is_correct, ordinal FROM choice WHERE question_id = ? ORDER BY ordinal"
    );

    for (const q of questionRows) {
      const qTags = (tagsByQuestion.all(q.id) as { tag_slug: string }[]).map((t) => t.tag_slug);
      const choices =
        q.type === "mc"
          ? (choicesByQuestion.all(q.id) as { id: string; body: string; is_correct: number; ordinal: number }[])
          : [];
      questions.push({ ...q, tags: qTags, choices });
    }
  }

  const templates = db
    .prepare("SELECT * FROM template WHERE retired_at IS NULL ORDER BY id")
    .all() as unknown as Record<string, unknown>[];

  const grades: PullResponse["grades"] = [];
  if (request.include_grades_for_node) {
    const gradeSinceClause = request.since !== null ? "AND g.graded_at >= ?" : "";
    const gradeStmt = db.prepare(
      `SELECT g.id, g.response_id, g.grader, g.score, g.feedback, g.model_name, g.graded_at, g.superseded_at
       FROM grade g
       JOIN response r ON r.id = g.response_id
       JOIN attempt a ON a.id = r.attempt_id
       WHERE a.node_id = ? AND g.grader = 'model'
       ${gradeSinceClause}
       ORDER BY g.id`
    );
    const gradeParams: unknown[] =
      request.since !== null ? [request.node_id, request.since] : [request.node_id];
    grades.push(...(gradeStmt.all(...(gradeParams as any[])) as unknown as PullResponse["grades"]));
  }

  return {
    protocol_version: request.protocol_version,
    server_time: cursor,
    tags,
    questions,
    templates,
    grades,
    cursor,
  };
}

// ----------------------------------------------------------------------------
// applyPullResponse (local side)
// ----------------------------------------------------------------------------

export function applyPullResponse(db: DatabaseSync, response: PullResponse): ApplyPullResult {
  const upsertTag = db.prepare(
    `INSERT INTO tag (slug, label, parent_slug, retired_at)
     VALUES (@slug, @label, @parent_slug, @retired_at)
     ON CONFLICT (slug) DO UPDATE SET
       label = excluded.label,
       parent_slug = excluded.parent_slug,
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
    "INSERT INTO choice (id, question_id, body, is_correct, ordinal) VALUES (?, ?, ?, ?, ?)"
  );

  const upsertTemplate = db.prepare(
    `INSERT INTO template (
       id, name, description, tag_query, question_count, mc_ratio,
       difficulty_min, difficulty_max, calculator_policy, weighting,
       frozen, time_limit_sec, created_at, updated_at, retired_at
     ) VALUES (
       @id, @name, @description, @tag_query, @question_count, @mc_ratio,
       @difficulty_min, @difficulty_max, @calculator_policy, @weighting,
       @frozen, @time_limit_sec, @created_at, @updated_at, @retired_at
     )
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

  const upsertGrade = db.prepare(
    `INSERT INTO grade (id, response_id, grader, score, feedback, model_name, graded_at, superseded_at)
     VALUES (@id, @response_id, @grader, @score, @feedback, @model_name, @graded_at, @superseded_at)
     ON CONFLICT (id) DO UPDATE SET
       response_id = excluded.response_id,
       grader = excluded.grader,
       score = excluded.score,
       feedback = excluded.feedback,
       model_name = excluded.model_name,
       graded_at = excluded.graded_at,
       superseded_at = excluded.superseded_at`
  );

  let tagsApplied = 0;
  let questionsApplied = 0;
  let templatesApplied = 0;
  let gradesApplied = 0;

  db.exec("BEGIN");
  try {
    for (const tag of response.tags) {
      upsertTag.run({
        slug: tag.slug,
        label: tag.label,
        parent_slug: tag.parent_slug,
        retired_at: tag.retired_at,
      });
      tagsApplied += 1;
    }

    for (const q of response.questions as unknown as (QuestionRow & {
      tags: string[];
      choices: { id: string; body: string; is_correct: number; ordinal: number }[];
    })[]) {
      const fields: Record<string, unknown> = {};
      for (const c of QUESTION_COLUMNS) fields[c] = (q as unknown as Record<string, unknown>)[c] ?? null;
      upsertQuestion.run(fields as Record<string, any>);

      deleteQuestionTags.run(q.id);
      for (const slug of q.tags ?? []) insertQuestionTag.run(q.id, slug);

      deleteChoices.run(q.id);
      for (const c of q.choices ?? []) insertChoice.run(c.id, q.id, c.body, c.is_correct, c.ordinal);

      questionsApplied += 1;
    }

    for (const t of response.templates as Record<string, unknown>[]) {
      upsertTemplate.run(t as Record<string, any>);
      templatesApplied += 1;
    }

    for (const g of response.grades) {
      upsertGrade.run({
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
