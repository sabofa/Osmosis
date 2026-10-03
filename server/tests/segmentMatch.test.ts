import { describe, it, expect } from "vitest";
import { openTestDb, insertTag, insertQuestion } from "./helpers.js";
import { getEligibleQuestions } from "../src/domain/draw.js";
import { listTags } from "../src/domain/tags.js";
import { replaceNodeKeys } from "../src/domain/nodeKeys.js";

// Slug matching cuts only at ":" and reads every other character literally.
// A LIKE pattern reads "_" as "any one character", so a query for a slug with
// an underscore in it used to reach a sibling spelled with a dot (2_4 vs 2.4)
// — exactly the second spelling of a section the dotted grammar exists to
// prevent.
describe("segment-aware slug matching", () => {
  it("a tag query matches the slug and its descendants, never a sibling that only shares a prefix", () => {
    const db = openTestDb();
    for (const s of ["node", "node:ebbing11e", "node:ebbing11e:2", "node:ebbing11e:2.4", "node:ebbing11e:2:atoms", "node:ebbing11e:2.4:atomic_weight"]) {
      insertTag(db, s);
    }
    const chapter = insertQuestion(db, { tags: ["node:ebbing11e:2:atoms"] });
    const section = insertQuestion(db, { tags: ["node:ebbing11e:2.4:atomic_weight"] });

    const ids = (all: string[]) => getEligibleQuestions(db, { tag_query: { all } }).map((q) => q.id).sort();
    expect(ids(["node:ebbing11e:2"])).toEqual([chapter.id]);
    expect(ids(["node:ebbing11e:2.4"])).toEqual([section.id]);
    expect(ids(["node:ebbing11e"])).toEqual([chapter.id, section.id].sort());
  });

  it("reads '_' literally: a query for a_b does not reach a.b", () => {
    const db = openTestDb();
    for (const s of ["math", "math:a_b", "math:a.b", "math:a.b:c"]) insertTag(db, s);
    const underscore = insertQuestion(db, { tags: ["math:a_b"] });
    insertQuestion(db, { tags: ["math:a.b:c"] });

    expect(getEligibleQuestions(db, { tag_query: { any: ["math:a_b"] } }).map((q) => q.id)).toEqual([underscore.id]);
    expect(listTags(db, { prefix: "math:a_b" }).map((t) => t.slug)).toEqual(["math:a_b"]);
  });

  it("a node: query also finds items by their node_keys, not only by a node tag in their tags", () => {
    const db = openTestDb();
    insertTag(db, "chem");
    const keyed = insertQuestion(db, { tags: ["chem"] });
    replaceNodeKeys(db, keyed.id, ["node:ebbing11e:2.4:atomic_weight", "node:ebbing11e:3.1:formula_weight"]);
    db.prepare("UPDATE question SET node_key = ? WHERE id = ?").run("node:ebbing11e:2.4:atomic_weight", keyed.id);
    const columnOnly = insertQuestion(db, { tags: ["chem"] });
    db.prepare("UPDATE question SET node_key = ? WHERE id = ?").run("node:ebbing11e:2.4:isotopes", columnOnly.id);
    insertQuestion(db, { tags: ["chem"] });

    const ids = (q: Record<string, string[]>) => getEligibleQuestions(db, { tag_query: q }).map((r) => r.id).sort();
    expect(ids({ any: ["node:ebbing11e:2.4"] })).toEqual([keyed.id, columnOnly.id].sort());
    // A secondary key counts: the item touches §3.1 too.
    expect(ids({ all: ["node:ebbing11e:3.1"] })).toEqual([keyed.id]);
    // none keeps the keyless item (a NULL node_key must not poison the NOT).
    const keyless = getEligibleQuestions(db, { tag_query: { all: ["chem"] } })
      .map((q) => q.id)
      .filter((id) => id !== keyed.id && id !== columnOnly.id);
    expect(ids({ all: ["chem"], none: ["node:ebbing11e:2.4"] })).toEqual(keyless);
  });
});
