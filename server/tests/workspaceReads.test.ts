import { describe, it, expect } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "../src/domain/errors.js";
import { registerFormat } from "../src/domain/workspace/formats.js";
import { createNode, deleteNode, getNode, place, restore, trash } from "../src/domain/workspace/graph.js";
import { saveContent } from "../src/domain/workspace/content.js";
import {
  appearsIn,
  archived,
  byKindTag,
  children,
  context,
  getNodeDetail,
  roots,
  search,
  subtree,
  unplaced,
} from "../src/domain/workspace/reads.js";
import type { NodeKind } from "../src/domain/workspace/types.js";
import { openTestDb } from "./helpers.js";

// ---------------------------------------------------------------------------
// The workspace graph's reads, against the approved spec
// (Learn spec/osmosis/workspace/02-data-layer.md §6). Every read is live-only
// unless it is named otherwise, and none of them calls a format hook.
// ---------------------------------------------------------------------------

type Db = DatabaseSync;
type Ref = { id: string };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
}

// A node of any kind. A file is a markdown file whose body is `body`.
function make(db: Db, kind: NodeKind, title: string, container?: Ref, name?: string, body = `# ${title}`) {
  return createNode(
    db,
    kind === "file"
      ? { kind, title, format: "markdown", body, container_id: container?.id, name }
      : { kind, title, container_id: container?.id, name }
  ).node;
}

const tagged = (db: Db, title: string, tag: string, container?: Ref, name?: string) =>
  createNode(db, { kind: "file", title, format: "markdown", body: title, kind_tag: tag, container_id: container?.id, name }).node;

const placementId = (db: Db, containerId: string, childId: string): string =>
  (db.prepare("SELECT id FROM ws_placement WHERE container_id = ? AND child_id = ?").get(containerId, childId) as { id: string }).id;

const names = (rows: { name: string }[]) => rows.map((r) => r.name);

// A format with no hooks at all. The registry is process-wide and refuses a
// duplicate, so each format a test registers has its own name.
registerFormat({ format: "t-reads-bare" });

// ---------------------------------------------------------------------------
// children (§6.1)
// ---------------------------------------------------------------------------

describe("children", () => {
  it("lists live placements only: an archived child, a trashed placement and an archived container's contents are hidden", () => {
    const db = openTestDb();
    const c = make(db, "course", "micro");
    const keep = make(db, "file", "keep", c);
    const archivedFile = make(db, "file", "archived file", c);
    const archivedFolder = make(db, "folder", "archived folder", c);
    const trashed = make(db, "file", "trashed", c);
    deleteNode(db, archivedFile.id);
    deleteNode(db, archivedFolder.id);
    trash(db, placementId(db, c.id, trashed.id));
    expect(children(db, c.id).map((r) => r.node.id)).toEqual([keep.id]);
    deleteNode(db, c.id);
    expect(children(db, c.id)).toEqual([]);
  });

  it("puts containers first, then files, each in natural order of the local name", () => {
    const db = openTestDb();
    const c = make(db, "course", "micro");
    make(db, "file", "unit 10", c);
    make(db, "file", "unit 2", c);
    make(db, "file", "Unit 3", c);
    make(db, "folder", "zeta", c);
    make(db, "folder", "Alpha", c);
    expect(names(children(db, c.id))).toEqual(["Alpha", "zeta", "unit 2", "Unit 3", "unit 10"]);
  });

  it("orders by the placement's name, not the node's title; every container kind counts as a container", () => {
    const db = openTestDb();
    const t = make(db, "trajectory", "quant");
    make(db, "file", "A title", t, "z name");
    make(db, "file", "Z title", t, "a name");
    make(db, "folder", "folder", t, "c folder");
    make(db, "track", "track", t, "b track");
    make(db, "course", "course", t, "a course");
    expect(names(children(db, t.id))).toEqual(["a course", "b track", "c folder", "a name", "z name"]);
  });

  it("flags appears_elsewhere when the node has another live placement", () => {
    const db = openTestDb();
    const a = make(db, "course", "a");
    const b = make(db, "course", "b");
    const gone = make(db, "course", "gone");
    const shared = make(db, "file", "shared", a);
    const solo = make(db, "file", "solo", a);
    const hiddenElsewhere = make(db, "file", "hidden elsewhere", a);
    place(db, { container_id: b.id, child_id: shared.id, name: "also here" });
    place(db, { container_id: gone.id, child_id: hiddenElsewhere.id });
    deleteNode(db, gone.id);
    const rows = Object.fromEntries(children(db, a.id).map((r) => [r.name, r.appears_elsewhere]));
    expect(rows).toEqual({ shared: true, solo: false, "hidden elsewhere": false });
    expect(children(db, b.id)).toEqual([expect.objectContaining({ name: "also here", appears_elsewhere: true })]);
  });

  it("carries the placement and the node's summary", () => {
    const db = openTestDb();
    const c = make(db, "course", "micro");
    const folder = make(db, "folder", "unit 1", c);
    make(db, "file", "stub", folder);
    const f = createNode(db, { kind: "file", title: "Notes", format: "markdown", body: "x", kind_tag: "homework", container_id: c.id, name: "HW 1" }).node;
    const [first, second] = children(db, c.id);
    expect(first).toEqual({
      placement_id: placementId(db, c.id, folder.id),
      name: "unit 1",
      appears_elsewhere: false,
      node: {
        id: folder.id,
        kind: "folder",
        title: "unit 1",
        kind_tag: null,
        format: null,
        placement_count: 1,
        has_children: true,
        archived_at: null,
        top_level: false,
      },
    });
    expect(second.node).toMatchObject({ id: f.id, kind: "file", kind_tag: "homework", format: "markdown", has_children: false });
    expect(second.placement_id).toBe(placementId(db, c.id, f.id));
  });

  it("has_children is about live children only", () => {
    const db = openTestDb();
    const c = make(db, "course", "micro");
    const full = make(db, "folder", "full", c);
    make(db, "folder", "empty", c);
    const emptied = make(db, "folder", "emptied", c);
    make(db, "file", "x", full);
    deleteNode(db, make(db, "file", "y", emptied).id);
    const byName = Object.fromEntries(children(db, c.id).map((r) => [r.name, r.node.has_children]));
    expect(byName).toEqual({ full: true, empty: false, emptied: false });
  });

  it("is not_found for an unknown container and empty for a file", () => {
    const db = openTestDb();
    const f = make(db, "file", "f");
    expect(codeOf(() => children(db, "nope"))).toBe("not_found");
    expect(children(db, f.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// appearsIn (§6.2) and getNodeDetail
// ---------------------------------------------------------------------------

describe("appearsIn", () => {
  it("includes both the trajectory and the track parents of a course", () => {
    const db = openTestDb();
    const trajectory = make(db, "trajectory", "quant");
    const track = make(db, "track", "amc");
    const course = make(db, "course", "micro", trajectory);
    place(db, { container_id: track.id, child_id: course.id, name: "Micro (AMC)" });
    expect(appearsIn(db, course.id)).toEqual([
      {
        placement_id: placementId(db, track.id, course.id),
        name: "Micro (AMC)",
        container: { id: track.id, kind: "track", title: "amc" },
      },
      {
        placement_id: placementId(db, trajectory.id, course.id),
        name: "micro",
        container: { id: trajectory.id, kind: "trajectory", title: "quant" },
      },
    ]);
  });

  it("lists live placements only: a trashed one, an archived container and an archived node give none", () => {
    const db = openTestDb();
    const a = make(db, "course", "a");
    const b = make(db, "course", "b");
    const c = make(db, "course", "c");
    const f = make(db, "file", "f", a);
    place(db, { container_id: b.id, child_id: f.id });
    place(db, { container_id: c.id, child_id: f.id });
    trash(db, placementId(db, a.id, f.id));
    deleteNode(db, c.id);
    expect(appearsIn(db, f.id).map((r) => r.container.id)).toEqual([b.id]);
    deleteNode(db, f.id);
    expect(appearsIn(db, f.id)).toEqual([]);
  });

  it("is not_found for an unknown node", () => {
    expect(codeOf(() => appearsIn(openTestDb(), "nope"))).toBe("not_found");
  });
});

describe("getNodeDetail", () => {
  it("returns the summary, where the node appears, and the latest version's header for a file", () => {
    const db = openTestDb();
    const c = make(db, "course", "micro");
    const f = make(db, "file", "notes", c);
    saveContent(db, f.id, { body: "two", base_version: 1, author: "tutor" });
    const detail = getNodeDetail(db, f.id);
    expect(detail.node).toMatchObject({ id: f.id, kind: "file", format: "markdown", placement_count: 1 });
    expect(detail.appears_in.map((r) => r.container.id)).toEqual([c.id]);
    expect(detail.content).toEqual({ format: "markdown", version: 2, saved_at: expect.any(String), author: "tutor", asset_id: null });
  });

  it("has no content for a container, still shows an archived node, and is not_found for an unknown one", () => {
    const db = openTestDb();
    const c = make(db, "course", "micro");
    expect(getNodeDetail(db, c.id)).toMatchObject({ node: { kind: "course", format: null, top_level: true }, appears_in: [], content: null });
    deleteNode(db, c.id);
    expect(getNodeDetail(db, c.id).node.archived_at).not.toBeNull();
    expect(codeOf(() => getNodeDetail(db, "nope"))).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
// unplaced (§6.3)
// ---------------------------------------------------------------------------

describe("unplaced", () => {
  it("lists files and folders only: an unplaced trajectory, track or course is top level, not unplaced", () => {
    const db = openTestDb();
    const file = make(db, "file", "loose file");
    const folder = make(db, "folder", "loose folder");
    make(db, "trajectory", "j");
    make(db, "track", "t");
    make(db, "course", "c");
    expect(unplaced(db).map((n) => n.id).sort()).toEqual([file.id, folder.id].sort());
  });

  it("excludes anything with a live placement, and lists a node again once its last placement is trashed", () => {
    const db = openTestDb();
    const c = make(db, "course", "c");
    const placed = make(db, "file", "placed", c);
    const twice = make(db, "file", "twice", c);
    const d = make(db, "course", "d");
    place(db, { container_id: d.id, child_id: twice.id });
    expect(unplaced(db)).toEqual([]);
    trash(db, placementId(db, c.id, twice.id));
    expect(unplaced(db)).toEqual([]);
    trash(db, placementId(db, d.id, twice.id));
    trash(db, placementId(db, c.id, placed.id));
    expect(unplaced(db).map((n) => n.id).sort()).toEqual([placed.id, twice.id].sort());
  });

  it("includes a node whose only placements are in an archived container, and not the nodes inside a folder that went with it", () => {
    const db = openTestDb();
    const c = make(db, "course", "c");
    const folder = make(db, "folder", "unit", c);
    const inFolder = make(db, "file", "in folder", folder);
    const direct = make(db, "file", "direct", c);
    const elsewhere = make(db, "course", "elsewhere");
    const alsoElsewhere = make(db, "file", "also elsewhere", c);
    place(db, { container_id: elsewhere.id, child_id: alsoElsewhere.id });
    deleteNode(db, c.id);
    // The folder and the direct file lost their only live placement; the file in the folder
    // is still placed (in a folder that is live, if hidden), and the shared one is placed elsewhere.
    expect(unplaced(db).map((n) => n.id).sort()).toEqual([direct.id, folder.id].sort());
    expect(unplaced(db).map((n) => n.id)).not.toContain(inFolder.id);
  });

  it("excludes archived nodes, and orders the rest by title, naturally", () => {
    const db = openTestDb();
    make(db, "file", "note 10");
    make(db, "file", "note 2");
    make(db, "folder", "Archive me");
    const gone = make(db, "file", "gone");
    deleteNode(db, gone.id);
    expect(unplaced(db).map((n) => n.title)).toEqual(["Archive me", "note 2", "note 10"]);
  });

  it("returns summaries with the right counts", () => {
    const db = openTestDb();
    const f = make(db, "folder", "box");
    expect(unplaced(db)).toEqual([
      { id: f.id, kind: "folder", title: "box", kind_tag: null, format: null, placement_count: 0, has_children: false, archived_at: null, top_level: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// roots (§6.4)
// ---------------------------------------------------------------------------

describe("roots", () => {
  it("lists every live trajectory, track and course, flagged top_level when none of them is placed live", () => {
    const db = openTestDb();
    const j = make(db, "trajectory", "j");
    const t1 = make(db, "track", "t1", j);
    const t2 = make(db, "track", "t2");
    const c1 = make(db, "course", "c1", t1);
    const c2 = make(db, "course", "c2", j);
    const c3 = make(db, "course", "c3");
    const doomed = make(db, "track", "doomed");
    const orphaned = make(db, "course", "orphaned", doomed);
    const dead = make(db, "course", "dead");
    make(db, "folder", "folder");
    make(db, "file", "file");
    deleteNode(db, doomed.id);
    deleteNode(db, dead.id);
    const r = roots(db);
    const flags = (rows: { id: string; top_level: boolean }[]) => Object.fromEntries(rows.map((n) => [n.id, n.top_level]));
    expect(flags(r.trajectories)).toEqual({ [j.id]: true });
    expect(flags(r.tracks)).toEqual({ [t1.id]: false, [t2.id]: true });
    // `orphaned` sits in an archived track, so it has no live placement: it is top level again.
    expect(flags(r.courses)).toEqual({ [c1.id]: false, [c2.id]: false, [c3.id]: true, [orphaned.id]: true });
    expect(Object.keys(r).sort()).toEqual(["courses", "tracks", "trajectories"]);
  });

  it("counts a course placed in a trajectory and in a track as placed, and orders each list by title", () => {
    const db = openTestDb();
    const j = make(db, "trajectory", "j");
    const t = make(db, "track", "t");
    const both = make(db, "course", "course 10", j);
    place(db, { container_id: t.id, child_id: both.id });
    make(db, "course", "course 2");
    const r = roots(db);
    expect(r.courses.map((n) => [n.title, n.top_level, n.placement_count])).toEqual([
      ["course 2", true, 0],
      ["course 10", false, 2],
    ]);
  });

  it("is empty on an empty workspace", () => {
    expect(roots(openTestDb())).toEqual({ trajectories: [], tracks: [], courses: [] });
  });
});

// ---------------------------------------------------------------------------
// subtree (§6.5)
// ---------------------------------------------------------------------------

describe("subtree", () => {
  // c
  //   A (folder)
  //     G (folder)
  //       f2
  //     f1
  //   f0
  function tree(db: Db) {
    const c = make(db, "course", "c");
    const A = make(db, "folder", "A", c);
    const G = make(db, "folder", "G", A);
    const f2 = make(db, "file", "f2", G);
    const f1 = make(db, "file", "f1", A);
    const f0 = make(db, "file", "f0", c);
    return { c, A, G, f2, f1, f0 };
  }

  it("walks depth-first in children order, with parent placement ids and depths", () => {
    const db = openTestDb();
    const { c, A, G, f2, f1, f0 } = tree(db);
    const rows = subtree(db, c.id);
    const pA = placementId(db, c.id, A.id);
    const pG = placementId(db, A.id, G.id);
    expect(rows.map((r) => [r.name, r.depth, r.parent_placement_id])).toEqual([
      ["A", 0, null],
      ["G", 1, pA],
      ["f2", 2, pG],
      ["f1", 1, pA],
      ["f0", 0, null],
    ]);
    expect(rows.map((r) => r.placement_id)).toEqual([
      pA,
      pG,
      placementId(db, G.id, f2.id),
      placementId(db, A.id, f1.id),
      placementId(db, c.id, f0.id),
    ]);
    expect(rows.map((r) => r.node.id)).toEqual([A.id, G.id, f2.id, f1.id, f0.id]);
    expect(rows[0].node).toMatchObject({ kind: "folder", has_children: true, placement_count: 1 });
  });

  it("uses the local name, not the title", () => {
    const db = openTestDb();
    const c = make(db, "course", "c");
    make(db, "file", "Real title", c, "Local name");
    expect(subtree(db, c.id).map((r) => r.name)).toEqual(["Local name"]);
  });

  it("lists a node placed twice twice, and what is under it once per route", () => {
    const db = openTestDb();
    const { c, A, G, f2, f1 } = tree(db);
    place(db, { container_id: c.id, child_id: G.id }); // G is now also directly in c
    place(db, { container_id: A.id, child_id: make(db, "file", "shared", c).id });
    const rows = subtree(db, c.id);
    const pc = placementId(db, c.id, G.id);
    const pA = placementId(db, c.id, A.id);
    // G, and its f2, appear under A and directly under c.
    const gRows = rows.filter((r) => r.node.id === G.id);
    expect(gRows.map((r) => [r.depth, r.parent_placement_id]).sort()).toEqual([[0, null], [1, pA]].sort());
    const f2Rows = rows.filter((r) => r.node.id === f2.id);
    expect(f2Rows).toHaveLength(2);
    expect(new Set(f2Rows.map((r) => r.placement_id)).size).toBe(1);
    expect(new Set(f2Rows.map((r) => r.parent_placement_id))).toEqual(new Set([pc, placementId(db, A.id, G.id)]));
    // The shared file is in c and in A: two placements, two rows.
    expect(rows.filter((r) => r.name === "shared")).toHaveLength(2);
    expect(rows.filter((r) => r.node.id === f1.id)).toHaveLength(1);
  });

  it("excludes archived nodes, and everything inside an archived container", () => {
    const db = openTestDb();
    const { c, A, G, f1, f0 } = tree(db);
    deleteNode(db, f0.id);
    expect(subtree(db, c.id).map((r) => r.name)).toEqual(["A", "G", "f2", "f1"]);
    deleteNode(db, G.id);
    expect(subtree(db, c.id).map((r) => r.name)).toEqual(["A", "f1"]);
    deleteNode(db, f1.id);
    deleteNode(db, A.id);
    expect(subtree(db, c.id)).toEqual([]);
  });

  it("is empty for an archived root and for a file, and not_found for an unknown node", () => {
    const db = openTestDb();
    const { c, f0 } = tree(db);
    expect(subtree(db, f0.id)).toEqual([]);
    expect(codeOf(() => subtree(db, "nope"))).toBe("not_found");
    deleteNode(db, c.id);
    expect(subtree(db, c.id)).toEqual([]);
  });

  it("walks through every container kind", () => {
    const db = openTestDb();
    const j = make(db, "trajectory", "j");
    const t = make(db, "track", "t", j);
    const c = make(db, "course", "c", t);
    const f = make(db, "file", "f", c);
    expect(subtree(db, j.id).map((r) => [r.node.id, r.depth])).toEqual([[t.id, 0], [c.id, 1], [f.id, 2]]);
  });

  it("brings a restored node back where it was", () => {
    const db = openTestDb();
    const { c, f1, A } = tree(db);
    deleteNode(db, f1.id);
    const pId = (db.prepare("SELECT id FROM ws_placement WHERE container_id = ? AND child_id = ?").get(A.id, f1.id) as { id: string }).id;
    restore(db, f1.id, [pId]);
    expect(subtree(db, c.id).map((r) => r.name)).toContain("f1");
  });
});

// ---------------------------------------------------------------------------
// byKindTag (§6.6)
// ---------------------------------------------------------------------------

describe("byKindTag", () => {
  function world(db: Db) {
    const c1 = make(db, "course", "c1");
    const t = make(db, "track", "t");
    const unit = make(db, "folder", "unit", c1);
    const s1 = tagged(db, "s1", "source", c1, "Source one");
    const inUnit = tagged(db, "in unit", "source", unit);
    const hw = tagged(db, "hw", "homework", c1);
    make(db, "file", "untagged", c1);
    place(db, { container_id: t.id, child_id: s1.id, name: "Same source, in t" });
    const s2 = tagged(db, "s2", "source", t);
    const loose = tagged(db, "loose", "source");
    const gone = tagged(db, "gone", "source", c1);
    deleteNode(db, gone.id);
    return { c1, t, unit, s1, inUnit, hw, s2, loose, gone };
  }

  it("returns one row per live placement of a file carrying the tag, unscoped", () => {
    const db = openTestDb();
    const { c1, t, unit, s1, inUnit, s2 } = world(db);
    const rows = byKindTag(db, "source");
    expect(rows.map((r) => [r.name, r.container_id, r.node.id]).sort()).toEqual(
      [
        ["Source one", c1.id, s1.id],
        ["Same source, in t", t.id, s1.id],
        ["in unit", unit.id, inUnit.id],
        ["s2", t.id, s2.id],
      ].sort()
    );
    expect(rows.find((r) => r.name === "s2")).toEqual({
      placement_id: placementId(db, t.id, s2.id),
      name: "s2",
      container_id: t.id,
      node: expect.objectContaining({ id: s2.id, kind_tag: "source", format: "markdown" }),
    });
  });

  it("never lists an unplaced or an archived file", () => {
    const db = openTestDb();
    const { loose, gone } = world(db);
    const ids = byKindTag(db, "source").map((r) => r.node.id);
    expect(ids).not.toContain(loose.id);
    expect(ids).not.toContain(gone.id);
  });

  it("limits the rows to the scope's subtree", () => {
    const db = openTestDb();
    const { c1, t, unit, s1, inUnit, s2 } = world(db);
    expect(byKindTag(db, "source", c1.id).map((r) => [r.node.id, r.container_id]).sort()).toEqual(
      [[s1.id, c1.id], [inUnit.id, unit.id]].sort()
    );
    expect(byKindTag(db, "source", t.id).map((r) => [r.node.id, r.container_id]).sort()).toEqual([[s1.id, t.id], [s2.id, t.id]].sort());
    expect(byKindTag(db, "source", unit.id).map((r) => r.node.id)).toEqual([inUnit.id]);
    expect(byKindTag(db, "homework", t.id)).toEqual([]);
  });

  it("lists a placement once even when the scope reaches its container by two routes", () => {
    const db = openTestDb();
    const c = make(db, "course", "c");
    const a = make(db, "folder", "a", c);
    const b = make(db, "folder", "b", c);
    const shared = make(db, "folder", "shared", a);
    place(db, { container_id: b.id, child_id: shared.id });
    tagged(db, "t", "source", shared);
    expect(byKindTag(db, "source", c.id)).toHaveLength(1);
  });

  it("filters by any tag in the open vocabulary, and an unused one gives nothing", () => {
    const db = openTestDb();
    const c = make(db, "course", "c");
    tagged(db, "a", "my-own_tag9", c);
    expect(byKindTag(db, "my-own_tag9").map((r) => r.name)).toEqual(["a"]);
    expect(byKindTag(db, "flowchart")).toEqual([]);
  });

  it("refuses a malformed tag and an unknown scope, and returns an archived scope's nothing", () => {
    const db = openTestDb();
    const { c1 } = world(db);
    for (const bad of ["Source", "9x", "has space", "", null as unknown as string, undefined as unknown as string]) {
      expect(codeOf(() => byKindTag(db, bad)), String(bad)).toBe("invalid_input");
    }
    expect(codeOf(() => byKindTag(db, "source", "nope"))).toBe("not_found");
    deleteNode(db, c1.id);
    expect(byKindTag(db, "source", c1.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// search (§6.7)
// ---------------------------------------------------------------------------

describe("search", () => {
  it("matches placement names, node titles and the latest version's search_text, case-insensitively", () => {
    const db = openTestDb();
    const c = make(db, "course", "micro");
    make(db, "file", "Elasticity notes", c, undefined, "zzz");
    make(db, "file", "Elasticity of demand", c, "Supporting", "zzz");
    make(db, "file", "Misc", c, undefined, "On PRICE Elasticity, briefly");
    make(db, "file", "Unrelated", c, undefined, "nothing here");
    expect(names(search(db, { q: "elasticity" }))).toEqual(["Elasticity notes", "Misc", "Supporting"]);
    expect(names(search(db, { q: "ELASTICITY" }))).toEqual(["Elasticity notes", "Misc", "Supporting"]);
  });

  it("returns one row per live placement, under that placement's name", () => {
    const db = openTestDb();
    const a = make(db, "course", "a");
    const b = make(db, "course", "b");
    const f = make(db, "file", "Elasticity", a, "Notes A", "the body mentions moles");
    place(db, { container_id: b.id, child_id: f.id, name: "Notes B" });
    // A hit on the body or the title is a hit on the node, so both placements show.
    expect(search(db, { q: "moles" }).map((r) => [r.name, r.container_id]).sort()).toEqual([["Notes A", a.id], ["Notes B", b.id]]);
    expect(names(search(db, { q: "elasticity" }))).toEqual(["Notes A", "Notes B"]);
    // A hit on one local name alone is a hit on that placement alone.
    expect(search(db, { q: "notes b" }).map((r) => r.container_id)).toEqual([b.id]);
    expect(search(db, { q: "moles" })[0]).toEqual({
      placement_id: expect.any(String),
      name: "Notes A",
      container_id: a.id,
      node: expect.objectContaining({ id: f.id, kind: "file", format: "markdown", placement_count: 2 }),
    });
  });

  it("never returns an unplaced node", () => {
    const db = openTestDb();
    const c = make(db, "course", "c");
    const f = make(db, "file", "needle", undefined, undefined, "needle in the body");
    make(db, "folder", "needle folder");
    make(db, "course", "needle course");
    expect(search(db, { q: "needle" }).map((r) => r.node.id)).toEqual([]);
    place(db, { container_id: c.id, child_id: f.id });
    expect(search(db, { q: "needle" }).map((r) => r.node.id)).toEqual([f.id]);
    trash(db, placementId(db, c.id, f.id));
    expect(search(db, { q: "needle" })).toEqual([]);
    // The container itself is placed nowhere, so it is not found either.
    expect(search(db, { q: "c" }).map((r) => r.node.id)).not.toContain(c.id);
  });

  it("is limited to the scope's subtree when given", () => {
    const db = openTestDb();
    const a = make(db, "course", "a");
    const b = make(db, "course", "b");
    const unit = make(db, "folder", "unit", a);
    const inA = make(db, "file", "needle a", a);
    const inUnit = make(db, "file", "needle unit", unit);
    make(db, "file", "needle b", b);
    expect(search(db, { q: "needle", scope: a.id }).map((r) => r.node.id).sort()).toEqual([inA.id, inUnit.id].sort());
    expect(search(db, { q: "needle", scope: unit.id }).map((r) => r.node.id)).toEqual([inUnit.id]);
    expect(search(db, { q: "needle" })).toHaveLength(3);
    expect(codeOf(() => search(db, { q: "needle", scope: "nope" }))).toBe("not_found");
    deleteNode(db, a.id);
    expect(search(db, { q: "needle", scope: a.id })).toEqual([]);
  });

  it("hides archived nodes and everything inside an archived container", () => {
    const db = openTestDb();
    const c = make(db, "course", "c");
    const folder = make(db, "folder", "needle folder", c);
    make(db, "file", "needle inside", folder);
    const f = make(db, "file", "needle file", c);
    expect(search(db, { q: "needle" })).toHaveLength(3);
    deleteNode(db, f.id);
    expect(names(search(db, { q: "needle" }))).toEqual(["needle folder", "needle inside"]);
    deleteNode(db, folder.id);
    expect(search(db, { q: "needle" })).toEqual([]);
  });

  it("filters by kind_tag, and refuses a malformed one", () => {
    const db = openTestDb();
    const c = make(db, "course", "c");
    const src = tagged(db, "needle source", "source", c);
    tagged(db, "needle homework", "homework", c);
    make(db, "file", "needle plain", c);
    expect(search(db, { q: "needle", kind_tag: "source" }).map((r) => r.node.id)).toEqual([src.id]);
    expect(search(db, { kind_tag: "homework" }).map((r) => r.name)).toEqual(["needle homework"]);
    expect(search(db, { q: "needle", kind_tag: "test" })).toEqual([]);
    expect(codeOf(() => search(db, { kind_tag: "Source" }))).toBe("invalid_input");
  });

  it("searches only the latest version's text", () => {
    const db = openTestDb();
    const c = make(db, "course", "c");
    const f = make(db, "file", "doc", c, undefined, "oldword");
    saveContent(db, f.id, { body: "newword", base_version: 1, author: "ben" });
    expect(search(db, { q: "oldword" })).toEqual([]);
    expect(names(search(db, { q: "newword" }))).toEqual(["doc"]);
  });

  it("returns every live placement (in scope) when q is empty or missing", () => {
    const db = openTestDb();
    const c = make(db, "course", "c");
    const folder = make(db, "folder", "unit", c);
    make(db, "file", "b", folder);
    make(db, "file", "a", c);
    expect(names(search(db, {}))).toEqual(["a", "b", "unit"]);
    expect(names(search(db, { q: "   " }))).toEqual(["a", "b", "unit"]);
    expect(names(search(db, { scope: folder.id }))).toEqual(["b"]);
    // An absent filter may arrive as null (JSON has no undefined).
    expect(names(search(db, { q: "", scope: null, kind_tag: null }))).toEqual(["a", "b", "unit"]);
    expect(codeOf(() => search(db, { q: 7 as unknown as string }))).toBe("invalid_input");
  });

  it("finds a node by name or title when its format has no search hook, but not by content", () => {
    const db = openTestDb();
    const c = make(db, "course", "c");
    createNode(db, { kind: "file", title: "opaque thing", format: "t-reads-bare", body: "secret contents", container_id: c.id });
    expect(search(db, { q: "secret" })).toEqual([]);
    expect(names(search(db, { q: "opaque" }))).toEqual(["opaque thing"]);
  });

  it("treats the query as plain text, folds Unicode case, and normalizes to NFC", () => {
    const db = openTestDb();
    const c = make(db, "course", "c");
    make(db, "file", "100% sure", c);
    make(db, "file", "a_b", c);
    make(db, "file", "École normale", c);
    make(db, "file", 'say "hi"', c);
    expect(names(search(db, { q: "%" }))).toEqual(["100% sure"]);
    expect(names(search(db, { q: "_" }))).toEqual(["a_b"]);
    expect(names(search(db, { q: '"hi"' }))).toEqual(['say "hi"']);
    expect(names(search(db, { q: "école" }))).toEqual(["École normale"]);
    expect(names(search(db, { q: "école" }))).toEqual(["École normale"]);
  });

  it("orders rows by name, naturally", () => {
    const db = openTestDb();
    const c = make(db, "course", "c");
    make(db, "file", "doc 10", c);
    make(db, "file", "doc 2", c);
    expect(names(search(db, { q: "doc" }))).toEqual(["doc 2", "doc 10"]);
  });
});

// ---------------------------------------------------------------------------
// archived (§6.8)
// ---------------------------------------------------------------------------

describe("archived", () => {
  it("lists the archived nodes of every kind, with their archived_at, and not the live ones", () => {
    const db = openTestDb();
    const c = make(db, "course", "c");
    const f = make(db, "file", "f", c);
    const g = make(db, "file", "g", c);
    const live = make(db, "file", "live");
    deleteNode(db, c.id, { with_orphans: true });
    const rows = archived(db);
    expect(rows.map((n) => n.id).sort()).toEqual([c.id, f.id, g.id].sort());
    expect(rows.every((n) => n.archived_at !== null)).toBe(true);
    expect(rows.map((n) => n.id)).not.toContain(live.id);
    expect(rows.find((n) => n.id === f.id)).toMatchObject({ kind: "file", format: "markdown", placement_count: 0, top_level: false });
  });

  it("leaves a node out once it is restored, and lists the most recently archived first", () => {
    const db = openTestDb();
    const a = make(db, "file", "a");
    const b = make(db, "file", "b");
    const c = make(db, "file", "c");
    for (const n of [a, b, c]) deleteNode(db, n.id);
    db.prepare("UPDATE ws_node SET archived_at = '2026-01-01 10:00:00' WHERE id = ?").run(b.id);
    db.prepare("UPDATE ws_node SET archived_at = '2026-01-02 10:00:00' WHERE id = ?").run(a.id);
    db.prepare("UPDATE ws_node SET archived_at = '2026-01-02 10:00:00' WHERE id = ?").run(c.id);
    expect(archived(db).map((n) => n.title)).toEqual(["a", "c", "b"]);
    restore(db, a.id, []);
    expect(archived(db).map((n) => n.title)).toEqual(["c", "b"]);
  });

  it("is empty when nothing is archived", () => {
    const db = openTestDb();
    make(db, "file", "f");
    expect(archived(db)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// context (§6.9)
// ---------------------------------------------------------------------------

describe("context", () => {
  // j
  //   T (track), T2 (track), C (course)
  //   Research (folder)
  //     Sub (folder)
  //       Deep note
  //     Research note
  //   jfile, Syllabus (also placed in T as "Syllabus for T")
  // T:  tdoc            T2: t2doc, C2 (course) with c2doc            C: cdoc
  function world(db: Db) {
    const j = make(db, "trajectory", "j");
    const T = make(db, "track", "T", j);
    const T2 = make(db, "track", "T2", j);
    const C = make(db, "course", "C", j);
    const research = make(db, "folder", "Research", j);
    const sub = make(db, "folder", "Sub", research);
    const deep = make(db, "file", "deep", sub, "Deep note");
    const rnote = make(db, "file", "rnote", research, "Research note");
    const jfile = make(db, "file", "jfile", j);
    const syllabus = make(db, "file", "Syllabus", j);
    place(db, { container_id: T.id, child_id: syllabus.id, name: "Syllabus for T" });
    const tdoc = make(db, "file", "tdoc", T);
    const t2doc = make(db, "file", "t2doc", T2);
    const C2 = make(db, "course", "C2", T2);
    const c2doc = make(db, "file", "c2doc", C2);
    const cdoc = make(db, "file", "cdoc", C);
    return { j, T, T2, C, research, sub, deep, rnote, jfile, syllabus, tdoc, t2doc, C2, c2doc, cdoc };
  }

  it("shows a track its parent trajectory's own files, including those in the trajectory's folders", () => {
    const db = openTestDb();
    const w = world(db);
    const rows = context(db, w.T.id);
    expect(rows.map((r) => r.node.id)).toEqual([w.deep.id, w.rnote.id, w.jfile.id, w.syllabus.id]);
    expect(rows.map((r) => [r.name, r.container_id])).toEqual([
      ["Deep note", w.sub.id],
      ["Research note", w.research.id],
      ["jfile", w.j.id],
      ["Syllabus", w.j.id],
    ]);
    expect(rows[3]).toEqual({
      placement_id: placementId(db, w.j.id, w.syllabus.id),
      name: "Syllabus",
      container_id: w.j.id,
      node: expect.objectContaining({ id: w.syllabus.id, kind: "file", placement_count: 2 }),
    });
  });

  it("does not show another track's files, a course's files, or the track's own", () => {
    const db = openTestDb();
    const w = world(db);
    const ids = context(db, w.T.id).map((r) => r.node.id);
    for (const hidden of [w.t2doc, w.c2doc, w.cdoc, w.tdoc]) expect(ids).not.toContain(hidden.id);
    // The other track sees the same trajectory documents.
    expect(context(db, w.T2.id).map((r) => r.node.id)).toEqual(ids);
  });

  it("includes a file that is also placed inside another track, through its placement in the trajectory", () => {
    const db = openTestDb();
    const w = world(db);
    const shared = make(db, "file", "shared", w.research);
    place(db, { container_id: w.T2.id, child_id: shared.id, name: "shared in T2" });
    expect(context(db, w.T.id).map((r) => r.name)).toContain("shared");
    expect(context(db, w.T.id).map((r) => r.name)).not.toContain("shared in T2");
  });

  it("is the union over every trajectory the track is in, once per placement", () => {
    const db = openTestDb();
    const w = world(db);
    const j2 = make(db, "trajectory", "j2");
    place(db, { container_id: j2.id, child_id: w.T.id });
    const other = make(db, "file", "other", j2);
    // The same folder placed in both trajectories must not double its files.
    place(db, { container_id: j2.id, child_id: w.research.id, name: "Research too" });
    const rows = context(db, w.T.id);
    expect(rows.map((r) => r.name)).toContain("other");
    expect(rows.filter((r) => r.node.id === w.rnote.id)).toHaveLength(1);
    expect(rows.map((r) => r.node.id)).toContain(other.id);
  });

  it("is [] for a track with no trajectory, and for anything that is not a track", () => {
    const db = openTestDb();
    const w = world(db);
    const lone = make(db, "track", "lone");
    make(db, "file", "lone's own", lone);
    expect(context(db, lone.id)).toEqual([]);
    for (const notTrack of [w.j, w.C, w.research, w.jfile]) expect(context(db, notTrack.id), notTrack.id).toEqual([]);
    expect(codeOf(() => context(db, "nope"))).toBe("not_found");
  });

  it("hides archived files, archived folders' contents, an archived trajectory and an archived track", () => {
    const db = openTestDb();
    const w = world(db);
    deleteNode(db, w.jfile.id);
    deleteNode(db, w.sub.id);
    expect(context(db, w.T.id).map((r) => r.node.id)).toEqual([w.rnote.id, w.syllabus.id]);
    deleteNode(db, w.T.id);
    expect(context(db, w.T.id)).toEqual([]);
    deleteNode(db, w.j.id);
    expect(context(db, w.T2.id)).toEqual([]);
  });

  it("ignores a trajectory that no longer holds the track", () => {
    const db = openTestDb();
    const w = world(db);
    const j2 = make(db, "trajectory", "j2");
    make(db, "file", "only j2", j2);
    place(db, { container_id: j2.id, child_id: w.T.id });
    trash(db, placementId(db, j2.id, w.T.id));
    expect(context(db, w.T.id).map((r) => r.name)).not.toContain("only j2");
  });
});

// ---------------------------------------------------------------------------
// What "live" means (§2)
// ---------------------------------------------------------------------------

describe("a placement is live only when it, its container and its child all are", () => {
  // delete() keeps the node and its placements in step, so each state below is made
  // by hand: the reads must apply the spec's definition and not lean on that.
  function world(db: Db) {
    const c = make(db, "course", "c");
    const folder = make(db, "folder", "folder", c);
    const f = tagged(db, "needle", "source", folder);
    return { c, folder, f, pf: placementId(db, folder.id, f.id), pc: placementId(db, c.id, folder.id) };
  }
  const mark = (db: Db, placement: string) => db.prepare("UPDATE ws_placement SET archived_at = datetime('now') WHERE id = ?").run(placement);
  const archive = (db: Db, node: string) => db.prepare("UPDATE ws_node SET archived_at = datetime('now') WHERE id = ?").run(node);
  const states: Record<string, (db: Db, w: ReturnType<typeof world>) => void> = {
    "the placement is marked": (db, w) => mark(db, w.pf),
    "the child is archived": (db, w) => archive(db, w.f.id),
    "the container is archived": (db, w) => archive(db, w.folder.id),
  };

  for (const [state, apply] of Object.entries(states)) {
    it(`hides the file from every read when ${state}`, () => {
      const db = openTestDb();
      const w = world(db);
      expect(search(db, { q: "needle" })).toHaveLength(1);
      expect(subtree(db, w.c.id).map((r) => r.node.id)).toContain(w.f.id);
      apply(db, w);
      expect(children(db, w.folder.id)).toEqual([]);
      expect(subtree(db, w.c.id).map((r) => r.node.id)).not.toContain(w.f.id);
      expect(search(db, { q: "needle" })).toEqual([]);
      expect(search(db, { q: "needle", scope: w.c.id })).toEqual([]);
      expect(byKindTag(db, "source")).toEqual([]);
      expect(byKindTag(db, "source", w.c.id)).toEqual([]);
      expect(appearsIn(db, w.f.id)).toEqual([]);
    });
  }

  it("does not look through a marked placement: what is under it is not in the subtree above it", () => {
    const db = openTestDb();
    const w = world(db);
    mark(db, w.pc);
    expect(children(db, w.c.id)).toEqual([]);
    expect(subtree(db, w.c.id)).toEqual([]);
    expect(search(db, { q: "needle", scope: w.c.id })).toEqual([]);
    expect(byKindTag(db, "source", w.c.id)).toEqual([]);
    // The file's own placement is still live, in a live folder, so the unscoped reads see it.
    expect(search(db, { q: "needle" })).toHaveLength(1);
    expect(byKindTag(db, "source")).toHaveLength(1);
  });

  it("does not look through an archived container when a scope is given", () => {
    const db = openTestDb();
    const w = world(db);
    deleteNode(db, w.folder.id);
    expect(search(db, { q: "needle", scope: w.c.id })).toEqual([]);
    expect(byKindTag(db, "source", w.c.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Reads never call a hook (§7)
// ---------------------------------------------------------------------------

describe("reads and format hooks", () => {
  let calls = 0;
  let explode = false;
  registerFormat({
    format: "t-reads-flaky",
    searchText: (b) => {
      calls++;
      if (explode) throw new Error("search exploded");
      return b ?? "";
    },
    validate: () => {
      calls++;
      if (explode) throw new Error("validate exploded");
      return null;
    },
    append: (body, text) => {
      calls++;
      if (explode) throw new Error("append exploded");
      return `${body ?? ""}${text}`;
    },
  });

  it("lists, searches and reads a format whose hooks now throw, because search_text was computed at write time", () => {
    const db = openTestDb();
    const j = make(db, "trajectory", "j");
    const t = make(db, "track", "t", j);
    const c = make(db, "course", "c", t);
    const flaky = createNode(db, { kind: "file", title: "flaky", format: "t-reads-flaky", body: "needle text", kind_tag: "source", container_id: c.id }).node;
    const inJ = createNode(db, { kind: "file", title: "in j", format: "t-reads-flaky", body: "j needle", container_id: j.id }).node;
    const gone = createNode(db, { kind: "file", title: "gone", format: "t-reads-flaky", body: "x" }).node;
    deleteNode(db, gone.id);
    const loose = createNode(db, { kind: "file", title: "loose", format: "t-reads-flaky", body: "x" }).node;
    expect(calls).toBeGreaterThan(0);

    explode = true;
    const before = calls;
    try {
      expect(children(db, c.id).map((r) => r.node.id)).toEqual([flaky.id]);
      expect(subtree(db, j.id).map((r) => r.node.id)).toEqual([t.id, c.id, flaky.id, inJ.id]);
      expect(search(db, { q: "needle" }).map((r) => r.node.id).sort()).toEqual([flaky.id, inJ.id].sort());
      expect(search(db, { q: "needle", scope: t.id }).map((r) => r.node.id)).toEqual([flaky.id]);
      expect(byKindTag(db, "source").map((r) => r.node.id)).toEqual([flaky.id]);
      expect(context(db, t.id).map((r) => r.node.id)).toEqual([inJ.id]);
      expect(unplaced(db).map((n) => n.id)).toEqual([loose.id]);
      expect(archived(db).map((n) => n.id)).toEqual([gone.id]);
      expect(roots(db).courses.map((n) => n.id)).toEqual([c.id]);
      expect(appearsIn(db, flaky.id).map((r) => r.container.id)).toEqual([c.id]);
      expect(getNodeDetail(db, flaky.id).content?.format).toBe("t-reads-flaky");
      expect(getNode(db, flaky.id).id).toBe(flaky.id);
    } finally {
      explode = false;
    }
    expect(calls).toBe(before);
  });
});
