import { describe, it, expect } from "vitest";
import { normalizeName, sameName } from "../src/domain/workspace/names.js";
import { getFileType, registerFileType, classOf } from "../src/domain/workspace/fileTypes.js";
import { DomainError } from "../src/domain/errors.js";
import { openTestDb } from "./helpers.js";
import {
  createNode,
  placeNode,
  renamePlacement,
  movePlacement,
  removePlacement,
  destroyNode,
  restoreNode,
  purgeNode,
  renameNode,
  setKindTag,
  freeName,
} from "../src/domain/workspace/graph.js";

describe("names", () => {
  it("normalizes to NFC and trims", () => {
    expect(normalizeName("  Café notes ")).toBe("Café notes");
  });
  it("refuses empty, slash, control characters and over-long names", () => {
    for (const bad of ["", "   ", "a/b", "a\u0007b", "x".repeat(201)]) {
      expect(() => normalizeName(bad)).toThrow(DomainError);
    }
    expect(normalizeName("x".repeat(200))).toHaveLength(200);
  });
  it("compares case-insensitively beyond ASCII", () => {
    expect(sameName("Ελαστικότητα", "ΕΛΑΣΤΙΚΌΤΗΤΑ")).toBe(true);
    expect(sameName("notes", "Notes ")).toBe(true);
    expect(sameName("notes", "note")).toBe(false);
  });
});

describe("file types", () => {
  it("has the three built-ins", () => {
    expect(getFileType("markdown")).toMatchObject({ storage: "text", appendable: true });
    expect(getFileType("markdown").kinds("# hi")).toEqual(["text"]);
    expect(getFileType("graph").kinds("y = x^2")).toEqual(["plot"]);
    expect(getFileType("asset").storage).toBe("asset");
  });
  it("refuses an unknown type and a duplicate registration", () => {
    expect(() => getFileType("nope")).toThrow(DomainError);
    expect(() => registerFileType({ type: "markdown", storage: "text", appendable: true, kinds: () => ["text"] })).toThrow();
  });
  it("derives class from page kinds (graph-engine spec, Classification)", () => {
    expect(classOf(["text"])).toBe("document");
    expect(classOf(["plot"])).toBe("graph");
    expect(classOf(["space", "figure"])).toBe("graph");
    expect(classOf(["flow"])).toBe("flowchart");
    expect(classOf(["sheet"])).toBe("spreadsheet");
    expect(classOf(["code"])).toBe("code");
    expect(classOf(["text", "flow"])).toBe("mixed");
    expect(classOf([])).toBe("empty");
  });
});

// ---------------------------------------------------------------------------
// Graph writes: the four rules (Task 2). The first blocks are the brief's own
// tests; "error codes" and below pin what the brief's rules imply.
// ---------------------------------------------------------------------------

function md(db: ReturnType<typeof openTestDb>, title: string, place_in?: { container_id: string; name?: string }) {
  return createNode(db, { kind: "file", title, file: { type: "markdown", body: `# ${title}` }, place_in });
}
const ids = (db: ReturnType<typeof openTestDb>, childId: string) =>
  (db.prepare("SELECT container_id, name FROM ws_placement WHERE child_id = ? ORDER BY name").all(childId) as { container_id: string; name: string }[]);

describe("rule 1 — remove means remove-from-here", () => {
  it("removing one placement leaves the others; the last one leaves the file unplaced, never destroyed", () => {
    const db = openTestDb();
    const track = createNode(db, { kind: "track", title: "quant" }).node;
    const course = createNode(db, { kind: "course", title: "micro", place_in: { container_id: track.id } }).node;
    const { node: notes, placement: inTrack } = md(db, "Elasticity notes", { container_id: track.id });
    const inCourse = placeNode(db, { container_id: course.id, child_id: notes.id, name: "Supporting material" });

    expect(removePlacement(db, inTrack!.id).became_unplaced).toBe(false);
    expect(ids(db, notes.id)).toEqual([{ container_id: course.id, name: "Supporting material" }]);
    expect(removePlacement(db, inCourse.id).became_unplaced).toBe(true);
    const row = db.prepare("SELECT trashed_at FROM ws_node WHERE id = ?").get(notes.id) as { trashed_at: string | null };
    expect(row.trashed_at).toBeNull();
  });

  it("destroy trashes the node and keeps its placements hidden; restore brings them back; purge deletes", () => {
    const db = openTestDb();
    const folder = createNode(db, { kind: "folder", title: "unit-3" }).node;
    const { node } = md(db, "a", { container_id: folder.id });
    expect(destroyNode(db, node.id).trashed).toEqual([node.id]);
    expect(ids(db, node.id)).toHaveLength(1);
    md(db, "a", { container_id: folder.id }); // the name is free while the first is trashed
    const restored = restoreNode(db, node.id);
    expect(restored.renamed).toEqual([{ placement_id: expect.any(String), name: "a (2)" }]);
    destroyNode(db, node.id);
    purgeNode(db, node.id);
    expect(db.prepare("SELECT 1 FROM ws_node WHERE id = ?").get(node.id)).toBeUndefined();
  });

  it("destroying a container offers its orphans: only children placed nowhere else, and only when asked", () => {
    const db = openTestDb();
    const a = createNode(db, { kind: "folder", title: "A" }).node;
    const b = createNode(db, { kind: "folder", title: "B" }).node;
    const only = md(db, "only-in-A", { container_id: a.id }).node;
    const shared = md(db, "shared", { container_id: a.id }).node;
    placeNode(db, { container_id: b.id, child_id: shared.id });
    expect(destroyNode(db, a.id).trashed).toEqual([a.id]);
    restoreNode(db, a.id);
    expect(destroyNode(db, a.id, { withOrphans: true }).trashed.sort()).toEqual([a.id, only.id].sort());
  });
});

describe("rule 2 — names live on placements", () => {
  it("renames one placement, leaves the others and the title", () => {
    const db = openTestDb();
    const t = createNode(db, { kind: "track", title: "quant" }).node;
    const c = createNode(db, { kind: "course", title: "micro" }).node;
    const { node, placement } = md(db, "Elasticity notes", { container_id: t.id });
    placeNode(db, { container_id: c.id, child_id: node.id });
    renamePlacement(db, placement!.id, "Supporting material");
    expect(ids(db, node.id).map((p) => p.name).sort()).toEqual(["Elasticity notes", "Supporting material"]);
    expect((db.prepare("SELECT title FROM ws_node WHERE id = ?").get(node.id) as { title: string }).title).toBe("Elasticity notes");
  });

  it("refuses a name a live sibling already has, case-insensitively, with a suggestion", () => {
    const db = openTestDb();
    const f = createNode(db, { kind: "folder", title: "f" }).node;
    md(db, "Notes", { container_id: f.id });
    expect(() => md(db, "notes", { container_id: f.id })).toThrow(/name_taken|Notes \(2\)|notes \(2\)/);
  });

  it("rename everywhere follows placements that still carry the old title, and only those", () => {
    const db = openTestDb();
    const a = createNode(db, { kind: "folder", title: "A" }).node;
    const b = createNode(db, { kind: "folder", title: "B" }).node;
    const { node, placement } = md(db, "old", { container_id: a.id });
    const other = placeNode(db, { container_id: b.id, child_id: node.id, name: "custom" });
    renameNode(db, node.id, "new", { everywhere: true });
    expect(ids(db, node.id).map((p) => p.name).sort()).toEqual(["custom", "new"]);
    expect(placement && other).toBeTruthy();
  });
});

describe("rule 4 — cycles are refused at placement time", () => {
  it("refuses self, direct and indirect cycles, including through a trashed node", () => {
    const db = openTestDb();
    const t1 = createNode(db, { kind: "track", title: "t1" }).node;
    const t2 = createNode(db, { kind: "track", title: "t2", place_in: { container_id: t1.id } }).node;
    const t3 = createNode(db, { kind: "track", title: "t3", place_in: { container_id: t2.id } }).node;
    expect(() => placeNode(db, { container_id: t1.id, child_id: t1.id })).toThrow(/cycle/);
    expect(() => placeNode(db, { container_id: t2.id, child_id: t1.id })).toThrow(/cycle/);
    expect(() => placeNode(db, { container_id: t3.id, child_id: t1.id })).toThrow(/cycle/);
    destroyNode(db, t2.id);
    expect(() => placeNode(db, { container_id: t3.id, child_id: t1.id })).toThrow(/cycle|trashed/);
  });
});

describe("containment", () => {
  it("follows the matrix: no course or track inside a course, folders may hold courses", () => {
    const db = openTestDb();
    const t = createNode(db, { kind: "track", title: "t" }).node;
    const c = createNode(db, { kind: "course", title: "c" }).node;
    const c2 = createNode(db, { kind: "course", title: "c2" }).node;
    const f = createNode(db, { kind: "folder", title: "Year 1" }).node;
    const file = md(db, "x").node;
    expect(() => placeNode(db, { container_id: c.id, child_id: t.id })).toThrow(/containment/);
    expect(() => placeNode(db, { container_id: c.id, child_id: c2.id })).toThrow(/containment/);
    expect(() => placeNode(db, { container_id: file.id, child_id: c.id })).toThrow(/containment/);
    expect(placeNode(db, { container_id: f.id, child_id: c.id })).toBeTruthy();
    expect(placeNode(db, { container_id: t.id, child_id: f.id })).toBeTruthy();
  });

  it("refuses an unregistered file type, and a file body the type rejects", () => {
    const db = openTestDb();
    expect(() => createNode(db, { kind: "file", title: "x", file: { type: "nope" } })).toThrow(/unknown_file_type|No file type/);
  });

  it("move re-parents one placement atomically and checks the destination like a new placement", () => {
    const db = openTestDb();
    const a = createNode(db, { kind: "folder", title: "A" }).node;
    const b = createNode(db, { kind: "folder", title: "B" }).node;
    const { node, placement } = md(db, "n", { container_id: a.id });
    movePlacement(db, placement!.id, b.id);
    expect(ids(db, node.id)).toEqual([{ container_id: b.id, name: "n" }]);
    const inner = createNode(db, { kind: "folder", title: "inner", place_in: { container_id: a.id } });
    expect(() => movePlacement(db, inner.placement!.id, inner.node.id)).toThrow(/cycle/);
  });
});

// --- what the rules imply ----------------------------------------------------

type Db = ReturnType<typeof openTestDb>;
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  throw new Error("expected a DomainError, nothing was thrown");
}
const count = (db: Db, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const nodeRow = (db: Db, id: string) =>
  db.prepare("SELECT * FROM ws_node WHERE id = ?").get(id) as {
    title: string;
    kind_tag: string | null;
    trashed_at: string | null;
    updated_at: string;
  };
const OLD = "2000-01-01 00:00:00";
const age = (db: Db, ...nodeIds: string[]) => {
  for (const id of nodeIds) db.prepare("UPDATE ws_node SET updated_at = ? WHERE id = ?").run(OLD, id);
};

describe("error codes", () => {
  it("names the rule that refused, and not_found for an unknown id", () => {
    const db = openTestDb();
    const t = createNode(db, { kind: "track", title: "t" }).node;
    const c = createNode(db, { kind: "course", title: "c" }).node;
    const f = md(db, "x").node;
    expect(codeOf(() => placeNode(db, { container_id: c.id, child_id: t.id }))).toBe("containment_not_allowed");
    expect(codeOf(() => placeNode(db, { container_id: f.id, child_id: c.id }))).toBe("containment_not_allowed");
    expect(codeOf(() => placeNode(db, { container_id: t.id, child_id: t.id }))).toBe("cycle_rejected");
    expect(codeOf(() => placeNode(db, { container_id: "ghost", child_id: t.id }))).toBe("not_found");
    expect(codeOf(() => placeNode(db, { container_id: t.id, child_id: "ghost" }))).toBe("not_found");
    expect(codeOf(() => createNode(db, { kind: "folder", title: "x", place_in: { container_id: "ghost" } }))).toBe("not_found");
    expect(codeOf(() => renamePlacement(db, "ghost", "x"))).toBe("not_found");
    expect(codeOf(() => movePlacement(db, "ghost", t.id))).toBe("not_found");
    expect(codeOf(() => removePlacement(db, "ghost"))).toBe("not_found");
    expect(codeOf(() => destroyNode(db, "ghost"))).toBe("not_found");
    expect(codeOf(() => restoreNode(db, "ghost"))).toBe("not_found");
    expect(codeOf(() => purgeNode(db, "ghost"))).toBe("not_found");
    expect(codeOf(() => renameNode(db, "ghost", "x"))).toBe("not_found");
    expect(codeOf(() => setKindTag(db, "ghost", "source"))).toBe("not_found");
  });

  it("refuses placing into, or of, a trashed node", () => {
    const db = openTestDb();
    const f = createNode(db, { kind: "folder", title: "f" }).node;
    const file = md(db, "x").node;
    destroyNode(db, f.id);
    expect(codeOf(() => placeNode(db, { container_id: f.id, child_id: file.id }))).toBe("trashed");
    const g = createNode(db, { kind: "folder", title: "g" }).node;
    destroyNode(db, file.id);
    expect(codeOf(() => placeNode(db, { container_id: g.id, child_id: file.id }))).toBe("trashed");
    expect(codeOf(() => createNode(db, { kind: "folder", title: "h", place_in: { container_id: f.id } }))).toBe("trashed");
  });

  it("a cycle through a trashed node is still a cycle, not a trashed refusal", () => {
    const db = openTestDb();
    const t1 = createNode(db, { kind: "track", title: "t1" }).node;
    const t2 = createNode(db, { kind: "track", title: "t2", place_in: { container_id: t1.id } }).node;
    const t3 = createNode(db, { kind: "track", title: "t3", place_in: { container_id: t2.id } }).node;
    destroyNode(db, t2.id);
    expect(codeOf(() => placeNode(db, { container_id: t3.id, child_id: t1.id }))).toBe("cycle_rejected");
  });

  it("checks containment before the trashed rule, as the brief orders them", () => {
    const db = openTestDb();
    const c = createNode(db, { kind: "course", title: "c" }).node;
    const t = createNode(db, { kind: "track", title: "t" }).node;
    destroyNode(db, t.id);
    expect(codeOf(() => placeNode(db, { container_id: c.id, child_id: t.id }))).toBe("containment_not_allowed");
  });

  it("refuses placing a node where it already is, and moving onto an existing placement", () => {
    const db = openTestDb();
    const a = createNode(db, { kind: "folder", title: "A" }).node;
    const b = createNode(db, { kind: "folder", title: "B" }).node;
    const { node, placement } = md(db, "n", { container_id: a.id });
    expect(codeOf(() => placeNode(db, { container_id: a.id, child_id: node.id, name: "again" }))).toBe("already_placed");
    placeNode(db, { container_id: b.id, child_id: node.id, name: "other name" });
    expect(codeOf(() => movePlacement(db, placement!.id, b.id))).toBe("already_placed");
    expect(ids(db, node.id)).toHaveLength(2);
  });

  it("validates the title and the name through normalizeName", () => {
    const db = openTestDb();
    const f = createNode(db, { kind: "folder", title: "f" }).node;
    expect(codeOf(() => createNode(db, { kind: "folder", title: "   " }))).toBe("invalid_name");
    expect(codeOf(() => createNode(db, { kind: "folder", title: "a/b" }))).toBe("invalid_name");
    expect(codeOf(() => md(db, "ok", { container_id: f.id, name: "bad/name" }))).toBe("invalid_name");
    const { node, placement } = md(db, "  Café  ", { container_id: f.id });
    expect(node.title).toBe("Café");
    expect(placement!.name).toBe("Café");
    expect(codeOf(() => renamePlacement(db, placement!.id, ""))).toBe("invalid_name");
    expect(codeOf(() => renameNode(db, node.id, "x/y"))).toBe("invalid_name");
  });

  it("refuses an unknown kind, kind tag or author", () => {
    const db = openTestDb();
    expect(codeOf(() => createNode(db, { kind: "banana" as never, title: "x" }))).toBe("invalid_input");
    expect(codeOf(() => createNode(db, { kind: "folder", title: "x", kind_tag: "nope" as never }))).toBe("invalid_input");
    expect(codeOf(() => createNode(db, { kind: "file", title: "x", file: { type: "markdown" }, author: "robot" as never }))).toBe("invalid_input");
    const n = createNode(db, { kind: "folder", title: "x" }).node;
    expect(codeOf(() => setKindTag(db, n.id, "nope" as never))).toBe("invalid_input");
    expect(count(db, "ws_node")).toBe(1);
  });
});

describe("names in depth", () => {
  it("defaults the placement name to the title, and trims and NFC-normalizes an explicit one", () => {
    const db = openTestDb();
    const f = createNode(db, { kind: "folder", title: "f" }).node;
    const { placement } = md(db, "Notes", { container_id: f.id });
    expect(placement!.name).toBe("Notes");
    const other = md(db, "Other");
    const p = placeNode(db, { container_id: f.id, child_id: other.node.id, name: "  Café  " });
    expect(p.name).toBe("Café");
  });

  it('puts the lowest free "name (n)", n >= 2, in the message and the detail', () => {
    const db = openTestDb();
    const f = createNode(db, { kind: "folder", title: "f" }).node;
    md(db, "Notes", { container_id: f.id });
    try {
      md(db, "notes", { container_id: f.id });
      throw new Error("expected name_taken");
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("name_taken");
      expect((err as DomainError).message).toContain('"notes (2)"');
      expect((err as DomainError).detail).toEqual({ suggestion: "notes (2)" });
    }
    md(db, "Notes (2)", { container_id: f.id });
    md(db, "NOTES (4)", { container_id: f.id }); // a gap at 3 is the lowest free
    expect(() => md(db, "Notes", { container_id: f.id })).toThrow(/"Notes \(3\)"/);
  });

  it("freeName returns the name when it is free, and the lowest free suffix when not", () => {
    const db = openTestDb();
    const f = createNode(db, { kind: "folder", title: "f" }).node;
    const { placement } = md(db, "a", { container_id: f.id });
    expect(freeName(db, f.id, "b")).toBe("b");
    expect(freeName(db, f.id, "A")).toBe("A (2)");
    expect(freeName(db, f.id, "a", placement!.id)).toBe("a"); // the placement itself is not a sibling
  });

  it("freeName keeps a long name inside the 200 character limit", () => {
    const db = openTestDb();
    const f = createNode(db, { kind: "folder", title: "f" }).node;
    const long = "x".repeat(200);
    md(db, long, { container_id: f.id });
    const free = freeName(db, f.id, long);
    expect([...free]).toHaveLength(200);
    expect(free.endsWith(" (2)")).toBe(true);
  });

  it("a trashed node does not hold a name; its own names never collide until restore", () => {
    const db = openTestDb();
    const f = createNode(db, { kind: "folder", title: "f" }).node;
    const first = md(db, "a", { container_id: f.id });
    destroyNode(db, first.node.id);
    const second = md(db, "b", { container_id: f.id });
    // A trashed node may be renamed onto a live sibling's name; restore sorts it out.
    renamePlacement(db, first.placement!.id, "B");
    const restored = restoreNode(db, first.node.id);
    expect(restored.renamed).toEqual([{ placement_id: first.placement!.id, name: "B (2)" }]);
    expect(second.placement!.name).toBe("b");
  });

  it("renaming a placement refuses a live sibling's name, and allows its own name in another case", () => {
    const db = openTestDb();
    const f = createNode(db, { kind: "folder", title: "f" }).node;
    const a = md(db, "alpha", { container_id: f.id });
    md(db, "beta", { container_id: f.id });
    expect(codeOf(() => renamePlacement(db, a.placement!.id, "BETA"))).toBe("name_taken");
    expect(renamePlacement(db, a.placement!.id, "ALPHA").name).toBe("ALPHA");
  });

  it("the same name is fine in different containers", () => {
    const db = openTestDb();
    const f = createNode(db, { kind: "folder", title: "f" }).node;
    const g = createNode(db, { kind: "folder", title: "g" }).node;
    md(db, "Notes", { container_id: f.id });
    expect(md(db, "Notes", { container_id: g.id }).placement!.name).toBe("Notes");
  });

  it("rename everywhere is all or nothing when one placement would collide", () => {
    const db = openTestDb();
    const a = createNode(db, { kind: "folder", title: "A" }).node;
    const b = createNode(db, { kind: "folder", title: "B" }).node;
    const { node } = md(db, "old", { container_id: a.id });
    placeNode(db, { container_id: b.id, child_id: node.id });
    md(db, "new", { container_id: b.id });
    expect(codeOf(() => renameNode(db, node.id, "new", { everywhere: true }))).toBe("name_taken");
    expect(nodeRow(db, node.id).title).toBe("old");
    expect(ids(db, node.id).map((p) => p.name)).toEqual(["old", "old"]);
  });

  it("rename without everywhere changes the title and no placement", () => {
    const db = openTestDb();
    const a = createNode(db, { kind: "folder", title: "A" }).node;
    const { node } = md(db, "old", { container_id: a.id });
    const renamed = renameNode(db, node.id, "fresh");
    expect(renamed.title).toBe("fresh");
    expect(ids(db, node.id)).toEqual([{ container_id: a.id, name: "old" }]);
  });
});

describe("move in depth", () => {
  it("keeps the placement's name and id; refuses a destination name collision and moves nothing", () => {
    const db = openTestDb();
    const a = createNode(db, { kind: "folder", title: "A" }).node;
    const b = createNode(db, { kind: "folder", title: "B" }).node;
    const { node, placement } = md(db, "n", { container_id: a.id });
    md(db, "N", { container_id: b.id });
    expect(codeOf(() => movePlacement(db, placement!.id, b.id))).toBe("name_taken");
    expect(ids(db, node.id)).toEqual([{ container_id: a.id, name: "n" }]);
    renamePlacement(db, placement!.id, "moved");
    const moved = movePlacement(db, placement!.id, b.id);
    expect(moved.id).toBe(placement!.id);
    expect(moved).toMatchObject({ container_id: b.id, name: "moved" });
  });

  it("checks containment, trashed and cycles at the destination", () => {
    const db = openTestDb();
    const course = createNode(db, { kind: "course", title: "c" }).node;
    const track = createNode(db, { kind: "track", title: "t" }).node;
    const innerTrack = createNode(db, { kind: "track", title: "inner", place_in: { container_id: track.id } });
    const gone = createNode(db, { kind: "folder", title: "gone" }).node;
    const innerFolder = createNode(db, { kind: "folder", title: "inner-folder", place_in: { container_id: track.id } });
    destroyNode(db, gone.id);
    expect(codeOf(() => movePlacement(db, innerTrack.placement!.id, course.id))).toBe("containment_not_allowed");
    expect(codeOf(() => movePlacement(db, innerFolder.placement!.id, gone.id))).toBe("trashed");
    const deeper = createNode(db, { kind: "folder", title: "deeper", place_in: { container_id: innerFolder.node.id } });
    expect(codeOf(() => movePlacement(db, innerFolder.placement!.id, deeper.node.id))).toBe("cycle_rejected");
    expect(ids(db, innerFolder.node.id)).toEqual([{ container_id: track.id, name: "inner-folder" }]);
  });

  it("moving a trashed node's placement is refused, and moving to where it already is changes nothing", () => {
    const db = openTestDb();
    const a = createNode(db, { kind: "folder", title: "A" }).node;
    const b = createNode(db, { kind: "folder", title: "B" }).node;
    const { node, placement } = md(db, "n", { container_id: a.id });
    expect(movePlacement(db, placement!.id, a.id)).toEqual(placement);
    destroyNode(db, node.id);
    expect(codeOf(() => movePlacement(db, placement!.id, b.id))).toBe("trashed");
  });
});

describe("destroy, restore, purge in depth", () => {
  it("destroy never deletes a placement, and refuses a node already in the trash", () => {
    const db = openTestDb();
    const a = createNode(db, { kind: "folder", title: "A" }).node;
    const b = createNode(db, { kind: "folder", title: "B" }).node;
    const { node } = md(db, "n", { container_id: a.id });
    placeNode(db, { container_id: b.id, child_id: node.id });
    destroyNode(db, node.id);
    expect(count(db, "ws_placement")).toBe(2);
    expect(nodeRow(db, node.id).trashed_at).not.toBeNull();
    expect(codeOf(() => destroyNode(db, node.id))).toBe("trashed");
  });

  it("orphans recurse through container children, spare shared children, and skip a child already trashed", () => {
    const db = openTestDb();
    const top = createNode(db, { kind: "folder", title: "top" }).node;
    const mid = createNode(db, { kind: "folder", title: "mid", place_in: { container_id: top.id } }).node;
    const leaf = md(db, "leaf", { container_id: mid.id }).node;
    const kept = md(db, "kept", { container_id: mid.id }).node;
    const elsewhere = createNode(db, { kind: "folder", title: "elsewhere" }).node;
    placeNode(db, { container_id: elsewhere.id, child_id: kept.id });
    const sharedMid = createNode(db, { kind: "folder", title: "shared-mid", place_in: { container_id: top.id } }).node;
    placeNode(db, { container_id: elsewhere.id, child_id: sharedMid.id });
    const deepChild = md(db, "deep-child", { container_id: sharedMid.id }).node;
    const already = md(db, "already", { container_id: top.id }).node;
    destroyNode(db, already.id);

    const { trashed } = destroyNode(db, top.id, { withOrphans: true });
    expect(trashed.sort()).toEqual([top.id, mid.id, leaf.id].sort());
    expect(nodeRow(db, kept.id).trashed_at).toBeNull(); // placed in elsewhere too
    expect(nodeRow(db, sharedMid.id).trashed_at).toBeNull(); // placed in elsewhere too, so its child stays
    expect(nodeRow(db, deepChild.id).trashed_at).toBeNull();
    expect(count(db, "ws_placement")).toBe(8); // no placement was deleted
  });

  it("restore reports nothing renamed when no name collides, and refuses a live node", () => {
    const db = openTestDb();
    const f = createNode(db, { kind: "folder", title: "f" }).node;
    const { node } = md(db, "n", { container_id: f.id });
    expect(codeOf(() => restoreNode(db, node.id))).toBe("not_trashed");
    destroyNode(db, node.id);
    expect(restoreNode(db, node.id)).toEqual({ restored: node.id, renamed: [] });
    expect(nodeRow(db, node.id).trashed_at).toBeNull();
  });

  it("restore renames each colliding placement in its own container", () => {
    const db = openTestDb();
    const a = createNode(db, { kind: "folder", title: "A" }).node;
    const b = createNode(db, { kind: "folder", title: "B" }).node;
    const c = createNode(db, { kind: "folder", title: "C" }).node;
    const { node } = md(db, "n", { container_id: a.id });
    placeNode(db, { container_id: b.id, child_id: node.id });
    placeNode(db, { container_id: c.id, child_id: node.id, name: "unique" });
    destroyNode(db, node.id);
    md(db, "n", { container_id: a.id });
    md(db, "N", { container_id: b.id });
    md(db, "N (2)", { container_id: b.id });
    const { renamed } = restoreNode(db, node.id);
    expect(renamed).toHaveLength(2);
    expect(ids(db, node.id).map((p) => p.name).sort()).toEqual(["n (2)", "n (3)", "unique"].sort());
  });

  it("purge needs a trashed node, deletes its placements, file and revisions, and unplaces its children", () => {
    const db = openTestDb();
    const parent = createNode(db, { kind: "folder", title: "parent" }).node;
    const grandparent = createNode(db, { kind: "folder", title: "grandparent" }).node;
    placeNode(db, { container_id: grandparent.id, child_id: parent.id });
    const { node: child } = md(db, "child", { container_id: parent.id });
    expect(codeOf(() => purgeNode(db, parent.id))).toBe("not_trashed");
    destroyNode(db, parent.id);
    expect(purgeNode(db, parent.id)).toEqual({ purged: parent.id });
    expect(ids(db, child.id)).toEqual([]);
    expect(nodeRow(db, child.id).trashed_at).toBeNull(); // unplaced, not destroyed
    destroyNode(db, child.id);
    purgeNode(db, child.id);
    expect(count(db, "ws_file")).toBe(0);
    expect(count(db, "ws_file_revision")).toBe(0);
    expect(count(db, "ws_placement")).toBe(0);
  });

  it("purge leaves an asset a file pointed at", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type) VALUES ('as1', 'scan', 'file')").run();
    const { node } = createNode(db, { kind: "file", title: "scan", file: { type: "asset", asset_id: "as1" } });
    destroyNode(db, node.id);
    purgeNode(db, node.id);
    expect(count(db, "asset")).toBe(1);
  });
});

describe("files", () => {
  it("inserts revision 1 and its revision row, saved by ben unless an author says otherwise", () => {
    const db = openTestDb();
    const ben = createNode(db, { kind: "file", title: "a", file: { type: "markdown", body: "# a" } }).node;
    const tutor = createNode(db, { kind: "file", title: "b", file: { type: "markdown", body: "b" }, author: "tutor" }).node;
    const file = db.prepare("SELECT * FROM ws_file WHERE node_id = ?").get(ben.id) as Record<string, unknown>;
    expect(file).toMatchObject({ type: "markdown", body: "# a", asset_id: null, revision: 1, saved_by: "ben" });
    const rev = db.prepare("SELECT * FROM ws_file_revision WHERE node_id = ?").all(ben.id) as Record<string, unknown>[];
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ revision: 1, type: "markdown", body: "# a", saved_by: "ben", saved_at: file.saved_at });
    expect((db.prepare("SELECT saved_by FROM ws_file WHERE node_id = ?").get(tutor.id) as { saved_by: string }).saved_by).toBe("tutor");
    expect((db.prepare("SELECT saved_by FROM ws_file_revision WHERE node_id = ?").get(tutor.id) as { saved_by: string }).saved_by).toBe("tutor");
  });

  it("a file may be created empty", () => {
    const db = openTestDb();
    const { node } = createNode(db, { kind: "file", title: "blank", file: { type: "markdown" } });
    expect((db.prepare("SELECT body FROM ws_file WHERE node_id = ?").get(node.id) as { body: string | null }).body).toBeNull();
  });

  it("runs the type's validate, and a rejected body leaves nothing behind", () => {
    const db = openTestDb();
    registerFileType({
      type: "ws-graph-strict",
      storage: "text",
      appendable: false,
      kinds: () => [],
      validate: (b) => (b?.startsWith("ok") ? null : "must start with ok"),
    });
    const f = createNode(db, { kind: "folder", title: "f" }).node;
    const before = count(db, "ws_node");
    try {
      createNode(db, { kind: "file", title: "bad", file: { type: "ws-graph-strict", body: "nope" }, place_in: { container_id: f.id } });
      throw new Error("expected invalid_content");
    } catch (err) {
      expect((err as DomainError).code).toBe("invalid_content");
      expect((err as DomainError).message).toContain("must start with ok");
    }
    expect(count(db, "ws_node")).toBe(before);
    expect(count(db, "ws_file")).toBe(0);
    expect(createNode(db, { kind: "file", title: "good", file: { type: "ws-graph-strict", body: "ok!" } }).node.title).toBe("good");
  });

  it("an asset file needs an asset_id that exists; text types take no asset", () => {
    const db = openTestDb();
    expect(codeOf(() => createNode(db, { kind: "file", title: "x", file: { type: "asset" } }))).toBe("invalid_input");
    expect(codeOf(() => createNode(db, { kind: "file", title: "x", file: { type: "asset", asset_id: "ghost" } }))).toBe("not_found");
    expect(codeOf(() => createNode(db, { kind: "file", title: "x", file: { type: "asset", body: "text", asset_id: "ghost" } }))).toBe("invalid_input");
    db.prepare("INSERT INTO asset (id, title, type) VALUES ('as1', 'scan', 'file')").run();
    createNode(db, { kind: "file", title: "scan", file: { type: "asset", asset_id: "as1" } });
    expect(codeOf(() => createNode(db, { kind: "file", title: "y", file: { type: "markdown", asset_id: "as1" } }))).toBe("invalid_input");
    expect(count(db, "ws_file")).toBe(1);
  });

  it("only a file takes file content, and a file needs it", () => {
    const db = openTestDb();
    expect(codeOf(() => createNode(db, { kind: "folder", title: "f", file: { type: "markdown" } }))).toBe("invalid_input");
    expect(codeOf(() => createNode(db, { kind: "file", title: "f" }))).toBe("invalid_input");
    expect(count(db, "ws_node")).toBe(0);
  });
});

describe("kind tags", () => {
  it("sets, replaces and clears a tag, stamping updated_at", () => {
    const db = openTestDb();
    const { node } = createNode(db, { kind: "file", title: "hw", kind_tag: "homework", file: { type: "markdown" } });
    expect(node.kind_tag).toBe("homework");
    age(db, node.id);
    expect(setKindTag(db, node.id, "test").kind_tag).toBe("test");
    expect(nodeRow(db, node.id).updated_at).not.toBe(OLD);
    expect(setKindTag(db, node.id, null).kind_tag).toBeNull();
  });
});

describe("every write is atomic and nests inside a caller's transaction", () => {
  it("a failed createNode-with-placement leaves no node behind", () => {
    const db = openTestDb();
    const f = createNode(db, { kind: "folder", title: "f" }).node;
    md(db, "x", { container_id: f.id });
    const before = count(db, "ws_node");
    expect(codeOf(() => md(db, "X", { container_id: f.id }))).toBe("name_taken");
    expect(count(db, "ws_node")).toBe(before);
    expect(count(db, "ws_file")).toBe(1);
    expect(count(db, "ws_file_revision")).toBe(1);
  });

  it("rolls back only its own work inside an outer transaction", () => {
    const db = openTestDb();
    const f = createNode(db, { kind: "folder", title: "f" }).node;
    db.exec("BEGIN");
    const kept = md(db, "kept", { container_id: f.id });
    expect(codeOf(() => md(db, "KEPT", { container_id: f.id }))).toBe("name_taken");
    expect(count(db, "ws_node")).toBe(2);
    db.exec("COMMIT");
    expect(ids(db, kept.node.id)).toHaveLength(1);
  });

  it("the outer transaction can still roll everything back", () => {
    const db = openTestDb();
    db.exec("BEGIN");
    createNode(db, { kind: "folder", title: "f" });
    db.exec("ROLLBACK");
    expect(count(db, "ws_node")).toBe(0);
  });
});

describe("updated_at", () => {
  it("is stamped on the nodes a write changes and not on bystanders", () => {
    const db = openTestDb();
    const a = createNode(db, { kind: "folder", title: "A" }).node;
    const b = createNode(db, { kind: "folder", title: "B" }).node;
    const z = createNode(db, { kind: "folder", title: "Z" }).node;
    const { node, placement } = md(db, "n", { container_id: a.id });
    const changed = (id: string) => nodeRow(db, id).updated_at !== OLD;
    const reset = () => age(db, a.id, b.id, z.id, node.id);

    reset();
    const inB = placeNode(db, { container_id: b.id, child_id: node.id, name: "n2" });
    expect([changed(a.id), changed(b.id), changed(z.id)]).toEqual([false, true, false]);

    reset();
    renamePlacement(db, placement!.id, "renamed");
    expect([changed(a.id), changed(b.id), changed(z.id)]).toEqual([true, false, false]);

    reset();
    movePlacement(db, placement!.id, z.id);
    expect([changed(a.id), changed(b.id), changed(z.id)]).toEqual([true, false, true]);

    reset();
    renameNode(db, node.id, "retitled");
    expect([changed(node.id), changed(a.id), changed(b.id), changed(z.id)]).toEqual([true, false, false, false]);

    reset();
    removePlacement(db, inB.id);
    expect([changed(a.id), changed(b.id), changed(z.id)]).toEqual([false, true, false]);

    reset();
    destroyNode(db, node.id);
    expect([changed(node.id), changed(a.id), changed(b.id), changed(z.id)]).toEqual([true, false, false, false]);

    reset();
    restoreNode(db, node.id);
    expect([changed(node.id), changed(a.id), changed(b.id), changed(z.id)]).toEqual([true, false, false, false]);

    destroyNode(db, node.id);
    reset();
    purgeNode(db, node.id);
    expect([changed(a.id), changed(b.id), changed(z.id)]).toEqual([false, false, true]);
  });
});

// ---------------------------------------------------------------------------
// The ruling: "unplaced" means a live node with no placement in a live
// (non-trashed) container. removePlacement and destroyNode use that one
// definition (listRoots and search in reads.ts use it too).
// ---------------------------------------------------------------------------

describe("unplaced means no placement in a live container", () => {
  it("removing a file's last live placement leaves it unplaced even when a placement in a trashed container remains", () => {
    const db = openTestDb();
    const course = createNode(db, { kind: "course", title: "micro" }).node;
    const folder = createNode(db, { kind: "folder", title: "old" }).node;
    const { node, placement } = md(db, "n", { container_id: course.id });
    placeNode(db, { container_id: folder.id, child_id: node.id });
    destroyNode(db, folder.id); // the folder is trashed; node keeps a hidden placement in it
    expect(removePlacement(db, placement!.id).became_unplaced).toBe(true);
    expect(count(db, "ws_placement")).toBe(1); // the hidden placement in the trashed folder is still there
  });

  it("a remaining placement in a live container still means not unplaced", () => {
    const db = openTestDb();
    const a = createNode(db, { kind: "folder", title: "a" }).node;
    const b = createNode(db, { kind: "folder", title: "b" }).node;
    const dead = createNode(db, { kind: "folder", title: "dead" }).node;
    const { node, placement } = md(db, "n", { container_id: a.id });
    placeNode(db, { container_id: b.id, child_id: node.id });
    placeNode(db, { container_id: dead.id, child_id: node.id });
    destroyNode(db, dead.id);
    expect(removePlacement(db, placement!.id).became_unplaced).toBe(false); // still live in b
  });

  it("destroy with orphans takes a file placed in the course and in its subfolder, but not one placed in another live container", () => {
    const db = openTestDb();
    const course = createNode(db, { kind: "course", title: "micro" }).node;
    const sub = createNode(db, { kind: "folder", title: "unit 1", place_in: { container_id: course.id } }).node;
    const both = md(db, "in-course-and-sub", { container_id: course.id }).node;
    placeNode(db, { container_id: sub.id, child_id: both.id });
    const subOnly = md(db, "sub-only", { container_id: sub.id }).node;
    const other = createNode(db, { kind: "folder", title: "elsewhere" }).node;
    const shared = md(db, "also-elsewhere", { container_id: course.id }).node;
    placeNode(db, { container_id: sub.id, child_id: shared.id });
    placeNode(db, { container_id: other.id, child_id: shared.id });
    const stranger = md(db, "unrelated-and-unplaced").node;

    const { trashed } = destroyNode(db, course.id, { withOrphans: true });
    expect(trashed.sort()).toEqual([course.id, sub.id, both.id, subOnly.id].sort());
    expect(nodeRow(db, shared.id).trashed_at).toBeNull();
    expect(nodeRow(db, stranger.id).trashed_at).toBeNull(); // not under the course at all
  });

  it("a placement in an already-trashed container does not keep a child out of the orphans", () => {
    const db = openTestDb();
    const course = createNode(db, { kind: "course", title: "micro" }).node;
    const gone = createNode(db, { kind: "folder", title: "gone" }).node;
    const { node } = md(db, "n", { container_id: course.id });
    placeNode(db, { container_id: gone.id, child_id: node.id });
    destroyNode(db, gone.id);
    expect(destroyNode(db, course.id, { withOrphans: true }).trashed.sort()).toEqual([course.id, node.id].sort());
  });
});
