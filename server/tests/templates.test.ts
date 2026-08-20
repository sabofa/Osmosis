import { describe, it, expect } from "vitest";
import {
  createTemplate,
  editTemplate,
  listTemplates,
  retireTemplate,
  getTemplateDetail,
  downloadTemplate,
  deleteLocalTemplate,
} from "../src/domain/templates.js";
import { DomainError } from "../src/domain/errors.js";
import { insertTag, insertQuestion, openTestDb } from "./helpers.js";

describe("createTemplate", () => {
  it("reports eligible_count and short when the pool is too small", () => {
    const db = openTestDb();
    insertTag(db, "a");
    insertQuestion(db, { tags: ["a"] });
    insertQuestion(db, { tags: ["a"] });

    const result = createTemplate(db, { name: "t", tag_query: { all: ["a"] }, question_count: 5 });

    expect(result.eligible_count).toBe(2);
    expect(result.short).toBe(true);
  });

  it("frozen: true resolves and locks a draw immediately", () => {
    const db = openTestDb();
    insertTag(db, "a");
    insertQuestion(db, { tags: ["a"] });
    insertQuestion(db, { tags: ["a"] });
    insertQuestion(db, { tags: ["a"] });

    const result = createTemplate(db, {
      name: "frozen-t",
      tag_query: { all: ["a"] },
      question_count: 2,
      frozen: true,
    });

    const frozenRows = db
      .prepare("SELECT question_id FROM template_frozen_question WHERE template_id = ?")
      .all(result.id) as { question_id: string }[];

    expect(frozenRows.length).toBe(2);
  });
});

describe("editTemplate", () => {
  it("requires confirm_refreeze to change a frozen template's tag_query", () => {
    const db = openTestDb();
    insertTag(db, "a");
    insertTag(db, "b");
    insertQuestion(db, { tags: ["a"] });
    insertQuestion(db, { tags: ["b"] });

    const created = createTemplate(db, {
      name: "frozen-t",
      tag_query: { all: ["a"] },
      question_count: 1,
      frozen: true,
    });

    expect(() => editTemplate(db, created.id, { tag_query: { all: ["b"] } })).toThrow(DomainError);

    const edited = editTemplate(db, created.id, { tag_query: { all: ["b"] }, confirm_refreeze: true });
    expect(edited.eligible_count).toBe(1);

    const frozenRows = db
      .prepare(
        `SELECT q.id FROM template_frozen_question tfq JOIN question q ON q.id = tfq.question_id WHERE tfq.template_id = ?`
      )
      .all(created.id) as { id: string }[];
    const tags = db.prepare("SELECT tag_slug FROM question_tag WHERE question_id = ?").all(frozenRows[0].id) as {
      tag_slug: string;
    }[];
    expect(tags.map((t) => t.tag_slug)).toEqual(["b"]);
  });

  it("does not require confirm_refreeze for params that don't affect the frozen set", () => {
    const db = openTestDb();
    insertTag(db, "a");
    insertQuestion(db, { tags: ["a"] });

    const created = createTemplate(db, {
      name: "frozen-t",
      tag_query: { all: ["a"] },
      question_count: 1,
      frozen: true,
    });

    expect(() => editTemplate(db, created.id, { description: "updated" })).not.toThrow();
  });
});

describe("template download (slice-backed)", () => {
  it("downloading a template adds a local_slice row per referenced tag literal", () => {
    const db = openTestDb();
    insertTag(db, "math");
    insertTag(db, "history");
    insertQuestion(db, { tags: ["math"] });
    const template = createTemplate(db, { name: "t", tag_query: { all: ["math"], none: ["history"] }, question_count: 1 });

    downloadTemplate(db, template.id);

    const slices = (db.prepare("SELECT tag_slug FROM local_slice ORDER BY tag_slug").all() as { tag_slug: string }[])
      .map((r) => r.tag_slug);
    expect(slices).toEqual(["history", "math"]); // both `all` and `none` literals get added — matches spec's "one slice per referenced tag literal"
  });

  it("a template is 'downloaded' once every referenced slice exists locally", () => {
    const db = openTestDb();
    insertTag(db, "math");
    const template = createTemplate(db, { name: "t", tag_query: { all: ["math"] }, question_count: 1 });

    expect(getTemplateDetail(db, template.id).downloaded).toBe(false);
    downloadTemplate(db, template.id);
    expect(getTemplateDetail(db, template.id).downloaded).toBe(true);
  });

  it("deleteLocalTemplate removes the referenced slices", () => {
    const db = openTestDb();
    insertTag(db, "math");
    const template = createTemplate(db, { name: "t", tag_query: { all: ["math"] }, question_count: 1 });
    downloadTemplate(db, template.id);

    deleteLocalTemplate(db, template.id);

    expect(getTemplateDetail(db, template.id).downloaded).toBe(false);
    expect(db.prepare("SELECT tag_slug FROM local_slice WHERE tag_slug = 'math'").get()).toBeUndefined();
  });

  // Finding 9b — deleting one template's download must not remove a slice
  // another still-downloaded template needs.
  it("deleteLocalTemplate keeps a shared literal's slice when another downloaded template still needs it", () => {
    const db = openTestDb();
    insertTag(db, "math");
    const q = insertQuestion(db, { tags: ["math"] });
    const a = createTemplate(db, { name: "a", tag_query: { all: ["math"] }, question_count: 1 });
    const b = createTemplate(db, { name: "b", tag_query: { all: ["math"] }, question_count: 1 });
    downloadTemplate(db, a.id);
    downloadTemplate(db, b.id);

    deleteLocalTemplate(db, a.id);

    // The math slice survives — template b still needs it — and so do its questions.
    expect(db.prepare("SELECT tag_slug FROM local_slice WHERE tag_slug = 'math'").get()).toBeTruthy();
    expect(db.prepare("SELECT id FROM question WHERE id = ?").get(q.id)).toBeTruthy();
    expect(getTemplateDetail(db, b.id).downloaded).toBe(true);

    // Known consequence of `downloaded` being derived purely from slice
    // presence (there is no local_template marker table since migration 007):
    // while two templates reference an identical literal set, neither's
    // delete-download can free the shared slice, because the other always
    // still reads as downloaded. Removing the slice directly (Settings ->
    // remove slice) is the escape hatch.
    deleteLocalTemplate(db, b.id);
    expect(db.prepare("SELECT tag_slug FROM local_slice WHERE tag_slug = 'math'").get()).toBeTruthy();
  });

  it("deleteLocalTemplate still removes literals no other downloaded template needs", () => {
    const db = openTestDb();
    insertTag(db, "math");
    insertTag(db, "physics");
    const a = createTemplate(db, { name: "a", tag_query: { all: ["math", "physics"] }, question_count: 1 });
    const b = createTemplate(db, { name: "b", tag_query: { all: ["math"] }, question_count: 1 });
    downloadTemplate(db, a.id);
    downloadTemplate(db, b.id);

    deleteLocalTemplate(db, a.id);

    expect(db.prepare("SELECT tag_slug FROM local_slice WHERE tag_slug = 'math'").get()).toBeTruthy();
    expect(db.prepare("SELECT tag_slug FROM local_slice WHERE tag_slug = 'physics'").get()).toBeUndefined();
  });

  it("downloading a template with an empty tag_query throws instead of silently no-op'ing", () => {
    const db = openTestDb();
    const template = createTemplate(db, { name: "t", tag_query: {}, question_count: 1 });

    expect(() => downloadTemplate(db, template.id)).toThrow(DomainError);
  });
});

describe("retireTemplate", () => {
  it("soft-retires and excludes from the default listing", () => {
    const db = openTestDb();
    const created = createTemplate(db, { name: "t", tag_query: {}, question_count: 1 });

    retireTemplate(db, created.id);

    expect(listTemplates(db).map((t) => t.id)).not.toContain(created.id);
    expect(listTemplates(db, { includeRetired: true }).map((t) => t.id)).toContain(created.id);
    expect(() => retireTemplate(db, created.id)).toThrow(DomainError);
  });
});
