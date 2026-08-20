import { describe, it, expect } from "vitest";
import { buildPullResponse, applyPullResponse } from "../src/domain/sync.js";
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
