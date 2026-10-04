import { describe, it, expect } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "../src/domain/errors.js";
import { normalizeKindTag, normalizeName, sameName } from "../src/domain/workspace/names.js";
import { formatHooks, listFormats, registerFormat } from "../src/domain/workspace/formats.js";
import { CONTAINER_KINDS, MAY_HOLD, NODE_KINDS, SUGGESTED_KIND_TAGS } from "../src/domain/workspace/types.js";
import type { NodeKind } from "../src/domain/workspace/types.js";
import {
  archivedPlacements,
  createNode,
  deleteNode,
  deletePreview,
  getNode,
  move,
  place,
  purge,
  rename,
  restore,
  retitle,
  setKindTag,
  trash,
} from "../src/domain/workspace/graph.js";
import { openTestDb } from "./helpers.js";

// ---------------------------------------------------------------------------
// The workspace graph's writes, against the approved spec
// (Learn spec/osmosis/workspace/02-data-layer.md §2-§5, §7). Every refusal
// asserts its exact snake_case error code, never a message pattern.
// ---------------------------------------------------------------------------

type Db = DatabaseSync;

// The code a call fails with, or undefined when it does not fail. Anything
// that is not a DomainError is a bug and is rethrown.
function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
}

function errorOf(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error("expected the call to throw a DomainError");
}

// A node of any kind. A file is a markdown file, because the registry has it.
function make(db: Db, kind: NodeKind, title: string, container?: { id: string }, name?: string) {
  return createNode(
    db,
    kind === "file"
      ? { kind, title, format: "markdown", body: `# ${title}`, container_id: container?.id, name }
      : { kind, title, container_id: container?.id, name }
  ).node;
}

interface PlacementDump {
  id: string;
  container_id: string;
  child_id: string;
  name: string;
  archived_at: string | null;
}

const placementsOf = (db: Db, childId: string) =>
  db.prepare("SELECT id, container_id, child_id, name, archived_at FROM ws_placement WHERE child_id = ? ORDER BY name, id").all(childId) as unknown as PlacementDump[];

function placementIn(db: Db, containerId: string, childId: string): PlacementDump {
  const row = db
    .prepare("SELECT id, container_id, child_id, name, archived_at FROM ws_placement WHERE container_id = ? AND child_id = ?")
    .get(containerId, childId) as unknown as PlacementDump | undefined;
  if (!row) throw new Error(`no placement of ${childId} in ${containerId}`);
  return row;
}

// Every row of the three tables, so a refused write can be shown to have
// changed nothing, updated_at included.
const dump = (db: Db) => ({
  nodes: db.prepare("SELECT * FROM ws_node ORDER BY id").all(),
  placements: db.prepare("SELECT * FROM ws_placement ORDER BY id").all(),
  content: db.prepare("SELECT * FROM ws_content ORDER BY node_id, version").all(),
});

const counts = (db: Db) => ({
  nodes: (db.prepare("SELECT COUNT(*) AS n FROM ws_node").get() as { n: number }).n,
  placements: (db.prepare("SELECT COUNT(*) AS n FROM ws_placement").get() as { n: number }).n,
  content: (db.prepare("SELECT COUNT(*) AS n FROM ws_content").get() as { n: number }).n,
});

const backdate = (db: Db) => db.exec("UPDATE ws_node SET updated_at = '2000-01-01 00:00:00'");
const updatedAt = (db: Db, id: string) => (db.prepare("SELECT updated_at FROM ws_node WHERE id = ?").get(id) as { updated_at: string }).updated_at;

// Formats used by the tests below. The registry is process-wide and refuses
// a duplicate, so each has its own name.
registerFormat({ format: "t-shout", searchText: (b) => (b ?? "").toUpperCase() });
registerFormat({ format: "t-picky", validate: (b) => (b?.includes("bad") ? "no bad words here" : null) });
registerFormat({
  format: "t-throws-validate",
  validate: () => {
    throw new Error("validate exploded");
  },
});
registerFormat({
  format: "t-throws-search",
  searchText: () => {
    throw new Error("search exploded");
  },
});
registerFormat({ format: "t-bare" });

// ---------------------------------------------------------------------------
// 1. Containment — all 25 pairs
// ---------------------------------------------------------------------------

// Written out from spec §3, not read from MAY_HOLD, so the test checks the code
// against the spec and not the code against itself.
const ALLOWED: Record<NodeKind, NodeKind[]> = {
  trajectory: ["track", "course", "folder", "file"],
  track: ["course", "folder", "file"],
  course: ["folder", "file"],
  folder: ["folder", "file"],
  file: [],
};

describe("containment (spec §3)", () => {
  for (const container of NODE_KINDS) {
    for (const child of NODE_KINDS) {
      const allowed = ALLOWED[container].includes(child);
      it(`a ${container} ${allowed ? "accepts" : "refuses"} a ${child}`, () => {
        const db = openTestDb();
        const c = make(db, container, "C");
        const k = make(db, child, "K");
        if (allowed) {
          expect(place(db, { container_id: c.id, child_id: k.id })).toMatchObject({ container_id: c.id, child_id: k.id, name: "K", archived_at: null });
        } else {
          expect(codeOf(() => place(db, { container_id: c.id, child_id: k.id }))).toBe("containment_not_allowed");
          expect(placementsOf(db, k.id)).toEqual([]);
        }
      });
    }
  }

  it("the matrix in code is the spec's matrix, and a file is not a container", () => {
    for (const kind of NODE_KINDS) expect([...MAY_HOLD[kind]].sort(), kind).toEqual([...ALLOWED[kind]].sort());
    expect([...CONTAINER_KINDS]).toEqual(["trajectory", "track", "course", "folder"]);
  });

  it("the refusal names both kinds", () => {
    const db = openTestDb();
    const err = errorOf(() => place(db, { container_id: make(db, "track", "t").id, child_id: make(db, "track", "u").id }));
    expect(err.code).toBe("containment_not_allowed");
    expect(err.message).toMatch(/track/);
    const folderInCourse = errorOf(() => place(db, { container_id: make(db, "folder", "f").id, child_id: make(db, "course", "c").id }));
    expect(folderInCourse.message).toMatch(/folder/);
    expect(folderInCourse.message).toMatch(/course/);
  });

  it("createNode into a container enforces it too, and leaves no node behind", () => {
    const db = openTestDb();
    const course = make(db, "course", "c");
    const before = counts(db);
    expect(codeOf(() => createNode(db, { kind: "track", title: "t", container_id: course.id }))).toBe("containment_not_allowed");
    expect(counts(db)).toEqual(before);
  });

  it("a course placed in a trajectory and in a track inside it is two placements, not an error", () => {
    const db = openTestDb();
    const traj = make(db, "trajectory", "quant");
    const track = make(db, "track", "year 1", traj);
    const course = make(db, "course", "micro", traj);
    place(db, { container_id: track.id, child_id: course.id });
    expect(placementsOf(db, course.id)).toHaveLength(2);
  });

  it("refuses a node that is not there, naming the missing one", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    expect(codeOf(() => place(db, { container_id: folder.id, child_id: "nope" }))).toBe("not_found");
    expect(codeOf(() => place(db, { container_id: "nope", child_id: folder.id }))).toBe("not_found");
    expect(codeOf(() => getNode(db, "nope"))).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
// 2. Cycles — across every placement, archived ones included
// ---------------------------------------------------------------------------

describe("cycles (spec §5.1)", () => {
  function chain(db: Db) {
    const f1 = make(db, "folder", "f1");
    const f2 = make(db, "folder", "f2", f1);
    const f3 = make(db, "folder", "f3", f2);
    return { f1, f2, f3 };
  }

  it("refuses a node placed in itself", () => {
    const db = openTestDb();
    const { f1 } = chain(db);
    expect(codeOf(() => place(db, { container_id: f1.id, child_id: f1.id }))).toBe("cycle_rejected");
  });

  it("refuses a direct cycle (an ancestor into its child)", () => {
    const db = openTestDb();
    const { f1, f2 } = chain(db);
    expect(codeOf(() => place(db, { container_id: f2.id, child_id: f1.id }))).toBe("cycle_rejected");
  });

  it("refuses an indirect cycle (an ancestor into a grandchild)", () => {
    const db = openTestDb();
    const { f1, f3 } = chain(db);
    expect(codeOf(() => place(db, { container_id: f3.id, child_id: f1.id }))).toBe("cycle_rejected");
  });

  it("still refuses when the path runs through an archived node and archived placements", () => {
    const db = openTestDb();
    const { f1, f2, f3 } = chain(db);
    deleteNode(db, f2.id);
    expect(getNode(db, f2.id).archived_at).not.toBeNull();
    expect(placementIn(db, f1.id, f2.id).archived_at).not.toBeNull();
    // f3 and f1 are both live; only the way between them is archived.
    expect(codeOf(() => place(db, { container_id: f3.id, child_id: f1.id }))).toBe("cycle_rejected");
  });

  it("allows a node twice in one subtree, which is no cycle", () => {
    const db = openTestDb();
    const { f1, f2, f3 } = chain(db);
    expect(place(db, { container_id: f1.id, child_id: f3.id })).toMatchObject({ container_id: f1.id, child_id: f3.id });
    expect(placementsOf(db, f3.id)).toHaveLength(2);
    expect(f2.id).toBeTruthy();
  });

  it("move re-checks it", () => {
    const db = openTestDb();
    const { f1, f2, f3 } = chain(db);
    const p = placementIn(db, f1.id, f2.id);
    const before = dump(db);
    expect(codeOf(() => move(db, p.id, f3.id))).toBe("cycle_rejected");
    expect(dump(db)).toEqual(before);
  });
});

describe("placing and archived nodes", () => {
  it("refuses to place into an archived container or to place an archived child, with `archived`", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    const file = make(db, "file", "x");
    deleteNode(db, folder.id);
    expect(codeOf(() => place(db, { container_id: folder.id, child_id: file.id }))).toBe("archived");
    const live = make(db, "folder", "live");
    const gone = make(db, "file", "gone");
    deleteNode(db, gone.id);
    expect(codeOf(() => place(db, { container_id: live.id, child_id: gone.id }))).toBe("archived");
  });

  it("refuses the same pair twice with `already_placed`, even under another name", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    const file = make(db, "file", "x", folder);
    expect(codeOf(() => place(db, { container_id: folder.id, child_id: file.id, name: "other" }))).toBe("already_placed");
  });

  it("checks containment before archived, then cycles", () => {
    const db = openTestDb();
    const track = make(db, "track", "t");
    const traj = make(db, "trajectory", "q");
    deleteNode(db, track.id);
    expect(codeOf(() => place(db, { container_id: track.id, child_id: traj.id }))).toBe("containment_not_allowed");
  });
});

// ---------------------------------------------------------------------------
// 3. Names and titles
// ---------------------------------------------------------------------------

describe("names (spec §4.2)", () => {
  it("normalizes to NFC and trims", () => {
    expect(normalizeName("  Café notes ")).toBe("Café notes");
  });

  it("refuses empty, slash, control characters and over-long names with invalid_name", () => {
    for (const bad of ["", "   ", "a/b", "a\u0007b", "a\u007fb", "a\nb", "a\u0000b", "x".repeat(201)]) {
      expect(codeOf(() => normalizeName(bad)), JSON.stringify(bad)).toBe("invalid_name");
    }
    expect(normalizeName("x".repeat(200))).toHaveLength(200);
  });

  it("counts codepoints, not UTF-16 units", () => {
    expect([...normalizeName("\u{1F600}".repeat(200))]).toHaveLength(200);
    expect(codeOf(() => normalizeName("\u{1F600}".repeat(201)))).toBe("invalid_name");
  });

  it("compares case-insensitively beyond ASCII", () => {
    expect(sameName("Ελαστικότητα", "ΕΛΑΣΤΙΚΌΤΗΤΑ")).toBe(true);
    expect(sameName("notes", "Notes ")).toBe(true);
    expect(sameName("notes", "note")).toBe(false);
  });

  it("a clash is name_taken, whose message and detail.suggestion give the lowest free `x (2)`", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    make(db, "file", "x", folder);
    const other = make(db, "file", "other");
    const err = errorOf(() => place(db, { container_id: folder.id, child_id: other.id, name: "x" }));
    expect(err.code).toBe("name_taken");
    expect(err.detail).toEqual({ suggestion: "x (2)" });
    expect(err.message).toContain("x (2)");
    expect(placementsOf(db, other.id)).toEqual([]);
  });

  it("the clash is case-insensitive, and the suggestion keeps the requested spelling", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    make(db, "file", "X", folder);
    const other = make(db, "file", "other");
    const err = errorOf(() => place(db, { container_id: folder.id, child_id: other.id, name: "x" }));
    expect(err.code).toBe("name_taken");
    expect(err.detail).toEqual({ suggestion: "x (2)" });
  });

  it("the suggestion skips suffixes that are taken, and takes the lowest gap", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    make(db, "file", "x", folder);
    make(db, "file", "x (2)", folder);
    make(db, "file", "x (4)", folder);
    const other = make(db, "file", "other");
    expect(errorOf(() => place(db, { container_id: folder.id, child_id: other.id, name: "x" })).detail).toEqual({ suggestion: "x (3)" });
  });

  it("a suffix never pushes a name past 200 codepoints", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    const long = "a".repeat(200);
    make(db, "file", long, folder);
    const other = make(db, "file", "other");
    const { suggestion } = errorOf(() => place(db, { container_id: folder.id, child_id: other.id, name: long })).detail as { suggestion: string };
    expect([...suggestion]).toHaveLength(200);
    expect(suggestion.endsWith(" (2)")).toBe(true);
    expect(normalizeName(suggestion)).toBe(suggestion);
  });

  it("names are unique per container, not across containers", () => {
    const db = openTestDb();
    const a = make(db, "folder", "a");
    const b = make(db, "folder", "b");
    const file = make(db, "file", "notes", a);
    expect(place(db, { container_id: b.id, child_id: make(db, "file", "other").id, name: "notes" }).name).toBe("notes");
    expect(file.id).toBeTruthy();
  });

  it("an archived child holds no name, so its name is free again", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    const first = make(db, "file", "x", folder);
    deleteNode(db, first.id);
    expect(make(db, "file", "x", folder, "x")).toBeTruthy();
    expect(placementsOf(db, first.id)[0].archived_at).not.toBeNull();
  });

  it("a trashed placement frees its name too", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    const first = make(db, "file", "x", folder);
    trash(db, placementIn(db, folder.id, first.id).id);
    expect(make(db, "file", "x", folder).id).toBeTruthy();
  });

  it("a title follows the same grammar, and is normalized", () => {
    const db = openTestDb();
    const file = createNode(db, { kind: "file", title: "  Café notes ", format: "markdown", body: "" }).node;
    expect(file.title).toBe("Café notes");
    for (const bad of ["", "a/b", "a\u0007b", "x".repeat(201)]) {
      expect(codeOf(() => createNode(db, { kind: "folder", title: bad })), JSON.stringify(bad)).toBe("invalid_name");
      expect(codeOf(() => retitle(db, file.id, bad)), JSON.stringify(bad)).toBe("invalid_name");
    }
  });

  it("a node's title is its default name when it is placed, and an explicit name wins", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    const a = make(db, "file", "Elasticity notes");
    expect(place(db, { container_id: folder.id, child_id: a.id }).name).toBe("Elasticity notes");
    const b = make(db, "file", "Other");
    expect(place(db, { container_id: folder.id, child_id: b.id, name: "  Renamed " }).name).toBe("Renamed");
  });
});

describe("kind tags (spec §4.3)", () => {
  it("normalizeKindTag accepts null and the grammar, and refuses the rest with invalid_input", () => {
    expect(normalizeKindTag(null)).toBeNull();
    expect(normalizeKindTag(undefined)).toBeNull();
    for (const ok of ["source", "a", "my-tag_2", "x".repeat(32)]) expect(normalizeKindTag(ok)).toBe(ok);
    for (const bad of ["", "Source", "2fast", "-x", "_x", "has space", "slash/ed", "x".repeat(33), "ünï"]) {
      expect(codeOf(() => normalizeKindTag(bad)), JSON.stringify(bad)).toBe("invalid_input");
    }
    expect(codeOf(() => normalizeKindTag(5 as unknown as string))).toBe("invalid_input");
  });

  it("the suggested tags are the five of the spec", () => {
    expect([...SUGGESTED_KIND_TAGS]).toEqual(["source", "resource", "homework", "test", "flowchart"]);
  });
});

// ---------------------------------------------------------------------------
// 4. trash
// ---------------------------------------------------------------------------

describe("trash (spec §5.2)", () => {
  it("removes one of two placements and leaves the other", () => {
    const db = openTestDb();
    const a = make(db, "folder", "a");
    const b = make(db, "folder", "b");
    const file = make(db, "file", "x", a);
    const second = place(db, { container_id: b.id, child_id: file.id, name: "Supporting material" });
    const first = placementIn(db, a.id, file.id);
    const out = trash(db, first.id);
    expect(out.removed).toMatchObject({ id: first.id, container_id: a.id, child_id: file.id, name: "x" });
    expect(out.became_unplaced).toBe(false);
    expect(placementsOf(db, file.id)).toMatchObject([{ id: second.id, container_id: b.id, name: "Supporting material" }]);
  });

  it("the last placement gives became_unplaced, and the node is neither archived nor destroyed", () => {
    const db = openTestDb();
    const a = make(db, "folder", "a");
    const file = make(db, "file", "x", a);
    const out = trash(db, placementIn(db, a.id, file.id).id);
    expect(out.became_unplaced).toBe(true);
    expect(placementsOf(db, file.id)).toEqual([]);
    const row = getNode(db, file.id);
    expect(row.archived_at).toBeNull();
    expect(row.archive_batch).toBeNull();
  });

  it("deletes the row: nothing is left to restore", () => {
    const db = openTestDb();
    const a = make(db, "folder", "a");
    const file = make(db, "file", "x", a);
    trash(db, placementIn(db, a.id, file.id).id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ws_placement").get()).toEqual({ n: 0 });
    expect(archivedPlacements(db, file.id)).toEqual([]);
  });

  it("a placement that remains inside an archived container does not count as live", () => {
    const db = openTestDb();
    const live = make(db, "folder", "live");
    const dead = make(db, "folder", "dead");
    const file = make(db, "file", "x", live);
    place(db, { container_id: dead.id, child_id: file.id });
    deleteNode(db, dead.id);
    // The file has one live placement (in `live`) and one hidden one (in `dead`).
    expect(trash(db, placementIn(db, live.id, file.id).id).became_unplaced).toBe(true);
  });

  it("trashing a placement that was already hidden does not make the node newly unplaced", () => {
    const db = openTestDb();
    const dead = make(db, "folder", "dead");
    const file = make(db, "file", "x", dead);
    deleteNode(db, dead.id);
    expect(trash(db, placementIn(db, dead.id, file.id).id).became_unplaced).toBe(false);
  });

  it("stamps the container it left, and refuses an unknown placement", () => {
    const db = openTestDb();
    const a = make(db, "folder", "a");
    const file = make(db, "file", "x", a);
    backdate(db);
    trash(db, placementIn(db, a.id, file.id).id);
    expect(updatedAt(db, a.id)).not.toBe("2000-01-01 00:00:00");
    expect(codeOf(() => trash(db, "nope"))).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
// 5. delete
// ---------------------------------------------------------------------------

describe("delete (spec §5.3)", () => {
  it("marks the node and every one of its placements, and shares one batch", () => {
    const db = openTestDb();
    const t1 = make(db, "track", "t1");
    const t2 = make(db, "track", "t2");
    const course = make(db, "course", "micro", t1);
    place(db, { container_id: t2.id, child_id: course.id, name: "Micro" });
    const out = deleteNode(db, course.id);
    expect(out.archived).toEqual([course.id]);
    expect(out.batch).toEqual(expect.any(String));
    const node = getNode(db, course.id);
    expect(node.archived_at).not.toBeNull();
    expect(node.archive_batch).toBe(out.batch);
    const rows = placementsOf(db, course.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.archived_at, row.name).not.toBeNull();
  });

  it("leaves a container's children, and their placements in it, unmarked", () => {
    const db = openTestDb();
    const course = make(db, "course", "micro");
    const kid = make(db, "file", "kid", course);
    deleteNode(db, course.id);
    expect(getNode(db, kid.id).archived_at).toBeNull();
    expect(placementsOf(db, kid.id)).toMatchObject([{ container_id: course.id, archived_at: null }]);
  });

  it("two deletes get two batches", () => {
    const db = openTestDb();
    const a = make(db, "file", "a");
    const b = make(db, "file", "b");
    expect(deleteNode(db, a.id).batch).not.toBe(deleteNode(db, b.id).batch);
  });

  it("refuses to delete what is already archived", () => {
    const db = openTestDb();
    const a = make(db, "file", "a");
    deleteNode(db, a.id);
    expect(codeOf(() => deleteNode(db, a.id))).toBe("archived");
    expect(codeOf(() => deletePreview(db, a.id))).toBe("archived");
    expect(codeOf(() => deleteNode(db, "nope"))).toBe("not_found");
  });

  it("stamps the node, and the containers it vanishes from", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    const file = make(db, "file", "x", folder);
    backdate(db);
    deleteNode(db, file.id);
    expect(updatedAt(db, file.id)).not.toBe("2000-01-01 00:00:00");
    expect(updatedAt(db, folder.id)).not.toBe("2000-01-01 00:00:00");
  });

  describe("orphans", () => {
    // trajectory quant ⊃ course micro ⊃ { unit 1 ⊃ { sub ⊃ deep, inUnit, both }, both, shared }, and `shared` is also in `elsewhere`.
    function fixture() {
      const db = openTestDb();
      const traj = make(db, "trajectory", "quant");
      const course = make(db, "course", "micro", traj);
      const elsewhere = make(db, "folder", "elsewhere");
      const unit = make(db, "folder", "unit 1", course);
      const sub = make(db, "folder", "sub", unit);
      const deep = make(db, "file", "deep", sub);
      const inUnit = make(db, "file", "inUnit", unit);
      const both = make(db, "file", "both", course);
      place(db, { container_id: unit.id, child_id: both.id });
      const shared = make(db, "file", "shared", course);
      place(db, { container_id: elsewhere.id, child_id: shared.id });
      return { db, traj, course, elsewhere, unit, sub, deep, inUnit, both, shared };
    }

    it("deletePreview lists appears_in and the fixpoint orphans, and changes nothing", () => {
      const { db, traj, course, unit, sub, deep, inUnit, both, shared } = fixture();
      const before = dump(db);
      const preview = deletePreview(db, course.id);
      expect(preview.appears_in).toEqual([
        { placement_id: placementIn(db, traj.id, course.id).id, name: "micro", container: { id: traj.id, kind: "trajectory", title: "quant" } },
      ]);
      // A course plus a subfolder (and what is only in it, however deep); the file also placed elsewhere is not an orphan.
      expect(preview.orphans.map((o) => o.id).sort()).toEqual([unit.id, sub.id, deep.id, inUnit.id, both.id].sort());
      expect(preview.orphans.map((o) => o.id)).not.toContain(shared.id);
      expect(preview.orphans.find((o) => o.id === both.id)).toMatchObject({ kind: "file", title: "both", format: "markdown", placement_count: 2, archived_at: null });
      expect(preview.orphans.find((o) => o.id === unit.id)).toMatchObject({ kind: "folder", format: null, has_children: true });
      expect(dump(db)).toEqual(before);
    });

    it("a node with no live placement has an empty appears_in", () => {
      const db = openTestDb();
      const folder = make(db, "folder", "f");
      expect(deletePreview(db, folder.id)).toEqual({ appears_in: [], orphans: [] });
    });

    it("without with_orphans only the node is archived", () => {
      const { db, course, unit, both } = fixture();
      expect(deleteNode(db, course.id).archived).toEqual([course.id]);
      expect(getNode(db, unit.id).archived_at).toBeNull();
      expect(getNode(db, both.id).archived_at).toBeNull();
    });

    it("with_orphans archives exactly the orphans, in the same batch, and marks their placements", () => {
      const { db, course, elsewhere, unit, sub, deep, inUnit, both, shared } = fixture();
      const out = deleteNode(db, course.id, { with_orphans: true });
      expect(out.archived[0]).toBe(course.id);
      expect([...out.archived].sort()).toEqual([course.id, unit.id, sub.id, deep.id, inUnit.id, both.id].sort());
      for (const id of out.archived) {
        const node = getNode(db, id);
        expect(node.archived_at, id).not.toBeNull();
        expect(node.archive_batch, id).toBe(out.batch);
        for (const row of placementsOf(db, id)) expect(row.archived_at, `${id} ${row.name}`).not.toBeNull();
      }
      // The shared file is untouched, and so are its placements in the archived course and in the live folder.
      expect(getNode(db, shared.id).archived_at).toBeNull();
      expect(getNode(db, shared.id).archive_batch).toBeNull();
      expect(placementsOf(db, shared.id).map((r) => r.archived_at)).toEqual([null, null]);
      expect(placementIn(db, elsewhere.id, shared.id).archived_at).toBeNull();
    });

    it("a file placed in a live container and also in the course goes only if the live container is inside the deleted subtree", () => {
      const db = openTestDb();
      const course = make(db, "course", "c");
      const unit = make(db, "folder", "u", course);
      const file = make(db, "file", "x", unit);
      const live = make(db, "folder", "live");
      place(db, { container_id: live.id, child_id: file.id });
      expect(deletePreview(db, course.id).orphans.map((o) => o.id)).toEqual([unit.id]);
    });

    it("a placement already in an archived container does not keep a node from being an orphan", () => {
      const db = openTestDb();
      const course = make(db, "course", "c");
      const dead = make(db, "folder", "dead");
      const file = make(db, "file", "x", course);
      place(db, { container_id: dead.id, child_id: file.id });
      deleteNode(db, dead.id);
      expect(deletePreview(db, course.id).orphans.map((o) => o.id)).toEqual([file.id]);
    });
  });
});

// ---------------------------------------------------------------------------
// 6. restore
// ---------------------------------------------------------------------------

describe("restore (spec §5.4)", () => {
  function threePlaces(db: Db) {
    const a = make(db, "folder", "A");
    const b = make(db, "folder", "B");
    const c = make(db, "folder", "C");
    const file = make(db, "file", "notes", a);
    place(db, { container_id: b.id, child_id: file.id, name: "Alt" });
    place(db, { container_id: c.id, child_id: file.id, name: "Third" });
    return { a, b, c, file, pa: placementIn(db, a.id, file.id), pb: placementIn(db, b.id, file.id), pc: placementIn(db, c.id, file.id) };
  }

  it("archivedPlacements lists the marked placements with their containers", () => {
    const db = openTestDb();
    const { a, b, c, file } = threePlaces(db);
    expect(archivedPlacements(db, file.id)).toEqual([]);
    deleteNode(db, file.id);
    const listed = archivedPlacements(db, file.id);
    expect(listed.map((l) => l.name).sort()).toEqual(["Alt", "Third", "notes"]);
    expect(listed.find((l) => l.name === "Alt")).toEqual({
      placement_id: placementIn(db, b.id, file.id).id,
      name: "Alt",
      container: { id: b.id, kind: "folder", title: "B", archived: false },
    });
    deleteNode(db, c.id);
    expect(archivedPlacements(db, file.id).find((l) => l.name === "Third")!.container.archived).toBe(true);
    expect(a.id).toBeTruthy();
    expect(codeOf(() => archivedPlacements(db, "nope"))).toBe("not_found");
  });

  it("a chosen subset revives only those placements; the unchosen one is dropped", () => {
    const db = openTestDb();
    const { file, pa, pb, pc } = threePlaces(db);
    const { batch } = deleteNode(db, file.id);
    const out = restore(db, file.id, [pa.id, pb.id]);
    expect(out.restored).toBe(file.id);
    expect(out.placements).toEqual([
      { placement_id: pa.id, name: "notes", renamed: false },
      { placement_id: pb.id, name: "Alt", renamed: false },
    ]);
    expect(out.skipped).toEqual([]);
    expect(out.batch_mates).toEqual([]);
    const node = getNode(db, file.id);
    expect(node.archived_at).toBeNull();
    expect(node.archive_batch).toBeNull();
    expect(node.archive_batch).not.toBe(batch);
    const rows = placementsOf(db, file.id);
    expect(rows.map((r) => r.id).sort()).toEqual([pa.id, pb.id].sort());
    for (const row of rows) expect(row.archived_at, row.name).toBeNull();
    expect(db.prepare("SELECT 1 FROM ws_placement WHERE id = ?").get(pc.id)).toBeUndefined();
  });

  it("choosing none restores the node unplaced, with every old placement dropped", () => {
    const db = openTestDb();
    const { file } = threePlaces(db);
    deleteNode(db, file.id);
    const out = restore(db, file.id, []);
    expect(out.placements).toEqual([]);
    expect(out.skipped).toEqual([]);
    expect(getNode(db, file.id).archived_at).toBeNull();
    expect(placementsOf(db, file.id)).toEqual([]);
  });

  it("a name that collides is renamed to the lowest free `name (n)`, and reported", () => {
    const db = openTestDb();
    const a = make(db, "folder", "A");
    const file = make(db, "file", "notes", a);
    deleteNode(db, file.id);
    const squatter = make(db, "file", "notes", a);
    const p = placementsOf(db, file.id)[0];
    const out = restore(db, file.id, [p.id]);
    expect(out.placements).toEqual([{ placement_id: p.id, name: "notes (2)", renamed: true }]);
    expect(placementIn(db, a.id, file.id).name).toBe("notes (2)");
    expect(placementIn(db, a.id, squatter.id).name).toBe("notes");
  });

  it("skips a chosen placement whose container is still archived: it stays marked", () => {
    const db = openTestDb();
    const live = make(db, "folder", "live");
    const dead = make(db, "folder", "dead");
    const file = make(db, "file", "f", live);
    place(db, { container_id: dead.id, child_id: file.id, name: "g" });
    const pLive = placementIn(db, live.id, file.id);
    const pDead = placementIn(db, dead.id, file.id);
    deleteNode(db, file.id);
    deleteNode(db, dead.id);
    const out = restore(db, file.id, [pLive.id, pDead.id]);
    expect(out.skipped).toEqual([{ placement_id: pDead.id, reason: "container_archived" }]);
    expect(out.placements).toEqual([{ placement_id: pLive.id, name: "f", renamed: false }]);
    expect(getNode(db, file.id).archived_at).toBeNull();
    expect(placementIn(db, dead.id, file.id).archived_at).not.toBeNull();
    expect(placementIn(db, live.id, file.id).archived_at).toBeNull();
    // A skipped placement is still listed, so the caller can see what is waiting.
    expect(archivedPlacements(db, file.id).map((l) => l.placement_id)).toEqual([pDead.id]);
  });

  it("restoring that container later revives the skipped placement, and only those whose child is live", () => {
    const db = openTestDb();
    const dead = make(db, "folder", "dead");
    const revives = make(db, "file", "revives", dead);
    const stays = make(db, "file", "stays", dead);
    const hidden = make(db, "file", "hidden", dead);
    deleteNode(db, revives.id);
    deleteNode(db, stays.id);
    deleteNode(db, dead.id);
    restore(db, revives.id, [placementIn(db, dead.id, revives.id).id]); // skipped
    expect(placementIn(db, dead.id, revives.id).archived_at).not.toBeNull();

    const out = restore(db, dead.id, []);
    expect(out.restored).toBe(dead.id);
    expect(placementIn(db, dead.id, revives.id)).toMatchObject({ archived_at: null, name: "revives" });
    // `stays` is still deleted, so its placement is still marked; `hidden` was never marked.
    expect(placementIn(db, dead.id, stays.id).archived_at).not.toBeNull();
    expect(placementIn(db, dead.id, hidden.id).archived_at).toBeNull();
  });

  it("restoring a container revives a skipped placement under a free name when the name was taken meanwhile", () => {
    const db = openTestDb();
    const dead = make(db, "folder", "dead");
    const x = make(db, "file", "x", dead, "a");
    deleteNode(db, x.id); // its name "a" is free again
    const y = make(db, "file", "y", dead, "a");
    deleteNode(db, dead.id);
    restore(db, x.id, [placementIn(db, dead.id, x.id).id]); // skipped: dead is archived
    restore(db, dead.id, []);
    expect(placementIn(db, dead.id, y.id).name).toBe("a");
    expect(placementIn(db, dead.id, x.id)).toMatchObject({ name: "a (2)", archived_at: null });
  });

  it("lists batch_mates, and a mate restored later sees the rest", () => {
    const db = openTestDb();
    const track = make(db, "track", "t");
    const course = make(db, "course", "micro", track);
    const unit = make(db, "folder", "unit", course);
    const file = make(db, "file", "f", course);
    const pUnit = placementIn(db, course.id, unit.id);
    const pFile = placementIn(db, course.id, file.id);
    const pCourse = placementIn(db, track.id, course.id);
    const out = deleteNode(db, course.id, { with_orphans: true });
    expect([...out.archived].sort()).toEqual([course.id, unit.id, file.id].sort());

    const first = restore(db, course.id, [pCourse.id]);
    expect(first.batch_mates.map((m) => m.id).sort()).toEqual([unit.id, file.id].sort());
    for (const mate of first.batch_mates) expect(mate.archived_at).not.toBeNull();
    // The container is back, but its archived children's placements are not revived by it.
    expect(placementIn(db, course.id, unit.id).archived_at).not.toBeNull();

    const second = restore(db, unit.id, [pUnit.id]);
    expect(second.skipped).toEqual([]);
    expect(second.batch_mates.map((m) => m.id)).toEqual([file.id]);
    expect(placementIn(db, course.id, unit.id).archived_at).toBeNull();

    const third = restore(db, file.id, [pFile.id]);
    expect(third.batch_mates).toEqual([]);
  });

  it("a node restored from an upload-style delete with no batch has no batch_mates", () => {
    const db = openTestDb();
    const file = make(db, "file", "f");
    db.prepare("UPDATE ws_node SET archived_at = datetime('now'), archive_batch = NULL WHERE id = ?").run(file.id);
    expect(restore(db, file.id, []).batch_mates).toEqual([]);
  });

  it("refuses a node that is not archived, and placements that are not this node's", () => {
    const db = openTestDb();
    const { file, pa } = threePlaces(db);
    expect(codeOf(() => restore(db, file.id, []))).toBe("not_archived");
    deleteNode(db, file.id);
    const other = make(db, "file", "other", make(db, "folder", "o"));
    const otherPlacement = placementsOf(db, other.id)[0];
    const before = dump(db);
    expect(codeOf(() => restore(db, file.id, [otherPlacement.id]))).toBe("invalid_input");
    expect(codeOf(() => restore(db, file.id, ["nope"]))).toBe("not_found");
    expect(dump(db)).toEqual(before);
    expect(restore(db, file.id, [pa.id, pa.id]).placements).toHaveLength(1);
  });

  describe("an upload whose asset is gone", () => {
    // The wrapper sync makes for an upload: `asset:<id>`, format upload, the asset linked.
    function wrapper(db: Db) {
      db.prepare("INSERT INTO asset (id, title, type, content, extracted_text) VALUES ('a1', 'Paper', 'text', 'body', 'words')").run();
      db.prepare("INSERT INTO ws_node (id, kind, title, kind_tag) VALUES ('asset:a1', 'file', 'Paper', 'source')").run();
      db.prepare("INSERT INTO ws_content (node_id, version, format, asset_id, author) VALUES ('asset:a1', 1, 'upload', 'a1', 'ben')").run();
    }

    it("is refused with upload_gone, and nothing changes (the wrapper stays archived, its places stay marked)", () => {
      const db = openTestDb();
      wrapper(db);
      const course = make(db, "course", "c");
      const placed = place(db, { container_id: course.id, child_id: "asset:a1" });
      deleteNode(db, "asset:a1");
      db.prepare("DELETE FROM asset WHERE id = 'a1'").run(); // ON DELETE SET NULL clears the wrapper's asset_id
      const before = dump(db);
      const err = errorOf(() => restore(db, "asset:a1", [placed.id]));
      expect(err.code).toBe("upload_gone");
      expect(err.message).toBe("The upload was deleted; purge it instead.");
      expect(dump(db)).toEqual(before);
      // Purging is the way out, and it works once the asset is gone.
      expect(purge(db, "asset:a1")).toEqual({ purged: "asset:a1" });
    });

    it("is refused whatever the choice (none chosen too)", () => {
      const db = openTestDb();
      wrapper(db);
      deleteNode(db, "asset:a1");
      db.prepare("DELETE FROM asset WHERE id = 'a1'").run();
      expect(codeOf(() => restore(db, "asset:a1", []))).toBe("upload_gone");
    });

    it("an upload that still exists restores as any file does", () => {
      const db = openTestDb();
      wrapper(db);
      deleteNode(db, "asset:a1");
      expect(restore(db, "asset:a1", []).restored).toBe("asset:a1");
      expect(getNode(db, "asset:a1").archived_at).toBeNull();
    });

    it("an upload is not gone when only a migration cleared the link: its asset exists, so the next sync re-links it", () => {
      const db = openTestDb();
      wrapper(db);
      deleteNode(db, "asset:a1");
      db.prepare("UPDATE ws_content SET asset_id = NULL WHERE node_id = 'asset:a1'").run();
      expect(restore(db, "asset:a1", []).restored).toBe("asset:a1");
    });

    it("a file that merely points at a deleted asset is gone too", () => {
      const db = openTestDb();
      wrapper(db);
      const pointer = createNode(db, { kind: "file", title: "Pointer", format: "upload", asset_id: "a1" }).node;
      deleteNode(db, pointer.id);
      db.prepare("DELETE FROM asset WHERE id = 'a1'").run();
      expect(codeOf(() => restore(db, pointer.id, []))).toBe("upload_gone");
    });

    it("only the latest content counts: a file that moved on to another format restores", () => {
      const db = openTestDb();
      const file = make(db, "file", "x");
      db.prepare("INSERT INTO ws_content (node_id, version, format, asset_id, author) VALUES (?, 2, 'upload', NULL, 'ben')").run(file.id);
      db.prepare("INSERT INTO ws_content (node_id, version, format, body, author) VALUES (?, 3, 'markdown', 'back', 'ben')").run(file.id);
      deleteNode(db, file.id);
      expect(restore(db, file.id, []).restored).toBe(file.id);
    });
  });
});

// ---------------------------------------------------------------------------
// 7. purge
// ---------------------------------------------------------------------------

describe("purge (spec §5.5)", () => {
  it("requires the node to be archived", () => {
    const db = openTestDb();
    const file = make(db, "file", "x");
    const before = dump(db);
    expect(codeOf(() => purge(db, file.id))).toBe("not_archived");
    expect(dump(db)).toEqual(before);
    expect(codeOf(() => purge(db, "nope"))).toBe("not_found");
  });

  it("cascades to its placements and content, and children placed only in it become unplaced", () => {
    const db = openTestDb();
    const track = make(db, "track", "t");
    const course = make(db, "course", "c", track);
    const only = make(db, "file", "only", course);
    const elsewhere = make(db, "folder", "elsewhere");
    const shared = make(db, "file", "shared", course);
    place(db, { container_id: elsewhere.id, child_id: shared.id });
    deleteNode(db, course.id);

    expect(purge(db, course.id)).toEqual({ purged: course.id });
    expect(db.prepare("SELECT 1 FROM ws_node WHERE id = ?").get(course.id)).toBeUndefined();
    // Both the placement of the course in the track and the placements inside it are gone.
    expect(db.prepare("SELECT 1 FROM ws_placement WHERE container_id = ? OR child_id = ?").get(course.id, course.id)).toBeUndefined();
    // The child placed only there is live and unplaced; the shared one keeps its other place.
    expect(getNode(db, only.id).archived_at).toBeNull();
    expect(placementsOf(db, only.id)).toEqual([]);
    expect(placementsOf(db, shared.id)).toMatchObject([{ container_id: elsewhere.id }]);
  });

  it("takes a file's content versions with it", () => {
    const db = openTestDb();
    const file = make(db, "file", "x");
    db.prepare("INSERT INTO ws_content (node_id, version, format, body, author) VALUES (?, 2, 'markdown', 'v2', 'ben')").run(file.id);
    deleteNode(db, file.id);
    purge(db, file.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ws_content WHERE node_id = ?").get(file.id)).toEqual({ n: 0 });
  });

  it("stamps the containers it was in", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    const file = make(db, "file", "x", folder);
    deleteNode(db, file.id);
    backdate(db);
    purge(db, file.id);
    expect(updatedAt(db, folder.id)).not.toBe("2000-01-01 00:00:00");
  });

  describe("an upload's wrapper", () => {
    function wrapper(db: Db) {
      db.prepare("INSERT INTO asset (id, title, type, content, extracted_text) VALUES ('a1', 'Paper', 'text', 'body', 'words')").run();
      db.prepare("INSERT INTO ws_node (id, kind, title, kind_tag) VALUES ('asset:a1', 'file', 'Paper', 'source')").run();
      db.prepare("INSERT INTO ws_content (node_id, version, format, asset_id, author) VALUES ('asset:a1', 1, 'upload', 'a1', 'ben')").run();
    }

    it("can't be purged while its asset exists (asset_in_use), even when archived", () => {
      const db = openTestDb();
      wrapper(db);
      deleteNode(db, "asset:a1");
      expect(codeOf(() => purge(db, "asset:a1"))).toBe("asset_in_use");
      expect(getNode(db, "asset:a1").id).toBe("asset:a1");
    });

    it("can be purged once the asset is gone", () => {
      const db = openTestDb();
      wrapper(db);
      deleteNode(db, "asset:a1");
      db.prepare("DELETE FROM asset WHERE id = 'a1'").run();
      expect(purge(db, "asset:a1")).toEqual({ purged: "asset:a1" });
    });

    it("a file that merely points at an asset is not the wrapper and purges as usual", () => {
      const db = openTestDb();
      wrapper(db);
      const pointer = createNode(db, { kind: "file", title: "Pointer", format: "upload", asset_id: "a1" }).node;
      deleteNode(db, pointer.id);
      expect(purge(db, pointer.id)).toEqual({ purged: pointer.id });
    });
  });
});

// ---------------------------------------------------------------------------
// 8. rename and retitle
// ---------------------------------------------------------------------------

describe("rename and retitle (spec §5.6)", () => {
  it("rename writes one placement, and neither the other placements nor the title", () => {
    const db = openTestDb();
    const a = make(db, "folder", "a");
    const b = make(db, "folder", "b");
    const file = make(db, "file", "Elasticity notes", a);
    place(db, { container_id: b.id, child_id: file.id });
    const p = placementIn(db, a.id, file.id);
    backdate(db);
    const renamed = rename(db, p.id, "  Supporting material ");
    expect(renamed).toMatchObject({ id: p.id, name: "Supporting material", container_id: a.id });
    expect(placementsOf(db, file.id).map((r) => r.name).sort()).toEqual(["Elasticity notes", "Supporting material"]);
    expect(getNode(db, file.id).title).toBe("Elasticity notes");
    expect(updatedAt(db, a.id)).not.toBe("2000-01-01 00:00:00");
    expect(updatedAt(db, b.id)).toBe("2000-01-01 00:00:00");
    expect(updatedAt(db, file.id)).toBe("2000-01-01 00:00:00");
  });

  it("rename refuses a taken name with name_taken and a suggestion, and changes nothing", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    make(db, "file", "Notes", folder);
    const other = make(db, "file", "Other", folder);
    const before = dump(db);
    const err = errorOf(() => rename(db, placementIn(db, folder.id, other.id).id, "notes"));
    expect(err.code).toBe("name_taken");
    expect(err.detail).toEqual({ suggestion: "notes (2)" });
    expect(dump(db)).toEqual(before);
  });

  it("a placement may be renamed to its own name in another case", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    const file = make(db, "file", "notes", folder);
    expect(rename(db, placementIn(db, folder.id, file.id).id, "Notes").name).toBe("Notes");
  });

  it("rename refuses a bad name, an unknown placement, and a placement that is not live", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    const file = make(db, "file", "x", folder);
    const p = placementIn(db, folder.id, file.id);
    expect(codeOf(() => rename(db, p.id, "a/b"))).toBe("invalid_name");
    expect(codeOf(() => rename(db, "nope", "ok"))).toBe("not_found");
    deleteNode(db, folder.id); // the placement is hidden by its archived container
    expect(codeOf(() => rename(db, p.id, "y"))).toBe("archived");
    restore(db, folder.id, []);
    deleteNode(db, file.id); // the placement is marked
    expect(codeOf(() => rename(db, p.id, "y"))).toBe("archived");
  });

  it("retitle changes only the title: no placement is renamed", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    const file = make(db, "file", "old", folder);
    const p = placementIn(db, folder.id, file.id);
    backdate(db);
    const out = retitle(db, file.id, "  new title ");
    expect(out).toMatchObject({ id: file.id, title: "new title" });
    expect(placementIn(db, folder.id, file.id)).toEqual(p);
    expect(placementIn(db, folder.id, file.id).name).toBe("old");
    expect(updatedAt(db, file.id)).not.toBe("2000-01-01 00:00:00");
    expect(updatedAt(db, folder.id)).toBe("2000-01-01 00:00:00");
    expect(codeOf(() => retitle(db, "nope", "x"))).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
// 9. move
// ---------------------------------------------------------------------------

describe("move (spec §5.1)", () => {
  it("keeps the placement's id and name, and changes only its container", () => {
    const db = openTestDb();
    const a = make(db, "folder", "a");
    const b = make(db, "folder", "b");
    const file = make(db, "file", "x", a, "Local name");
    const p = placementIn(db, a.id, file.id);
    backdate(db);
    const moved = move(db, p.id, b.id);
    expect(moved).toMatchObject({ id: p.id, container_id: b.id, child_id: file.id, name: "Local name", archived_at: null });
    expect(placementsOf(db, file.id)).toHaveLength(1);
    expect(getNode(db, file.id).title).toBe("x");
    // Both containers' contents changed.
    expect(updatedAt(db, a.id)).not.toBe("2000-01-01 00:00:00");
    expect(updatedAt(db, b.id)).not.toBe("2000-01-01 00:00:00");
  });

  it("moving to the container it is already in is a no-op", () => {
    const db = openTestDb();
    const a = make(db, "folder", "a");
    const file = make(db, "file", "x", a);
    const p = placementIn(db, a.id, file.id);
    const before = dump(db);
    expect(move(db, p.id, a.id)).toMatchObject(p);
    expect(dump(db)).toEqual(before);
  });

  it("re-checks containment at the destination", () => {
    const db = openTestDb();
    const track = make(db, "track", "t");
    const course = make(db, "course", "c", track);
    const folder = make(db, "folder", "f");
    const before = dump(db);
    expect(codeOf(() => move(db, placementIn(db, track.id, course.id).id, folder.id))).toBe("containment_not_allowed");
    expect(dump(db)).toEqual(before);
  });

  it("re-checks the name at the destination, case-insensitively, with a suggestion", () => {
    const db = openTestDb();
    const a = make(db, "folder", "a");
    const b = make(db, "folder", "b");
    const moving = make(db, "file", "x", a);
    make(db, "file", "X", b);
    const before = dump(db);
    const err = errorOf(() => move(db, placementIn(db, a.id, moving.id).id, b.id));
    expect(err.code).toBe("name_taken");
    expect(err.detail).toEqual({ suggestion: "x (2)" });
    expect(dump(db)).toEqual(before);
  });

  it("refuses a destination that already holds the node, an archived destination, and an unknown one", () => {
    const db = openTestDb();
    const a = make(db, "folder", "a");
    const b = make(db, "folder", "b");
    const dead = make(db, "folder", "dead");
    const file = make(db, "file", "x", a);
    place(db, { container_id: b.id, child_id: file.id, name: "y" });
    deleteNode(db, dead.id);
    const p = placementIn(db, a.id, file.id);
    const before = dump(db);
    expect(codeOf(() => move(db, p.id, b.id))).toBe("already_placed");
    expect(codeOf(() => move(db, p.id, dead.id))).toBe("archived");
    expect(codeOf(() => move(db, p.id, "nope"))).toBe("not_found");
    expect(codeOf(() => move(db, "nope", b.id))).toBe("not_found");
    expect(dump(db)).toEqual(before);
  });

  it("refuses to move a placement that is not live", () => {
    const db = openTestDb();
    const a = make(db, "folder", "a");
    const b = make(db, "folder", "b");
    const file = make(db, "file", "x", a);
    const p = placementIn(db, a.id, file.id);
    deleteNode(db, a.id);
    expect(codeOf(() => move(db, p.id, b.id))).toBe("archived");
  });
});

// ---------------------------------------------------------------------------
// 10. createNode
// ---------------------------------------------------------------------------

describe("createNode (spec §5.7)", () => {
  it("creates a non-file with no content, in a container when given one", () => {
    const db = openTestDb();
    const traj = make(db, "trajectory", "quant");
    const out = createNode(db, { kind: "track", title: "Year 1", container_id: traj.id, name: "First year" });
    expect(out.node).toMatchObject({ kind: "track", title: "Year 1", kind_tag: null, archived_at: null, archive_batch: null });
    expect(out.placement).toMatchObject({ container_id: traj.id, child_id: out.node.id, name: "First year", archived_at: null });
    expect(db.prepare("SELECT COUNT(*) AS n FROM ws_content WHERE node_id = ?").get(out.node.id)).toEqual({ n: 0 });
    expect(createNode(db, { kind: "folder", title: "loose" }).placement).toBeNull();
  });

  it("a file requires a format that matches the grammar", () => {
    const db = openTestDb();
    expect(codeOf(() => createNode(db, { kind: "file", title: "x" }))).toBe("invalid_input");
    for (const bad of ["", "Markdown", "1x", "-x", "has space", "x".repeat(41), "under_score"]) {
      expect(codeOf(() => createNode(db, { kind: "file", title: "x", format: bad })), JSON.stringify(bad)).toBe("invalid_input");
    }
    expect(createNode(db, { kind: "file", title: "x", format: "x".repeat(40) }).node.kind).toBe("file");
    expect(counts(db).nodes).toBe(1);
  });

  it("accepts a format nobody registered, and stores it verbatim and unsearchable", () => {
    const db = openTestDb();
    const { node } = createNode(db, { kind: "file", title: "x", format: "never-heard-of-it", body: "{\"anything\": 1}" });
    expect(db.prepare("SELECT format, body, search_text FROM ws_content WHERE node_id = ?").get(node.id)).toEqual({
      format: "never-heard-of-it",
      body: "{\"anything\": 1}",
      search_text: null,
    });
    expect(createNode(db, { kind: "file", title: "y", format: "t-bare", body: "z" }).node.kind).toBe("file");
  });

  it("writes version 1 with the author, the body, and the hook's search_text", () => {
    const db = openTestDb();
    const { node } = createNode(db, { kind: "file", title: "x", format: "t-shout", body: "quiet words", author: "tutor" });
    const rows = db.prepare("SELECT * FROM ws_content WHERE node_id = ?").all(node.id) as unknown as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ node_id: node.id, version: 1, format: "t-shout", body: "quiet words", asset_id: null, search_text: "QUIET WORDS", author: "tutor" });
    expect(rows[0].saved_at).toEqual(expect.any(String));
  });

  it("the author defaults to ben, and an unknown author is invalid_input", () => {
    const db = openTestDb();
    const { node } = createNode(db, { kind: "file", title: "x", format: "markdown", body: "# x" });
    expect(db.prepare("SELECT author FROM ws_content WHERE node_id = ?").get(node.id)).toEqual({ author: "ben" });
    for (const author of ["tutor", "planner"] as const) {
      const made = createNode(db, { kind: "file", title: author, format: "markdown", author }).node;
      expect(db.prepare("SELECT author FROM ws_content WHERE node_id = ?").get(made.id)).toEqual({ author });
    }
    expect(codeOf(() => createNode(db, { kind: "file", title: "y", format: "markdown", author: "robot" as never }))).toBe("invalid_input");
  });

  it("the built-in hooks give markdown and graph their search_text", () => {
    const db = openTestDb();
    const md = createNode(db, { kind: "file", title: "m", format: "markdown", body: "# Heading" }).node;
    const graph = createNode(db, { kind: "file", title: "g", format: "graph", body: "y = x^2" }).node;
    const empty = createNode(db, { kind: "file", title: "e", format: "markdown" }).node;
    const text = (id: string) => (db.prepare("SELECT search_text FROM ws_content WHERE node_id = ?").get(id) as { search_text: string | null }).search_text;
    expect(text(md.id)).toBe("# Heading");
    expect(text(graph.id)).toBe("y = x^2");
    expect(text(empty.id)).toBe("");
  });

  it("runs validate, and invalid_content comes back when it refuses or throws", () => {
    const db = openTestDb();
    expect(createNode(db, { kind: "file", title: "fine", format: "t-picky", body: "good words" }).node.kind).toBe("file");
    const refused = errorOf(() => createNode(db, { kind: "file", title: "x", format: "t-picky", body: "bad words" }));
    expect(refused.code).toBe("invalid_content");
    expect(refused.message).toContain("no bad words here");
    const threw = errorOf(() => createNode(db, { kind: "file", title: "y", format: "t-throws-validate", body: "z" }));
    expect(threw.code).toBe("invalid_content");
    expect(threw.message).toContain("validate exploded");
    expect(counts(db)).toEqual({ nodes: 1, placements: 0, content: 1 });
  });

  it("a searchText hook that throws is invalid_content too, and the node is not created", () => {
    const db = openTestDb();
    const err = errorOf(() => createNode(db, { kind: "file", title: "x", format: "t-throws-search", body: "z" }));
    expect(err.code).toBe("invalid_content");
    expect(err.message).toContain("search exploded");
    expect(counts(db)).toEqual({ nodes: 0, placements: 0, content: 0 });
  });

  it("refuses a body that is not text", () => {
    const db = openTestDb();
    expect(codeOf(() => createNode(db, { kind: "file", title: "x", format: "markdown", body: 5 as never }))).toBe("invalid_input");
  });

  it("refuses a kind tag on anything but a file, and checks the grammar on a file", () => {
    const db = openTestDb();
    for (const kind of ["trajectory", "track", "course", "folder"] as const) {
      expect(codeOf(() => createNode(db, { kind, title: kind, kind_tag: "source" })), kind).toBe("invalid_input");
    }
    expect(codeOf(() => createNode(db, { kind: "file", title: "x", format: "markdown", kind_tag: "Not A Tag" }))).toBe("invalid_input");
    expect(createNode(db, { kind: "file", title: "y", format: "markdown", kind_tag: "homework" }).node.kind_tag).toBe("homework");
    expect(createNode(db, { kind: "file", title: "z", format: "markdown", kind_tag: "brand-new_tag" }).node.kind_tag).toBe("brand-new_tag");
    expect(createNode(db, { kind: "folder", title: "ok", kind_tag: null }).node.kind_tag).toBeNull();
    expect(counts(db).nodes).toBe(3);
  });

  it("refuses content, a format or an asset on a non-file, and an unknown kind", () => {
    const db = openTestDb();
    expect(codeOf(() => createNode(db, { kind: "folder", title: "x", format: "markdown" }))).toBe("invalid_input");
    expect(codeOf(() => createNode(db, { kind: "course", title: "x", body: "hello" }))).toBe("invalid_input");
    expect(codeOf(() => createNode(db, { kind: "track", title: "x", asset_id: "a1" }))).toBe("invalid_input");
    expect(codeOf(() => createNode(db, { kind: "banana" as never, title: "x" }))).toBe("invalid_input");
    expect(counts(db).nodes).toBe(0);
  });

  it("refuses a name without a container, and a container that is not there", () => {
    const db = openTestDb();
    expect(codeOf(() => createNode(db, { kind: "folder", title: "x", name: "y" }))).toBe("invalid_input");
    expect(codeOf(() => createNode(db, { kind: "folder", title: "x", container_id: "nope" }))).toBe("not_found");
    expect(counts(db).nodes).toBe(0);
  });

  it("rolls the node back when its placement is refused", () => {
    const db = openTestDb();
    const folder = make(db, "folder", "f");
    make(db, "file", "taken", folder);
    const before = counts(db);
    const err = errorOf(() => createNode(db, { kind: "file", title: "other", format: "markdown", container_id: folder.id, name: "taken" }));
    expect(err.code).toBe("name_taken");
    expect(counts(db)).toEqual(before);
  });

  describe("an upload", () => {
    function withAsset(db: Db) {
      db.prepare("INSERT INTO asset (id, title, type, content, extracted_text) VALUES ('asset-1', 'Paper', 'text', 'raw', 'extracted words')").run();
    }

    it("requires an asset_id that exists", () => {
      const db = openTestDb();
      expect(codeOf(() => createNode(db, { kind: "file", title: "x", format: "upload" }))).toBe("invalid_input");
      expect(codeOf(() => createNode(db, { kind: "file", title: "x", format: "upload", asset_id: "missing" }))).toBe("not_found");
      expect(counts(db).nodes).toBe(0);
    });

    it("stores the asset on version 1, with the asset's extracted text as its search_text", () => {
      const db = openTestDb();
      withAsset(db);
      const { node } = createNode(db, { kind: "file", title: "Paper", format: "upload", asset_id: "asset-1", kind_tag: "source" });
      expect(db.prepare("SELECT format, body, asset_id, search_text, version FROM ws_content WHERE node_id = ?").get(node.id)).toEqual({
        format: "upload",
        body: null,
        asset_id: "asset-1",
        search_text: "extracted words",
        version: 1,
      });
      expect(node.kind_tag).toBe("source");
    });

    it("holds no text, and a text format holds no asset", () => {
      const db = openTestDb();
      withAsset(db);
      expect(codeOf(() => createNode(db, { kind: "file", title: "x", format: "upload", asset_id: "asset-1", body: "text" }))).toBe("invalid_input");
      expect(codeOf(() => createNode(db, { kind: "file", title: "x", format: "markdown", asset_id: "asset-1" }))).toBe("invalid_input");
    });
  });
});

// ---------------------------------------------------------------------------
// 11. setKindTag
// ---------------------------------------------------------------------------

describe("setKindTag (spec §4.3)", () => {
  it("accepts any tag in the grammar, not only the suggested five", () => {
    const db = openTestDb();
    const file = make(db, "file", "x");
    for (const tag of ["source", "a", "my-tag_2", "x".repeat(32)]) {
      expect(setKindTag(db, file.id, tag).kind_tag).toBe(tag);
    }
  });

  it("refuses what the grammar refuses, with invalid_input, and keeps the old tag", () => {
    const db = openTestDb();
    const file = make(db, "file", "x");
    setKindTag(db, file.id, "source");
    for (const bad of ["", "Source", "2fast", "has space", "x".repeat(33)]) {
      expect(codeOf(() => setKindTag(db, file.id, bad)), JSON.stringify(bad)).toBe("invalid_input");
    }
    expect(getNode(db, file.id).kind_tag).toBe("source");
  });

  it("null clears the tag", () => {
    const db = openTestDb();
    const file = make(db, "file", "x");
    setKindTag(db, file.id, "homework");
    expect(setKindTag(db, file.id, null).kind_tag).toBeNull();
  });

  it("refuses a tag on a non-file, but clearing one is not an error", () => {
    const db = openTestDb();
    for (const kind of ["trajectory", "track", "course", "folder"] as const) {
      const node = make(db, kind, kind);
      expect(codeOf(() => setKindTag(db, node.id, "source")), kind).toBe("invalid_input");
      expect(setKindTag(db, node.id, null).kind_tag).toBeNull();
    }
    expect(codeOf(() => setKindTag(db, "nope", "source"))).toBe("not_found");
  });

  it("stamps the node", () => {
    const db = openTestDb();
    const file = make(db, "file", "x");
    backdate(db);
    setKindTag(db, file.id, "test");
    expect(updatedAt(db, file.id)).not.toBe("2000-01-01 00:00:00");
  });
});

// ---------------------------------------------------------------------------
// 12. Formats
// ---------------------------------------------------------------------------

describe("formats (spec §7)", () => {
  it("has the three built-ins with their hooks", () => {
    const formats = listFormats();
    const find = (name: string) => formats.find((f) => f.format === name);
    expect(find("markdown")).toEqual({ format: "markdown", searchable: true, appendable: true, validated: false });
    expect(find("graph")).toEqual({ format: "graph", searchable: true, appendable: false, validated: false });
    expect(find("upload")).toEqual({ format: "upload", searchable: true, appendable: false, validated: false });
  });

  it("markdown's append joins with a blank line when there is something to join to", () => {
    const append = formatHooks("markdown")!.append!;
    expect(append("first", "second")).toBe("first\n\nsecond");
    expect(append("", "second")).toBe("second");
    expect(append(null, "second")).toBe("second");
    expect(formatHooks("markdown")!.searchText!("# hi")).toBe("# hi");
    expect(formatHooks("markdown")!.searchText!(null)).toBe("");
    expect(formatHooks("graph")!.searchText!("y = x")).toBe("y = x");
  });

  it("returns null for a format nobody registered, which is allowed", () => {
    expect(formatHooks("unregistered")).toBeNull();
  });

  it("refuses a duplicate registration and a bad format name", () => {
    expect(() => registerFormat({ format: "markdown" })).toThrow();
    expect(() => registerFormat({ format: "t-shout" })).toThrow();
    for (const bad of ["", "Upper", "1x", "has space", "under_score", "x".repeat(41)]) {
      expect(() => registerFormat({ format: bad }), JSON.stringify(bad)).toThrow();
    }
  });

  it("accepts a format with no hooks, and reports what it supplies", () => {
    registerFormat({ format: "t-registered-bare" });
    expect(listFormats().find((f) => f.format === "t-registered-bare")).toEqual({ format: "t-registered-bare", searchable: false, appendable: false, validated: false });
    expect(formatHooks("t-registered-bare")).toMatchObject({ format: "t-registered-bare" });
    registerFormat({ format: "t-everything", searchText: (b) => b ?? "", validate: () => null, append: (b, t) => `${b}${t}` });
    expect(listFormats().find((f) => f.format === "t-everything")).toEqual({ format: "t-everything", searchable: true, appendable: true, validated: true });
  });

  it("lists formats in registration order, built-ins first", () => {
    const names = listFormats().map((f) => f.format);
    expect(names.slice(0, 3)).toEqual(["markdown", "graph", "upload"]);
  });
});

// ---------------------------------------------------------------------------
// 13. Savepoints
// ---------------------------------------------------------------------------

describe("savepoints (spec §5)", () => {
  it("an operation inside an outer BEGIN that is then rolled back leaves no trace", () => {
    const db = openTestDb();
    const before = dump(db);
    db.exec("BEGIN");
    const traj = make(db, "trajectory", "quant");
    const course = make(db, "course", "micro", traj);
    const unit = make(db, "folder", "unit", course);
    const file = make(db, "file", "notes", unit);
    place(db, { container_id: traj.id, child_id: file.id, name: "Syllabus" });
    rename(db, placementIn(db, unit.id, file.id).id, "Unit notes");
    retitle(db, file.id, "Retitled");
    setKindTag(db, file.id, "homework");
    move(db, placementIn(db, traj.id, file.id).id, course.id);
    trash(db, placementIn(db, course.id, file.id).id);
    const out = deleteNode(db, course.id, { with_orphans: true });
    restore(db, course.id, [placementIn(db, traj.id, course.id).id]);
    deleteNode(db, course.id);
    purge(db, course.id);
    expect(counts(db).nodes).toBeGreaterThan(0);
    expect(out.archived.length).toBeGreaterThan(1);
    db.exec("ROLLBACK");
    expect(dump(db)).toEqual(before);
    expect(counts(db)).toEqual({ nodes: 0, placements: 0, content: 0 });
  });

  it("a refused operation inside a transaction undoes only itself", () => {
    const db = openTestDb();
    db.exec("BEGIN");
    const course = make(db, "course", "c");
    const kept = make(db, "folder", "kept", course);
    expect(codeOf(() => createNode(db, { kind: "track", title: "refused", container_id: course.id }))).toBe("containment_not_allowed");
    expect(codeOf(() => createNode(db, { kind: "file", title: "refused too", format: "t-picky", body: "bad", container_id: course.id }))).toBe("invalid_content");
    db.exec("COMMIT");
    expect(counts(db)).toEqual({ nodes: 2, placements: 1, content: 0 });
    expect(getNode(db, kept.id).title).toBe("kept");
  });

  it("a multi-step operation that fails part way writes nothing", () => {
    const db = openTestDb();
    const a = make(db, "folder", "a");
    const file = make(db, "file", "notes", a);
    const squatter = make(db, "file", "notes (2)", a);
    // Deleting then restoring is fine; this restore is refused up front, and nothing moves.
    deleteNode(db, file.id);
    const before = dump(db);
    expect(codeOf(() => restore(db, file.id, ["nope"]))).toBe("not_found");
    expect(dump(db)).toEqual(before);
    expect(squatter.id).toBeTruthy();
  });
});
