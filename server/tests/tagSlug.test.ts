import { describe, it, expect } from "vitest";
import { isValidSlug, createTag } from "../src/domain/tags.js";
import { openTestDb } from "./helpers.js";
import { DomainError } from "../src/domain/errors.js";

// Textbook taxonomies number their sections ("2.4 Atomic Weight"), and the
// tutor mirrors that numbering in the slug. A dot is a word separator inside
// a segment, exactly like "_": between alphanumerics, never leading, never
// trailing, never doubled.
describe("tag slug grammar allows dots inside a segment", () => {
  it("accepts a section-numbered slug", () => {
    expect(isValidSlug("node:ebbing11e:2.4:atomic_weight")).toBe(true);
  });

  it.each(["a.b", "a.b.c", "a_b.c", "2.4", "x:1.2_3"])("accepts %s", (slug) => {
    expect(isValidSlug(slug)).toBe(true);
  });

  it.each(["a..b", ".a", "a.", "a-b", "a:.b", "a.:b", "A.b"])("rejects %s", (slug) => {
    expect(isValidSlug(slug)).toBe(false);
  });

  it("create_tag accepts a dotted slug and rejects a doubled dot", () => {
    const db = openTestDb();
    const tag = createTag(db, { slug: "node:ebbing11e:2.4:atomic_weight", label: "Atomic weight" });
    expect(tag.slug).toBe("node:ebbing11e:2.4:atomic_weight");

    let caught: unknown;
    try {
      createTag(db, { slug: "node:a..b", label: "bad" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe("invalid_slug_format");
  });
});
