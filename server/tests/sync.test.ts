import { describe, it, expect } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  buildPullResponse,
  applyPullResponse,
  applyPushRequest,
  addSlice,
  removeSlice,
  NEVER_PULLED,
} from "../src/domain/sync.js";
import { createTemplate } from "../src/domain/templates.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";

describe("buildPullResponse", () => {
  it("returns tags and questions matching a slice, expanding descendants", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    insertTag(canonical, "math:functions", "math");
    insertTag(canonical, "history");
    const inSlice = insertQuestion(canonical, { tags: ["math:functions"] });
    insertQuestion(canonical, { tags: ["history"] }); // out of slice

    const response = buildPullResponse(canonical, {
      node_id: "local-1",
      protocol_version: 1,
      slices: ["math"],
      since: null,
      include_grades_for_node: false,
    });

    expect(response.tags.map((t) => t.slug).sort()).toEqual(["math", "math:functions"]);
    expect(response.questions.map((q: any) => q.id)).toEqual([inSlice.id]);
    expect(response.templates).toEqual([]);
    expect(response.grades).toEqual([]);
    expect(typeof response.cursor).toBe("string");
  });

  // Regression: buildPullResponse must include a requested slice's ancestor
  // chain even when the slice itself is not a root tag, mirroring the fix
  // already applied to /sync/daily-draw's fetchTagAncestorClosure. Without
  // it, applyPullResponse's tag upsert violates tag.parent_slug's FK on a
  // fresh local db that has never seen "math".
  it("includes a requested non-root slice's full ancestor chain, not just the slice itself", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    insertTag(canonical, "math:algebra", "math");
    insertQuestion(canonical, { tags: ["math:algebra"] });

    const response = buildPullResponse(canonical, {
      node_id: "local-1",
      protocol_version: 1,
      slices: ["math:algebra"],
      since: null,
      include_grades_for_node: false,
    });

    expect(response.tags.map((t) => t.slug).sort()).toEqual(["math", "math:algebra"]);

    const local = openTestDb();
    expect(() => applyPullResponse(local, response)).not.toThrow();
    const row = local.prepare("SELECT slug FROM tag WHERE slug = 'math'").get();
    expect(row).toBeTruthy();
  });

  // Regression: a question can carry a tag outside the requested slice (a
  // cross-cutting tag). buildPullResponse must still ship that tag — and its
  // ancestors — or applyPullResponse's question_tag insert FK-fails on a
  // fresh local db that only pulled the "math" slice.
  it("includes a cross-cutting tag (and its ancestors) referenced by a pulled question, even outside the requested slice", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    insertTag(canonical, "topics");
    insertTag(canonical, "topics:calculus", "topics");
    insertQuestion(canonical, { tags: ["math", "topics:calculus"] });

    const response = buildPullResponse(canonical, {
      node_id: "local-1",
      protocol_version: 1,
      slices: ["math"],
      since: null,
      include_grades_for_node: false,
    });

    expect(response.tags.map((t) => t.slug).sort()).toEqual(["math", "topics", "topics:calculus"]);

    const local = openTestDb();
    expect(() => applyPullResponse(local, response)).not.toThrow();
    const row = local.prepare("SELECT slug FROM tag WHERE slug = 'topics:calculus'").get();
    expect(row).toBeTruthy();
  });
});

describe("applyPullResponse", () => {
  it("upserts pulled tags and questions into a local db", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    const q = insertQuestion(canonical, { tags: ["math"] });
    const response = buildPullResponse(canonical, {
      node_id: "local-1", protocol_version: 1, slices: ["math"], since: null, include_grades_for_node: false,
    });

    const local = openTestDb();
    const result = applyPullResponse(local, response);

    expect(result.tags_applied).toBe(1);
    expect(result.questions_applied).toBe(1);
    const row = local.prepare("SELECT id FROM question WHERE id = ?").get(q.id);
    expect(row).toBeTruthy();
  });

  it("is idempotent — applying the same response twice does not error or duplicate", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    insertQuestion(canonical, { tags: ["math"] });
    const response = buildPullResponse(canonical, {
      node_id: "local-1", protocol_version: 1, slices: ["math"], since: null, include_grades_for_node: false,
    });

    const local = openTestDb();
    applyPullResponse(local, response);
    applyPullResponse(local, response);

    const count = (local.prepare("SELECT COUNT(*) AS n FROM question").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("syncs a tag's description to the local node on first pull", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math", null, "The study of numbers, structure, and change.");
    insertQuestion(canonical, { tags: ["math"] });
    const response = buildPullResponse(canonical, {
      node_id: "local-1", protocol_version: 1, slices: ["math"], since: null, include_grades_for_node: false,
    });

    const local = openTestDb();
    applyPullResponse(local, response);

    const row = local.prepare("SELECT description FROM tag WHERE slug = ?").get("math") as {
      description: string | null;
    };
    expect(row.description).toBe("The study of numbers, structure, and change.");
  });

  it("a retired question tombstone retires the local row without deleting it", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    const q = insertQuestion(canonical, { tags: ["math"] });
    const firstPull = buildPullResponse(canonical, {
      node_id: "local-1", protocol_version: 1, slices: ["math"], since: null, include_grades_for_node: false,
    });
    const local = openTestDb();
    applyPullResponse(local, firstPull);

    canonical.prepare("UPDATE question SET retired_at = datetime('now'), retired_reason = 'test' WHERE id = ?").run(q.id);
    const secondPull = buildPullResponse(canonical, {
      node_id: "local-1", protocol_version: 1, slices: ["math"], since: firstPull.cursor, include_grades_for_node: false,
    });
    applyPullResponse(local, secondPull);

    const row = local.prepare("SELECT retired_at FROM question WHERE id = ?").get(q.id) as { retired_at: string | null };
    expect(row.retired_at).not.toBeNull();
  });

  // Finding 4 — local_slice.pulled_at/question_count must move on a real pull.
  it("updates local_slice.pulled_at and question_count for the slices the pull covered", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    insertTag(canonical, "math:algebra", "math");
    insertQuestion(canonical, { tags: ["math"] });
    insertQuestion(canonical, { tags: ["math:algebra"] }); // descendant counts too
    const retired = insertQuestion(canonical, { tags: ["math"] });
    canonical.prepare("UPDATE question SET retired_at = datetime('now') WHERE id = ?").run(retired.id);

    const response = buildPullResponse(canonical, {
      node_id: "local-1", protocol_version: 1, slices: ["math"], since: null, include_grades_for_node: false,
    });

    const local = openTestDb();
    addSlice(local, "math");
    expect(
      (local.prepare("SELECT pulled_at FROM local_slice WHERE tag_slug = 'math'").get() as { pulled_at: string })
        .pulled_at
    ).toBe(NEVER_PULLED);

    applyPullResponse(local, response, ["math"]);

    const slice = local.prepare("SELECT pulled_at, question_count FROM local_slice WHERE tag_slug = 'math'").get() as {
      pulled_at: string; question_count: number;
    };
    // 2 live questions (the retired one is excluded), sentinel cleared.
    expect(slice.question_count).toBe(2);
    expect(slice.pulled_at).not.toBe(NEVER_PULLED);
    expect(slice.pulled_at).toBe(response.cursor);
  });

  it("leaves local_slice untouched for slices the pull was not for", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    insertQuestion(canonical, { tags: ["math"] });
    const response = buildPullResponse(canonical, {
      node_id: "local-1", protocol_version: 1, slices: ["math"], since: null, include_grades_for_node: false,
    });

    const local = openTestDb();
    addSlice(local, "math");
    addSlice(local, "history"); // held, but not part of this pull
    applyPullResponse(local, response, ["math"]);

    const other = local.prepare("SELECT pulled_at FROM local_slice WHERE tag_slug = 'history'").get() as {
      pulled_at: string;
    };
    expect(other.pulled_at).toBe(NEVER_PULLED);
  });

  // Finding 3 — a document-anchored question must not FK-fail and jam the pull.
  it("strips document linkage from a pulled question whose asset does not exist locally", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    const assetId = uuidv4();
    canonical.prepare(
      "INSERT INTO asset (id, title, type, content) VALUES (?, 'doc', 'text', 'body text')"
    ).run(assetId);
    const q = insertQuestion(canonical, { tags: ["math"] });
    canonical.prepare(
      `UPDATE question SET document_id = ?, document_anchor_label = 'p1', document_anchor_start = 10,
         document_anchor_end = 40, document_marker_offset = 3, graph_spec = '{"kind":"line"}' WHERE id = ?`
    ).run(assetId, q.id);

    const response = buildPullResponse(canonical, {
      node_id: "local-1", protocol_version: 1, slices: ["math"], since: null, include_grades_for_node: false,
    });

    // Fresh local node: no asset rows at all. The pull must succeed anyway.
    const local = openTestDb();
    expect(() => applyPullResponse(local, response, ["math"])).not.toThrow();

    const row = local.prepare(
      `SELECT document_id, document_anchor_label, document_anchor_start, document_anchor_end,
              document_marker_offset, graph_spec, prompt FROM question WHERE id = ?`
    ).get(q.id) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.document_id).toBeNull();
    expect(row.document_anchor_label).toBeNull();
    expect(row.document_anchor_start).toBeNull();
    expect(row.document_anchor_end).toBeNull();
    expect(row.document_marker_offset).toBeNull();
    // Everything unrelated to the document panel still syncs.
    expect(row.graph_spec).toBe('{"kind":"line"}');
    expect(row.prompt).toBeTruthy();
  });

  it("keeps document linkage when the asset does exist locally", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    const assetId = uuidv4();
    canonical.prepare("INSERT INTO asset (id, title, type, content) VALUES (?, 'doc', 'text', 'b')").run(assetId);
    const q = insertQuestion(canonical, { tags: ["math"] });
    canonical.prepare(
      "UPDATE question SET document_id = ?, document_anchor_label = 'p1' WHERE id = ?"
    ).run(assetId, q.id);

    const response = buildPullResponse(canonical, {
      node_id: "local-1", protocol_version: 1, slices: ["math"], since: null, include_grades_for_node: false,
    });

    const local = openTestDb();
    local.prepare("INSERT INTO asset (id, title, type, content) VALUES (?, 'doc', 'text', 'b')").run(assetId);
    applyPullResponse(local, response, ["math"]);

    const row = local.prepare("SELECT document_id, document_anchor_label FROM question WHERE id = ?").get(q.id) as {
      document_id: string | null; document_anchor_label: string | null;
    };
    expect(row.document_id).toBe(assetId);
    expect(row.document_anchor_label).toBe("p1");
  });

  // Finding 6 — multi-choice pull path.
  it("pulls an MC question's choices with body, is_correct and ordinal intact", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    const q = insertQuestion(canonical, { type: "mc", tags: ["math"] });
    // insertQuestion seeds 2 choices; add a third so ordinals 0..2 are exercised.
    canonical.prepare(
      "INSERT INTO choice (id, question_id, body, is_correct, ordinal) VALUES (?, ?, 'third', 0, 2)"
    ).run(uuidv4(), q.id);

    const response = buildPullResponse(canonical, {
      node_id: "local-1", protocol_version: 1, slices: ["math"], since: null, include_grades_for_node: false,
    });

    const local = openTestDb();
    applyPullResponse(local, response, ["math"]);

    const canonicalChoices = canonical
      .prepare("SELECT id, body, is_correct, ordinal FROM choice WHERE question_id = ? ORDER BY ordinal")
      .all(q.id);
    const localChoices = local
      .prepare("SELECT id, body, is_correct, ordinal FROM choice WHERE question_id = ? ORDER BY ordinal")
      .all(q.id);

    expect(localChoices).toEqual(canonicalChoices);
    expect(localChoices.length).toBe(3);
    expect((localChoices as { is_correct: number }[]).filter((c) => c.is_correct === 1).length).toBe(1);
  });

  // Finding 8 — a frozen template's fixed question set must sync.
  it("syncs a frozen template's template_frozen_question rows exactly", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    for (let i = 0; i < 3; i++) insertQuestion(canonical, { tags: ["math"] });
    const template = createTemplate(canonical, {
      name: "frozen t", tag_query: { all: ["math"] }, question_count: 3, frozen: true,
    });
    const canonicalFrozen = canonical
      .prepare("SELECT question_id, ordinal FROM template_frozen_question WHERE template_id = ? ORDER BY ordinal")
      .all(template.id) as { question_id: string; ordinal: number }[];
    expect(canonicalFrozen.length).toBe(3);

    const response = buildPullResponse(canonical, {
      node_id: "local-1", protocol_version: 1, slices: ["math"], since: null, include_grades_for_node: false,
    });

    const local = openTestDb();
    applyPullResponse(local, response, ["math"]);

    const localFrozen = local
      .prepare("SELECT question_id, ordinal FROM template_frozen_question WHERE template_id = ? ORDER BY ordinal")
      .all(template.id) as { question_id: string; ordinal: number }[];
    expect(localFrozen).toEqual(canonicalFrozen);
  });

  it("re-pulling a re-frozen template replaces the local frozen set rather than duplicating it", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    for (let i = 0; i < 4; i++) insertQuestion(canonical, { tags: ["math"] });
    const template = createTemplate(canonical, {
      name: "frozen t", tag_query: { all: ["math"] }, question_count: 2, frozen: true,
    });

    const local = openTestDb();
    const first = buildPullResponse(canonical, {
      node_id: "local-1", protocol_version: 1, slices: ["math"], since: null, include_grades_for_node: false,
    });
    applyPullResponse(local, first, ["math"]);
    applyPullResponse(local, first, ["math"]); // idempotent replay

    const count = (local.prepare(
      "SELECT COUNT(*) AS n FROM template_frozen_question WHERE template_id = ?"
    ).get(template.id) as { n: number }).n;
    expect(count).toBe(2);
  });
});

describe("applyPushRequest", () => {
  function seedTemplateAndQuestion(db: ReturnType<typeof openTestDb>) {
    insertTag(db, "math");
    const q = insertQuestion(db, { tags: ["math"] });
    return q;
  }

  it("accepts a new attempt+response+grade as one unit", () => {
    const canonical = openTestDb();
    const q = seedTemplateAndQuestion(canonical);

    const result = applyPushRequest(canonical, {
      node_id: "local-1", protocol_version: 1,
      attempts: [{ id: "a1", node_id: "local-1", source: "adhoc", template_id: null, daily_draw_id: null,
                   started_at: "2026-08-20 10:00:00", submitted_at: "2026-08-20 10:05:00", abandoned_at: null, offline: 1 }],
      responses: [{ id: "r1", attempt_id: "a1", question_id: q.id, ordinal: 0, selected_choice_id: null,
                    response_text: null, skipped: 0, answered_at: "2026-08-20 10:04:00", elapsed_ms: 1000 }],
      grades: [{ id: "g1", response_id: "r1", grader: "self", score: 1, feedback: null, rubric_version: null,
                 model_name: null, graded_at: "2026-08-20 10:05:00" }],
    });

    expect(result.accepted.sort()).toEqual(["a1", "g1", "r1"]);
    expect(result.rejected).toEqual([]);
    const row = canonical.prepare("SELECT id FROM attempt WHERE id = ?").get("a1");
    expect(row).toBeTruthy();
  });

  it("replaying the identical push is idempotent — everything comes back duplicate, nothing duplicates", () => {
    const canonical = openTestDb();
    const q = seedTemplateAndQuestion(canonical);
    const payload = {
      node_id: "local-1", protocol_version: 1,
      attempts: [{ id: "a2", node_id: "local-1", source: "adhoc", template_id: null, daily_draw_id: null,
                   started_at: "2026-08-20 10:00:00", submitted_at: "2026-08-20 10:05:00", abandoned_at: null, offline: 1 }],
      responses: [{ id: "r2", attempt_id: "a2", question_id: q.id, ordinal: 0, selected_choice_id: null,
                    response_text: null, skipped: 0, answered_at: "2026-08-20 10:04:00", elapsed_ms: 1000 }],
      grades: [{ id: "g2", response_id: "r2", grader: "self", score: 1, feedback: null, rubric_version: null,
                 model_name: null, graded_at: "2026-08-20 10:05:00" }],
    };

    const first = applyPushRequest(canonical, payload);
    expect(first.accepted.sort()).toEqual(["a2", "g2", "r2"]);

    const second = applyPushRequest(canonical, payload);
    expect(second.duplicate.sort()).toEqual(["a2", "g2", "r2"]);
    expect(second.accepted).toEqual([]);
    expect(second.rejected).toEqual([]);

    const count = (canonical.prepare("SELECT COUNT(*) AS n FROM attempt WHERE id = 'a2'").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("rejects a response referencing an unknown question", () => {
    const canonical = openTestDb();
    const result = applyPushRequest(canonical, {
      node_id: "local-1", protocol_version: 1,
      attempts: [{ id: "a3", node_id: "local-1", source: "adhoc", template_id: null, daily_draw_id: null,
                   started_at: "2026-08-20 10:00:00", submitted_at: null, abandoned_at: null, offline: 1 }],
      responses: [{ id: "r3", attempt_id: "a3", question_id: "does-not-exist", ordinal: 0, selected_choice_id: null,
                    response_text: null, skipped: 0, answered_at: null, elapsed_ms: null }],
      grades: [],
    });

    expect(result.accepted).toContain("a3");
    expect(result.rejected.map((r) => r.id)).toContain("r3");
    expect(result.rejected.find((r) => r.id === "r3")?.reason).toBe("unknown_question_id");
  });

  it("queues a fresh written self-grade for regrade", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    const wq = insertQuestion(canonical, { type: "written", tags: ["math"] });

    const result = applyPushRequest(canonical, {
      node_id: "local-1", protocol_version: 1,
      attempts: [{ id: "a4", node_id: "local-1", source: "adhoc", template_id: null, daily_draw_id: null,
                   started_at: "2026-08-20 10:00:00", submitted_at: "2026-08-20 10:05:00", abandoned_at: null, offline: 1 }],
      responses: [{ id: "r4", attempt_id: "a4", question_id: wq.id, ordinal: 0, selected_choice_id: null,
                    response_text: "because reasons", skipped: 0, answered_at: "2026-08-20 10:04:00", elapsed_ms: 2000 }],
      grades: [{ id: "g4", response_id: "r4", grader: "self", score: 0.5, feedback: null, rubric_version: null,
                 model_name: null, graded_at: "2026-08-20 10:05:00" }],
    });

    expect(result.regrade_queued).toEqual(["r4"]);
  });

  it("queues regrade when a self-grade commits but an accompanying model-grade fails to insert", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    const wq = insertQuestion(canonical, { type: "written", tags: ["math"] });

    const result = applyPushRequest(canonical, {
      node_id: "local-1", protocol_version: 1,
      attempts: [{ id: "a5", node_id: "local-1", source: "adhoc", template_id: null, daily_draw_id: null,
                   started_at: "2026-08-20 10:00:00", submitted_at: "2026-08-20 10:05:00", abandoned_at: null, offline: 1 }],
      responses: [{ id: "r5", attempt_id: "a5", question_id: wq.id, ordinal: 0, selected_choice_id: null,
                    response_text: "because reasons", skipped: 0, answered_at: "2026-08-20 10:04:00", elapsed_ms: 2000 }],
      grades: [
        { id: "g5a", response_id: "r5", grader: "self", score: 0.5, feedback: null, rubric_version: null,
          model_name: null, graded_at: "2026-08-20 10:05:00" },
        // score 5 violates the grade table's CHECK (score BETWEEN 0 AND 1) constraint and fails to insert.
        { id: "g5b", response_id: "r5", grader: "model", score: 5, feedback: null, rubric_version: null,
          model_name: "test-model", graded_at: "2026-08-20 10:05:01" },
      ],
    });

    expect(result.accepted).toContain("g5a");
    expect(result.rejected.map((r) => r.id)).toContain("g5b");
    const gradeRows = canonical.prepare("SELECT grader FROM grade WHERE response_id = ?").all("r5") as { grader: string }[];
    expect(gradeRows.map((r) => r.grader)).toEqual(["self"]);
    // Canonical only has a self-grade for r5 (the model-grade never committed), so it should be queued.
    expect(result.regrade_queued).toEqual(["r5"]);
  });

  it("does not queue regrade when a response's only grade fails to insert entirely", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    const wq = insertQuestion(canonical, { type: "written", tags: ["math"] });

    const result = applyPushRequest(canonical, {
      node_id: "local-1", protocol_version: 1,
      attempts: [{ id: "a6", node_id: "local-1", source: "adhoc", template_id: null, daily_draw_id: null,
                   started_at: "2026-08-20 10:00:00", submitted_at: "2026-08-20 10:05:00", abandoned_at: null, offline: 1 }],
      responses: [{ id: "r6", attempt_id: "a6", question_id: wq.id, ordinal: 0, selected_choice_id: null,
                    response_text: "because reasons", skipped: 0, answered_at: "2026-08-20 10:04:00", elapsed_ms: 2000 }],
      grades: [
        // score 5 violates the grade table's CHECK (score BETWEEN 0 AND 1) constraint and fails to insert.
        { id: "g6", response_id: "r6", grader: "self", score: 5, feedback: null, rubric_version: null,
          model_name: null, graded_at: "2026-08-20 10:05:00" },
      ],
    });

    expect(result.accepted).toContain("r6");
    expect(result.rejected.map((r) => r.id)).toContain("g6");
    const gradeCount = (canonical.prepare("SELECT COUNT(*) AS n FROM grade WHERE response_id = ?").get("r6") as { n: number }).n;
    expect(gradeCount).toBe(0);
    // Canonical has zero grades for r6, so it should not be queued.
    expect(result.regrade_queued).toEqual([]);
  });

  // Finding 7B — a supersede must propagate, and must land before the new
  // live grade so grade_one_live_per_response has a free slot.
  it("applies an incoming supersede then inserts the new live grade, in either array order", () => {
    for (const order of ["old-first", "new-first"] as const) {
      const canonical = openTestDb();
      insertTag(canonical, "math");
      const wq = insertQuestion(canonical, { type: "written", tags: ["math"] });

      // First push: attempt + response + the original live grade.
      const firstPush = applyPushRequest(canonical, {
        node_id: "local-1", protocol_version: 1,
        attempts: [{ id: `sa-${order}`, node_id: "local-1", source: "adhoc", template_id: null, daily_draw_id: null,
                     started_at: "2026-08-20 10:00:00", submitted_at: "2026-08-20 10:05:00", abandoned_at: null, offline: 1 }],
        responses: [{ id: `sr-${order}`, attempt_id: `sa-${order}`, question_id: wq.id, ordinal: 0,
                      selected_choice_id: null, response_text: "answer", skipped: 0,
                      answered_at: "2026-08-20 10:04:00", elapsed_ms: 1000 }],
        grades: [{ id: `sg-old-${order}`, response_id: `sr-${order}`, grader: "self", score: 0, feedback: null,
                   rubric_version: null, model_name: null, graded_at: "2026-08-20 10:05:00", superseded_at: null }],
      });
      expect(firstPush.rejected).toEqual([]);

      // Second push: the now-superseded old grade AND the new live grade —
      // exactly what the outbox holds after gradeResponse's override path.
      const oldGrade = { id: `sg-old-${order}`, response_id: `sr-${order}`, grader: "self", score: 0, feedback: null,
                         rubric_version: null, model_name: null, graded_at: "2026-08-20 10:05:00",
                         superseded_at: "2026-08-20 10:10:00" };
      const newGrade = { id: `sg-new-${order}`, response_id: `sr-${order}`, grader: "self", score: 1, feedback: null,
                         rubric_version: null, model_name: null, graded_at: "2026-08-20 10:10:00", superseded_at: null };

      const result = applyPushRequest(canonical, {
        node_id: "local-1", protocol_version: 1, attempts: [], responses: [],
        grades: order === "old-first" ? [oldGrade, newGrade] : [newGrade, oldGrade],
      });

      // No rejections — this is the bug: the new grade used to hit
      // grade_one_live_per_response and come back rejected: insert_failed.
      expect(result.rejected).toEqual([]);
      expect(result.accepted.sort()).toEqual([`sg-new-${order}`, `sg-old-${order}`].sort());

      // The NEW score is authoritative on canonical.
      const live = canonical.prepare(
        "SELECT id, score FROM grade WHERE response_id = ? AND superseded_at IS NULL"
      ).get(`sr-${order}`) as { id: string; score: number };
      expect(live.id).toBe(`sg-new-${order}`);
      expect(live.score).toBe(1);

      // The OLD grade row still exists, correctly marked superseded.
      const old = canonical.prepare("SELECT superseded_at FROM grade WHERE id = ?").get(`sg-old-${order}`) as {
        superseded_at: string | null;
      };
      expect(old.superseded_at).toBe("2026-08-20 10:10:00");
    }
  });

  it("reports an unchanged existing grade as duplicate, not accepted", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    const wq = insertQuestion(canonical, { type: "written", tags: ["math"] });
    const payload = {
      node_id: "local-1", protocol_version: 1,
      attempts: [{ id: "dup-a", node_id: "local-1", source: "adhoc", template_id: null, daily_draw_id: null,
                   started_at: "2026-08-20 10:00:00", submitted_at: "2026-08-20 10:05:00", abandoned_at: null, offline: 1 }],
      responses: [{ id: "dup-r", attempt_id: "dup-a", question_id: wq.id, ordinal: 0, selected_choice_id: null,
                    response_text: "a", skipped: 0, answered_at: "2026-08-20 10:04:00", elapsed_ms: 1 }],
      grades: [{ id: "dup-g", response_id: "dup-r", grader: "self", score: 1, feedback: null, rubric_version: null,
                 model_name: null, graded_at: "2026-08-20 10:05:00", superseded_at: null }],
    };
    applyPushRequest(canonical, payload);
    const second = applyPushRequest(canonical, payload);

    expect(second.duplicate).toContain("dup-g");
    expect(second.accepted).not.toContain("dup-g");
  });
});

describe("slice management", () => {
  it("addSlice inserts a local_slice row and is idempotent", () => {
    const db = openTestDb();
    addSlice(db, "math");
    const first = db.prepare("SELECT pulled_at FROM local_slice WHERE tag_slug = 'math'").get() as { pulled_at: string };
    expect(first).toBeTruthy();
    addSlice(db, "math"); // idempotent re-add
    const count = (db.prepare("SELECT COUNT(*) AS n FROM local_slice WHERE tag_slug = 'math'").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("addSlice succeeds on a fresh node with no local tag row, stubbing the tag to satisfy the FK", () => {
    const db = openTestDb();
    // No insertTag: this is exactly the fresh-local-node case. local_slice.tag_slug
    // FKs to tag(slug), so without a self-healing stub this throws
    // "FOREIGN KEY constraint failed".
    expect(() => addSlice(db, "brandnew")).not.toThrow();

    const tag = db.prepare("SELECT slug, label, parent_slug, description FROM tag WHERE slug = 'brandnew'").get() as {
      slug: string; label: string; parent_slug: string | null; description: string | null;
    };
    expect(tag).toBeTruthy();
    expect(tag.label).toBe("brandnew");
    expect(tag.parent_slug).toBeNull();
    expect(tag.description).toBeNull();

    // Recorded but never pulled — the sentinel, not a real timestamp.
    const slice = db.prepare("SELECT pulled_at, question_count FROM local_slice WHERE tag_slug = 'brandnew'").get() as {
      pulled_at: string; question_count: number;
    };
    expect(slice.pulled_at).toBe(NEVER_PULLED);
    expect(slice.question_count).toBe(0);
  });

  it("a pull's tag upsert transparently replaces the stub tag with real data", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math", null, "The study of numbers.");
    insertQuestion(canonical, { tags: ["math"] });
    const response = buildPullResponse(canonical, {
      node_id: "local-1", protocol_version: 1, slices: ["math"], since: null, include_grades_for_node: false,
    });

    const local = openTestDb();
    addSlice(local, "math"); // creates the stub (label = slug, description null)
    applyPullResponse(local, response, ["math"]);

    const tag = local.prepare("SELECT label, description FROM tag WHERE slug = 'math'").get() as {
      label: string; description: string | null;
    };
    expect(tag.label).toBe("math");
    expect(tag.description).toBe("The study of numbers.");
  });

  it("removeSlice deletes the row and prunes questions no local response references", () => {
    const db = openTestDb();
    insertTag(db, "math");
    const orphan = insertQuestion(db, { tags: ["math"] });
    const referenced = insertQuestion(db, { tags: ["math"] });
    addSlice(db, "math");
    // simulate a local response referencing `referenced`
    db.prepare("INSERT INTO attempt (id, node_id, source, started_at) VALUES ('a1','n1','adhoc',datetime('now'))").run();
    db.prepare("INSERT INTO response (id, attempt_id, question_id, ordinal) VALUES ('r1','a1',?,0)").run(referenced.id);

    const result = removeSlice(db, "math");

    expect(result.pruned_questions).toBe(1);
    expect(db.prepare("SELECT id FROM question WHERE id = ?").get(orphan.id)).toBeUndefined();
    expect(db.prepare("SELECT id FROM question WHERE id = ?").get(referenced.id)).toBeTruthy();
    expect(db.prepare("SELECT tag_slug FROM local_slice WHERE tag_slug = 'math'").get()).toBeUndefined();
  });

  // Finding 9a — overlapping slices must not gut each other.
  it("removeSlice keeps a question also covered by another still-held slice", () => {
    const db = openTestDb();
    insertTag(db, "math");
    insertTag(db, "physics");
    const shared = insertQuestion(db, { tags: ["math", "physics"] });
    const mathOnly = insertQuestion(db, { tags: ["math"] });
    addSlice(db, "math");
    addSlice(db, "physics");

    const result = removeSlice(db, "math");

    // Only the math-only question is pruned; the shared one belongs to the
    // still-held physics slice.
    expect(result.pruned_questions).toBe(1);
    expect(db.prepare("SELECT id FROM question WHERE id = ?").get(shared.id)).toBeTruthy();
    expect(db.prepare("SELECT id FROM question WHERE id = ?").get(mathOnly.id)).toBeUndefined();
    expect(db.prepare("SELECT tag_slug FROM local_slice WHERE tag_slug = 'physics'").get()).toBeTruthy();
    expect(db.prepare("SELECT tag_slug FROM local_slice WHERE tag_slug = 'math'").get()).toBeUndefined();
  });

  it("removeSlice's other-slice check matches descendants too", () => {
    const db = openTestDb();
    insertTag(db, "math");
    insertTag(db, "physics");
    insertTag(db, "physics:optics", "physics");
    const shared = insertQuestion(db, { tags: ["math", "physics:optics"] });
    addSlice(db, "math");
    addSlice(db, "physics"); // holds physics:optics by descendant expansion

    const result = removeSlice(db, "math");

    expect(result.pruned_questions).toBe(0);
    expect(db.prepare("SELECT id FROM question WHERE id = ?").get(shared.id)).toBeTruthy();
  });

  // Finding 13 — RESTRICT-protected questions must never be prune candidates.
  it("removeSlice skips questions referenced by template_frozen_question or daily_draw_question", () => {
    const db = openTestDb();
    insertTag(db, "math");
    const frozenQ = insertQuestion(db, { tags: ["math"] });
    const dailyQ = insertQuestion(db, { tags: ["math"] });
    const orphan = insertQuestion(db, { tags: ["math"] });
    addSlice(db, "math");

    const template = createTemplate(db, { name: "t", tag_query: { all: ["math"] }, question_count: 1 });
    db.prepare("DELETE FROM template_frozen_question WHERE template_id = ?").run(template.id);
    db.prepare(
      "INSERT INTO template_frozen_question (template_id, question_id, ordinal) VALUES (?, ?, 0)"
    ).run(template.id, frozenQ.id);

    db.prepare("INSERT INTO daily_draw (id, draw_date, kind) VALUES ('dd1', '2026-08-20', 'quiz')").run();
    db.prepare(
      "INSERT INTO daily_draw_question (daily_draw_id, question_id, ordinal) VALUES ('dd1', ?, 0)"
    ).run(dailyQ.id);

    // Previously this raised FOREIGN KEY constraint failed and rolled back.
    let result: { pruned_questions: number };
    expect(() => { result = removeSlice(db, "math"); }).not.toThrow();

    expect(result!.pruned_questions).toBe(1);
    expect(db.prepare("SELECT id FROM question WHERE id = ?").get(frozenQ.id)).toBeTruthy();
    expect(db.prepare("SELECT id FROM question WHERE id = ?").get(dailyQ.id)).toBeTruthy();
    expect(db.prepare("SELECT id FROM question WHERE id = ?").get(orphan.id)).toBeUndefined();
    expect(db.prepare("SELECT tag_slug FROM local_slice WHERE tag_slug = 'math'").get()).toBeUndefined();
  });
});
