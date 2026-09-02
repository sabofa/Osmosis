import { describe, it, expect } from "vitest";
import { openTestDb, insertTag } from "./helpers.js";
import { createTemplate, listTemplates, countTemplates } from "../src/domain/templates.js";

describe("listTemplates pagination", () => {
  it("returns everything, unbounded, when no limit/offset is passed", () => {
    const db = openTestDb();
    insertTag(db, "a");
    for (let i = 0; i < 3; i++) {
      createTemplate(db, { name: `Template ${i}`, tag_query: { all: ["a"] }, question_count: 5 });
    }
    expect(listTemplates(db)).toHaveLength(3);
  });

  it("returns a bounded page when limit/offset are passed", () => {
    const db = openTestDb();
    insertTag(db, "a");
    for (let i = 0; i < 3; i++) {
      createTemplate(db, { name: `Template ${i}`, tag_query: { all: ["a"] }, question_count: 5 });
    }
    expect(listTemplates(db, { limit: 2, offset: 0 })).toHaveLength(2);
    expect(listTemplates(db, { limit: 2, offset: 2 })).toHaveLength(1);
  });
});

describe("countTemplates", () => {
  it("counts templates matching the same default (non-retired) filter as listTemplates", () => {
    const db = openTestDb();
    insertTag(db, "a");
    createTemplate(db, { name: "T1", tag_query: { all: ["a"] }, question_count: 5 });
    expect(countTemplates(db)).toBe(1);
  });
});
