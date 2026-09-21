import { describe, it, expect } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { buildPullResponse, applyPullResponse } from "../src/domain/sync.js";
import { createQuestions, editQuestion } from "../src/domain/questions.js";
import { createTemplate, retireTemplate } from "../src/domain/templates.js";
import { mergeTags } from "../src/domain/tags.js";
import { gradeResponseByTutor } from "../src/domain/attempts.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";

const NODE = "local-1";

function pull(canonical: ReturnType<typeof openTestDb>, slices: string[], since: string | null, grades = false) {
  return buildPullResponse(canonical, {
    node_id: NODE,
    protocol_version: 1,
    slices,
    since,
    include_grades_for_node: grades,
  });
}

// Every test here is about the *incremental* pull (since != null). A full
// pull re-sends everything, so it can't expose a since-clause gap — these
// gaps only bite a local node that has already synced once, which is every
// local node after its first successful runSync.
describe("incremental pull: changes that must survive a since-cursor", () => {
  it("an in-place edit (question with no attempts) reaches a local node on the next incremental pull", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    const created = createQuestions(canonical, [
      { type: "written", prompt: "original prompt", tags: ["math"], model_answer: "42" },
    ]).created[0];

    const local = openTestDb();
    const first = pull(canonical, ["math"], null);
    applyPullResponse(local, first, ["math"]);

    // No attempts exist, so this edits in place: same id, no new version, no
    // created_at/retired_at change — exactly the shape the old since-clause
    // could not see.
    const edited = editQuestion(canonical, created.id, { prompt: "corrected prompt" });
    expect(edited.versioned).toBe(false);

    const second = pull(canonical, ["math"], first.cursor);
    expect(second.questions.map((q) => q.id)).toContain(created.id);

    applyPullResponse(local, second, ["math"]);
    const row = local.prepare("SELECT prompt FROM question WHERE id = ?").get(created.id) as { prompt: string };
    expect(row.prompt).toBe("corrected prompt");
  });

  it("merge_tags repointing a question's tags reaches a local node on the next incremental pull", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    insertTag(canonical, "math:old", "math");
    insertTag(canonical, "math:new", "math");
    const q = insertQuestion(canonical, { tags: ["math:old"] });

    const local = openTestDb();
    const first = pull(canonical, ["math"], null);
    applyPullResponse(local, first, ["math"]);

    mergeTags(canonical, "math:old", "math:new");

    const second = pull(canonical, ["math"], first.cursor);
    expect(second.questions.map((r) => r.id)).toContain(q.id);

    applyPullResponse(local, second, ["math"]);
    const tags = (
      local.prepare("SELECT tag_slug FROM question_tag WHERE question_id = ?").all(q.id) as { tag_slug: string }[]
    ).map((r) => r.tag_slug);
    expect(tags).toEqual(["math:new"]);
  });

  it("a template retired on canonical is retired on the local node after the next pull", () => {
    const canonical = openTestDb();
    insertTag(canonical, "math");
    insertQuestion(canonical, { tags: ["math"] });
    const template = createTemplate(canonical, { name: "t", tag_query: { all: ["math"] }, question_count: 1 });

    const local = openTestDb();
    applyPullResponse(local, pull(canonical, ["math"], null), ["math"]);
    expect(local.prepare("SELECT retired_at FROM template WHERE id = ?").get(template.id)).toEqual({ retired_at: null });

    retireTemplate(canonical, template.id);

    const second = pull(canonical, ["math"], "1970-01-01 00:00:00");
    applyPullResponse(local, second, ["math"]);
    const row = local.prepare("SELECT retired_at FROM template WHERE id = ?").get(template.id) as {
      retired_at: string | null;
    };
    expect(row.retired_at).not.toBeNull();
  });

  // The supersede of an OLD self-grade is itself a change: without it the
  // incoming model grade collides with the still-live self-grade on the
  // local's grade_one_live_per_response index, the whole pull rolls back,
  // and sync is jammed on every subsequent run. syncDurability's test 8
  // covers this only when the self-grade's graded_at happens to fall inside
  // the since window; a grade pushed days before the model sweep does not.
  it("a tutor grade superseding an old self-grade applies cleanly on an incremental pull", () => {
    const canonical = openTestDb();
    insertTag(canonical, "w");
    const q = insertQuestion(canonical, { type: "written", tags: ["w"] });

    const local = openTestDb();
    applyPullResponse(local, pull(canonical, ["w"], null), ["w"]);

    // The same attempt/response/self-grade on both sides, as if the local had
    // pushed it up long ago (graded_at well before the incremental cursor).
    const attemptId = uuidv4();
    const responseId = uuidv4();
    const selfGradeId = uuidv4();
    for (const db of [canonical, local]) {
      db.prepare(
        "INSERT INTO attempt (id, node_id, source, started_at, submitted_at) VALUES (?, ?, 'adhoc', '2026-01-01 00:00:00', '2026-01-01 00:00:00')"
      ).run(attemptId, NODE);
      db.prepare(
        "INSERT INTO response (id, attempt_id, question_id, ordinal, response_text, answered_at) VALUES (?, ?, ?, 0, 'ans', '2026-01-01 00:00:00')"
      ).run(responseId, attemptId, q.id);
      db.prepare(
        "INSERT INTO grade (id, response_id, grader, score, graded_at) VALUES (?, ?, 'self', 0.5, '2026-01-01 00:00:00')"
      ).run(selfGradeId, responseId);
    }

    gradeResponseByTutor(canonical, responseId, { grader: "judge", score: 0.9 });

    const incremental = pull(canonical, ["w"], "2026-06-01 00:00:00", true);
    expect(incremental.grades.map((g) => g.id)).toContain(selfGradeId);

    expect(() => applyPullResponse(local, incremental, ["w"])).not.toThrow();
    const live = local
      .prepare("SELECT grader FROM grade WHERE response_id = ? AND superseded_at IS NULL")
      .get(responseId) as { grader: string };
    expect(live.grader).toBe("judge");
  });
});
