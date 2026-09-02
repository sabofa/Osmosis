import { describe, it, expect } from "vitest";
import { openTestDb, insertTag } from "./helpers.js";
import { listTags, countTags } from "../src/domain/tags.js";
import { trimListTagsForMcp } from "../src/mcp/tools.js";

describe("listTags pagination", () => {
  it("returns everything, unbounded, when no limit/offset is passed", () => {
    const db = openTestDb();
    for (const slug of ["a", "b", "c"]) insertTag(db, slug);
    expect(listTags(db)).toHaveLength(3);
  });

  it("returns a bounded page when limit/offset are passed", () => {
    const db = openTestDb();
    for (const slug of ["a", "b", "c"]) insertTag(db, slug);
    const page1 = listTags(db, { limit: 2, offset: 0 });
    const page2 = listTags(db, { limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(1);
  });
});

describe("countTags", () => {
  it("mirrors listTags's WHERE clause (excludes retired by default)", () => {
    const db = openTestDb();
    insertTag(db, "a");
    insertTag(db, "b");
    db.prepare("UPDATE tag SET retired_at = datetime('now') WHERE slug = 'b'").run();
    expect(countTags(db)).toBe(1);
    expect(countTags(db, { includeRetired: true })).toBe(2);
  });
});

describe("list_tags MCP trim precondition", () => {
  it("retired_at and description are null by default for a freshly-created tag", () => {
    const db = openTestDb();
    insertTag(db, "a", null, null);
    const tags = listTags(db);
    expect(tags[0].retired_at).toBeNull();
    expect(tags[0].description).toBeNull();
  });
});

describe("trimListTagsForMcp", () => {
  it("omits retired_at and description when both are null", () => {
    const db = openTestDb();
    insertTag(db, "a", null, null);
    const trimmed = trimListTagsForMcp(listTags(db));
    expect(trimmed[0]).not.toHaveProperty("retired_at");
    expect(trimmed[0]).not.toHaveProperty("description");
    expect(trimmed[0]).toMatchObject({ slug: "a", label: "a", question_count: 0 });
  });

  it("keeps retired_at and description when they are set", () => {
    const db = openTestDb();
    insertTag(db, "a", null, "a description");
    db.prepare("UPDATE tag SET retired_at = datetime('now') WHERE slug = 'a'").run();
    const trimmed = trimListTagsForMcp(listTags(db, { includeRetired: true }));
    expect(trimmed[0]).toHaveProperty("retired_at");
    expect(trimmed[0]).toMatchObject({ description: "a description" });
  });
});
