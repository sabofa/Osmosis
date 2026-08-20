import { describe, it, expect } from "vitest";
import { buildPullResponse, applyPullResponse, applyPushRequest, addSlice, removeSlice } from "../src/domain/sync.js";
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
});

describe("slice management", () => {
  it("addSlice inserts a local_slice row, refreshing pulled_at if it already exists", () => {
    const db = openTestDb();
    insertTag(db, "math"); // local_slice.tag_slug FKs to tag(slug)
    addSlice(db, "math");
    const first = db.prepare("SELECT pulled_at FROM local_slice WHERE tag_slug = 'math'").get() as { pulled_at: string };
    expect(first).toBeTruthy();
    addSlice(db, "math"); // idempotent re-add
    const count = (db.prepare("SELECT COUNT(*) AS n FROM local_slice WHERE tag_slug = 'math'").get() as { n: number }).n;
    expect(count).toBe(1);
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
});
