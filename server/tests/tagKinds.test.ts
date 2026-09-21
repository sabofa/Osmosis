import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { listTags, mergeTags, tagKind } from "../src/domain/tags.js";
import { readme } from "../src/domain/readme.js";

function seedKinds(db: ReturnType<typeof openTestDb>) {
  insertTag(db, "chemistry");
  insertTag(db, "chemistry:gases", "chemistry");
  insertTag(db, "topic:acids");
  insertTag(db, "tech:mhchem");
  insertTag(db, "node:ebbing11e:2.4:atomic_weight");
}

describe("tag kinds", () => {
  it("derives kind from the slug's leading segment", () => {
    expect(tagKind("node:ebbing11e:2.4:atomic_weight")).toBe("node");
    expect(tagKind("tech:mhchem")).toBe("tech");
    expect(tagKind("topic:acids")).toBe("topic");
    expect(tagKind("chemistry:gases")).toBe("subject");
    expect(tagKind("chemistry")).toBe("subject");
    // A slug that merely starts with the letters, without the prefix segment,
    // is a subject — the prefix is a whole segment, not a substring.
    expect(tagKind("nodes_of_ranvier")).toBe("subject");
  });

  it("puts kind on every list_tags row", () => {
    const db = openTestDb();
    seedKinds(db);
    const byslug = new Map(listTags(db).map((t) => [t.slug, t.kind]));
    expect(byslug.get("node:ebbing11e:2.4:atomic_weight")).toBe("node");
    expect(byslug.get("tech:mhchem")).toBe("tech");
    expect(byslug.get("topic:acids")).toBe("topic");
    expect(byslug.get("chemistry:gases")).toBe("subject");
  });

  it("filters by kind", () => {
    const db = openTestDb();
    seedKinds(db);
    expect(listTags(db, { kind: "tech" }).map((t) => t.slug)).toEqual(["tech:mhchem"]);
    expect(listTags(db, { kind: "node" }).map((t) => t.slug)).toEqual(["node:ebbing11e:2.4:atomic_weight"]);
    expect(listTags(db, { kind: "subject" }).map((t) => t.slug)).toEqual(["chemistry", "chemistry:gases"]);
  });

  it("composes kind with prefix", () => {
    const db = openTestDb();
    seedKinds(db);
    insertTag(db, "tech:calculator");
    expect(listTags(db, { kind: "tech", prefix: "tech" }).map((t) => t.slug)).toEqual([
      "tech:calculator",
      "tech:mhchem",
    ]);
    // A prefix outside the kind yields nothing rather than either filter alone.
    expect(listTags(db, { kind: "tech", prefix: "chemistry" })).toEqual([]);
  });
});

describe("merge_tags across the prefixed kinds", () => {
  for (const prefix of ["node", "tech", "topic"]) {
    it(`repoints questions when merging two ${prefix}: tags`, () => {
      const db = openTestDb();
      insertTag(db, `${prefix}:from_one`);
      insertTag(db, `${prefix}:to_one`);
      const q = insertQuestion(db, { tags: [`${prefix}:from_one`] });

      const result = mergeTags(db, `${prefix}:from_one`, `${prefix}:to_one`);
      expect(result.questions_updated).toBe(1);

      const tags = db
        .prepare("SELECT tag_slug FROM question_tag WHERE question_id = ?")
        .all(q.id) as { tag_slug: string }[];
      expect(tags.map((t) => t.tag_slug)).toEqual([`${prefix}:to_one`]);
      const retired = db.prepare("SELECT retired_at FROM tag WHERE slug = ?").get(`${prefix}:from_one`) as {
        retired_at: string | null;
      };
      expect(retired.retired_at).not.toBeNull();
    });
  }

  // node: tags double as node_keys, which live in their own table and in
  // question.node_key. A merge that only repointed question_tag would leave
  // every item's node_key pointing at a retired slug.
  it("repoints question_node_key and question.node_key when merging node: tags", () => {
    const db = openTestDb();
    insertTag(db, "node:old_idea");
    insertTag(db, "node:new_idea");
    const q = insertQuestion(db, { tags: ["node:old_idea"] });
    db.prepare("UPDATE question SET node_key = ? WHERE id = ?").run("node:old_idea", q.id);
    db.prepare(
      "INSERT INTO question_node_key (question_id, node_key, is_primary, ordinal) VALUES (?, ?, 1, 0)"
    ).run(q.id, "node:old_idea");

    const result = mergeTags(db, "node:old_idea", "node:new_idea");
    expect(result.node_keys_updated).toBe(1);

    const keys = db
      .prepare("SELECT node_key, is_primary FROM question_node_key WHERE question_id = ?")
      .all(q.id) as { node_key: string; is_primary: number }[];
    expect(keys).toEqual([{ node_key: "node:new_idea", is_primary: 1 }]);
    const row = db.prepare("SELECT node_key FROM question WHERE id = ?").get(q.id) as { node_key: string };
    expect(row.node_key).toBe("node:new_idea");
  });

  // (question_id, node_key) is the primary key, so a question already
  // carrying both keys would collide on a blind UPDATE.
  it("collapses rather than collides when a question already carries both node keys", () => {
    const db = openTestDb();
    insertTag(db, "node:old_idea");
    insertTag(db, "node:new_idea");
    const q = insertQuestion(db, { tags: ["node:old_idea"] });
    db.prepare("UPDATE question SET node_key = ? WHERE id = ?").run("node:old_idea", q.id);
    const ins = db.prepare(
      "INSERT INTO question_node_key (question_id, node_key, is_primary, ordinal) VALUES (?, ?, ?, ?)"
    );
    ins.run(q.id, "node:old_idea", 1, 0);
    ins.run(q.id, "node:new_idea", 0, 1);

    mergeTags(db, "node:old_idea", "node:new_idea");

    const keys = db
      .prepare("SELECT node_key, is_primary FROM question_node_key WHERE question_id = ?")
      .all(q.id) as { node_key: string; is_primary: number }[];
    // One row survives, and it inherits the primary flag the merged key held.
    expect(keys).toEqual([{ node_key: "node:new_idea", is_primary: 1 }]);
    const row = db.prepare("SELECT node_key FROM question WHERE id = ?").get(q.id) as { node_key: string };
    expect(row.node_key).toBe("node:new_idea");
  });

  it("leaves node keys alone when the merge is not between two node: tags", () => {
    const db = openTestDb();
    insertTag(db, "topic:from_two");
    insertTag(db, "topic:to_two");
    const q = insertQuestion(db, { tags: ["topic:from_two"] });
    db.prepare(
      "INSERT INTO question_node_key (question_id, node_key, is_primary, ordinal) VALUES (?, ?, 1, 0)"
    ).run(q.id, "node:untouched");

    const result = mergeTags(db, "topic:from_two", "topic:to_two");
    expect(result.node_keys_updated).toBe(0);
    const keys = db.prepare("SELECT node_key FROM question_node_key WHERE question_id = ?").all(q.id) as {
      node_key: string;
    }[];
    expect(keys.map((k) => k.node_key)).toEqual(["node:untouched"]);
  });
});

describe("readme tag_conventions", () => {
  it("documents the three reserved prefixes and what they mean", () => {
    const db = openTestDb();
    const conventions = readme(db).tag_conventions;
    expect(conventions).toContain("node:");
    expect(conventions).toContain("tech:");
    expect(conventions).toContain("topic:");
  });
});
