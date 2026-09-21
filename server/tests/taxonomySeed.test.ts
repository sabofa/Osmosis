import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { bootstrap } from "../src/domain/bootstrap.js";
import { seedForSubject, TAXONOMY_SEEDS } from "../src/domain/taxonomies/index.js";
import { isValidSlug } from "../src/domain/tags.js";

describe("taxonomy seeds", () => {
  it("every shipped seed slug is valid under the tag grammar and every parent is present", () => {
    for (const seed of Object.values(TAXONOMY_SEEDS)) {
      const slugs = new Set(seed.tags.map((t) => t.slug));
      expect(isValidSlug(seed.subject)).toBe(true);
      for (const tag of seed.tags) {
        expect(isValidSlug(tag.slug), tag.slug).toBe(true);
        if (tag.parent_slug) expect(slugs.has(tag.parent_slug) || tag.parent_slug === seed.subject).toBe(true);
      }
    }
  });

  it("resolves a seed from any slug under the subject's root segment", () => {
    expect(seedForSubject("chemistry")?.subject).toBe("chemistry");
    expect(seedForSubject("chemistry:gases")?.subject).toBe("chemistry");
    expect(seedForSubject("math")?.subject).toBe("math");
    expect(seedForSubject("english")).toBeUndefined();
    expect(seedForSubject(null)).toBeUndefined();
  });
});

describe("bootstrap taxonomy block", () => {
  it("reports an empty but seedable subject", () => {
    const db = openTestDb();
    const result = bootstrap(db, "chemistry");
    expect(result.taxonomy).toEqual({ seeded: false, seed_available: true, tag_count: 0 });
    expect(result.tags).toEqual([]);
  });

  it("reports a subject with no seed available", () => {
    const db = openTestDb();
    expect(bootstrap(db, "english").taxonomy).toEqual({ seeded: false, seed_available: false, tag_count: 0 });
  });

  it("creates the subject root and every seed tag when asked", () => {
    const db = openTestDb();
    const result = bootstrap(db, "chemistry", { seed: true });
    expect(result.taxonomy.seeded).toBe(true);
    expect(result.taxonomy.seed_available).toBe(true);
    expect(result.taxonomy.tag_count).toBe(13);

    const slugs = result.tags.map((t) => t.slug);
    expect(slugs).toContain("chemistry");
    expect(slugs).toContain("chemistry:stoichiometry");
    expect(slugs).toContain("chemistry:molecular_geometry");

    // The tech: tags come with the seed but live outside the subject subtree,
    // so they are created without inflating the subject's tag_count.
    const tech = db.prepare("SELECT slug FROM tag WHERE slug LIKE 'tech:%' ORDER BY slug").all() as {
      slug: string;
    }[];
    expect(tech.map((t) => t.slug)).toEqual(["tech:calculator", "tech:mhchem"]);

    const root = db.prepare("SELECT label, parent_slug FROM tag WHERE slug = 'chemistry'").get() as {
      label: string;
      parent_slug: string | null;
    };
    expect(root.label).toBe("Chemistry");
    expect(root.parent_slug).toBeNull();
    const child = db.prepare("SELECT parent_slug FROM tag WHERE slug = 'chemistry:gases'").get() as {
      parent_slug: string;
    };
    expect(child.parent_slug).toBe("chemistry");
  });

  it("is idempotent — a second seed call creates nothing new", () => {
    const db = openTestDb();
    bootstrap(db, "chemistry", { seed: true });
    const before = (db.prepare("SELECT COUNT(*) AS n FROM tag").get() as { n: number }).n;

    const again = bootstrap(db, "chemistry", { seed: true });
    expect(again.taxonomy.seeded).toBe(false);
    expect(again.taxonomy.tag_count).toBe(13);

    const after = (db.prepare("SELECT COUNT(*) AS n FROM tag").get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it("seeds mathematics under its existing math root slug", () => {
    const db = openTestDb();
    const result = bootstrap(db, "math", { seed: true });
    expect(result.taxonomy.seeded).toBe(true);
    const slugs = result.tags.map((t) => t.slug);
    expect(slugs).toEqual([
      "math",
      "math:algebra",
      "math:counting_probability",
      "math:geometry",
      "math:number_theory",
    ]);
  });

  it("does nothing when seed is asked for a subject with no seed", () => {
    const db = openTestDb();
    const result = bootstrap(db, "english", { seed: true });
    expect(result.taxonomy).toEqual({ seeded: false, seed_available: false, tag_count: 0 });
    expect((db.prepare("SELECT COUNT(*) AS n FROM tag").get() as { n: number }).n).toBe(0);
  });

  it("counts an existing subject's tags without seeding when seed is not asked", () => {
    const db = openTestDb();
    bootstrap(db, "chemistry", { seed: true });
    const plain = bootstrap(db, "chemistry");
    expect(plain.taxonomy).toEqual({ seeded: false, seed_available: true, tag_count: 13 });
  });
});
