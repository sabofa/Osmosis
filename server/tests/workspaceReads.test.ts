import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openTestDb } from "./helpers.js";
import { DomainError } from "../src/domain/errors.js";
import { registerFileType } from "../src/domain/workspace/fileTypes.js";
import { createNode, placeNode, removePlacement, destroyNode, restoreNode, setKindTag } from "../src/domain/workspace/graph.js";
import { listRoots, listChildren, appearsIn, parentTracks, reach, coursesIn, searchWorkspace, getNodeDetail, listTrash } from "../src/domain/workspace/reads.js";

function file(db: ReturnType<typeof openTestDb>, title: string, container_id?: string, body = "body text") {
  return createNode(db, { kind: "file", title, file: { type: "markdown", body }, place_in: container_id ? { container_id } : undefined }).node;
}

describe("workspace reads", () => {
  it("children: containers first, then natural order by local name; trashed children hidden", () => {
    const db = openTestDb();
    const c = createNode(db, { kind: "course", title: "micro" }).node;
    file(db, "unit 10", c.id); file(db, "unit 2", c.id);
    const f = createNode(db, { kind: "folder", title: "zeta", place_in: { container_id: c.id } }).node;
    const gone = file(db, "gone", c.id);
    destroyNode(db, gone.id);
    expect(listChildren(db, c.id).map((r) => r.name)).toEqual(["zeta", "unit 2", "unit 10"]);
    expect(listChildren(db, c.id)[0].node.id).toBe(f.id);
  });

  it("appears-in lists every live placement; it drives the badge (placement_count)", () => {
    const db = openTestDb();
    const t = createNode(db, { kind: "track", title: "quant" }).node;
    const c = createNode(db, { kind: "course", title: "micro" }).node;
    const n = file(db, "Elasticity notes", t.id);
    placeNode(db, { container_id: c.id, child_id: n.id, name: "Supporting material" });
    expect(appearsIn(db, n.id).map((r) => `${r.container.title}/${r.name}`).sort()).toEqual(["micro/Supporting material", "quant/Elasticity notes"]);
    expect(listChildren(db, t.id)[0].node.placement_count).toBe(2);
  });

  it("parent tracks are found through folders; a course in two tracks reports both", () => {
    const db = openTestDb();
    const quant = createNode(db, { kind: "track", title: "quant" }).node;
    const amc = createNode(db, { kind: "track", title: "amc" }).node;
    const year = createNode(db, { kind: "folder", title: "Year 1", place_in: { container_id: quant.id } }).node;
    const math = createNode(db, { kind: "course", title: "math", place_in: { container_id: year.id } }).node;
    placeNode(db, { container_id: amc.id, child_id: math.id });
    expect(parentTracks(db, math.id).map((t) => t.title).sort()).toEqual(["amc", "quant"]);
    expect(coursesIn(db, quant.id)).toEqual([{ node: expect.objectContaining({ id: math.id }), path: ["Year 1", "math"] }]);
  });

  it("reach is the downward closure; roots list tracks, courses and unplaced files", () => {
    const db = openTestDb();
    const t = createNode(db, { kind: "track", title: "t" }).node;
    const c = createNode(db, { kind: "course", title: "c", place_in: { container_id: t.id } }).node;
    const inC = file(db, "in c", c.id);
    const loose = file(db, "loose");
    expect(reach(db, t.id).sort()).toEqual([c.id, inC.id].sort());
    const roots = listRoots(db);
    expect(roots.tracks.map((n) => n.id)).toEqual([t.id]);
    expect(roots.courses.map((n) => n.id)).toEqual([c.id]);
    expect(roots.unplaced.map((n) => n.id)).toEqual([loose.id]);
    removePlacement(db, getNodeDetail(db, inC.id).appears_in[0].placement_id);
    expect(listRoots(db).unplaced.map((n) => n.id).sort()).toEqual([inC.id, loose.id].sort());
  });

  it("search returns one row per placement under its local name, scoped to reach", () => {
    const db = openTestDb();
    const t = createNode(db, { kind: "track", title: "t" }).node;
    const c = createNode(db, { kind: "course", title: "c", place_in: { container_id: t.id } }).node;
    const n = file(db, "Elasticity notes", t.id, "price elasticity of demand");
    placeNode(db, { container_id: c.id, child_id: n.id, name: "Supporting material" });
    expect(searchWorkspace(db, { q: "elasticity", scope: t.id }).map((r) => r.name).sort()).toEqual(["Elasticity notes", "Supporting material"]);
    expect(searchWorkspace(db, { q: "demand", scope: c.id }).map((r) => r.name)).toEqual(["Supporting material"]);
  });
});

// ---------------------------------------------------------------------------
// The brief's tests are above. Below: what its rules imply.
// ---------------------------------------------------------------------------

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
const container = (db: Db, kind: "track" | "course" | "folder", title: string, container_id?: string) =>
  createNode(db, { kind, title, place_in: container_id ? { container_id } : undefined }).node;

describe("node summaries", () => {
  it("carry type, class, tag, placement_count and has_children", () => {
    const db = openTestDb();
    const t = container(db, "track", "t");
    const c = container(db, "course", "c", t.id);
    const doc = createNode(db, { kind: "file", title: "notes", kind_tag: "resource", file: { type: "markdown", body: "x" }, place_in: { container_id: c.id } }).node;
    createNode(db, { kind: "file", title: "plot", file: { type: "graph", body: "y = x" }, place_in: { container_id: c.id } });
    const kids = listChildren(db, c.id);
    expect(kids.find((k) => k.node.id === doc.id)!.node).toEqual({
      id: doc.id, kind: "file", title: "notes", kind_tag: "resource", type: "markdown", class: "document",
      placement_count: 1, has_children: false, trashed_at: null,
    });
    expect(kids.find((k) => k.name === "plot")!.node).toMatchObject({ type: "graph", class: "graph" });
    expect(listChildren(db, t.id)[0].node).toMatchObject({ kind: "course", type: null, class: null, has_children: true, placement_count: 1 });
    expect(getNodeDetail(db, doc.id).node.has_children).toBe(false);
  });

  it("has_children ignores trashed children; placement_count ignores placements in trashed containers", () => {
    const db = openTestDb();
    const a = container(db, "folder", "a");
    const b = container(db, "folder", "b");
    const n = createNode(db, { kind: "file", title: "n", file: { type: "markdown" }, place_in: { container_id: a.id } }).node;
    placeNode(db, { container_id: b.id, child_id: n.id });
    expect(getNodeDetail(db, a.id).node.has_children).toBe(true);
    expect(getNodeDetail(db, n.id).node.placement_count).toBe(2);
    destroyNode(db, b.id);
    expect(getNodeDetail(db, n.id).node.placement_count).toBe(1);
    destroyNode(db, n.id);
    expect(getNodeDetail(db, a.id).node.has_children).toBe(false);
  });

  it("class of an uploaded asset comes from its mime and type", () => {
    const db = openTestDb();
    const insert = db.prepare("INSERT INTO asset (id, title, type, mime) VALUES (?, ?, ?, ?)");
    insert.run("pdf", "paper", "file", "application/pdf");
    insert.run("img", "photo", "file", "image/png");
    insert.run("lnk", "site", "url", null);
    insert.run("doc", "scan", "file", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    insert.run("txt", "pasted", "text", null);
    const byId = new Map(listRoots(db).unplaced.map((n) => [n.id, n.class]));
    expect(Object.fromEntries(byId)).toEqual({ "asset:pdf": "pdf", "asset:img": "image", "asset:lnk": "link", "asset:doc": "document", "asset:txt": "document" });
  });

  it("class of a file comes from the page kinds its type declares", () => {
    const db = openTestDb();
    registerFileType({ type: "ws-reads-mixed", storage: "text", appendable: false, kinds: () => ["text", "plot"] });
    registerFileType({ type: "ws-reads-none", storage: "text", appendable: false, kinds: () => [] });
    createNode(db, { kind: "file", title: "m", file: { type: "ws-reads-mixed" } });
    createNode(db, { kind: "file", title: "z", file: { type: "ws-reads-none" } });
    const classes = Object.fromEntries(listRoots(db).unplaced.map((n) => [n.title, n.class]));
    expect(classes).toEqual({ m: "mixed", z: "empty" });
  });
});

describe("children", () => {
  it("lists nothing for a trashed container, shows the local name, and refuses an unknown container", () => {
    const db = openTestDb();
    const c = container(db, "course", "c");
    const n = createNode(db, { kind: "file", title: "Elasticity notes", file: { type: "markdown" }, place_in: { container_id: c.id, name: "Week 1" } }).node;
    expect(listChildren(db, c.id).map((r) => [r.name, r.node.title])).toEqual([["Week 1", "Elasticity notes"]]);
    destroyNode(db, c.id);
    expect(listChildren(db, c.id)).toEqual([]);
    restoreNode(db, c.id);
    expect(listChildren(db, c.id)).toHaveLength(1);
    expect(listChildren(db, n.id)).toEqual([]); // a file holds nothing
    expect(codeOf(() => listChildren(db, "ghost"))).toBe("not_found");
  });

  it("sorts every kind of container ahead of files, and names naturally and case-insensitively", () => {
    const db = openTestDb();
    const t = container(db, "track", "t");
    createNode(db, { kind: "file", title: "a file", file: { type: "markdown" }, place_in: { container_id: t.id } });
    container(db, "folder", "b folder", t.id);
    container(db, "course", "c course", t.id);
    container(db, "track", "d track", t.id);
    createNode(db, { kind: "file", title: "Zed 9", file: { type: "markdown" }, place_in: { container_id: t.id } });
    createNode(db, { kind: "file", title: "zed 10", file: { type: "markdown" }, place_in: { container_id: t.id } });
    expect(listChildren(db, t.id).map((r) => r.name)).toEqual(["b folder", "c course", "d track", "a file", "Zed 9", "zed 10"]);
  });
});

describe("appears-in and parent tracks", () => {
  it("appears-in names the live containers only, and detail carries the file facts", () => {
    const db = openTestDb();
    const a = container(db, "folder", "a");
    const b = container(db, "folder", "b");
    const n = createNode(db, { kind: "file", title: "n", file: { type: "markdown", body: "x" }, place_in: { container_id: a.id }, author: "planner" }).node;
    placeNode(db, { container_id: b.id, child_id: n.id, name: "n here" });
    destroyNode(db, b.id);
    expect(appearsIn(db, n.id)).toEqual([{ placement_id: expect.any(String), container: { id: a.id, kind: "folder", title: "a" }, name: "n" }]);
    const detail = getNodeDetail(db, n.id);
    expect(detail.file).toEqual({ type: "markdown", revision: 1, saved_at: expect.any(String), saved_by: "planner", asset_id: null });
    expect(getNodeDetail(db, a.id).file).toBeNull();
    expect(codeOf(() => getNodeDetail(db, "ghost"))).toBe("not_found");
    expect(codeOf(() => appearsIn(db, "ghost"))).toBe("not_found");
  });

  it("parent tracks skip a track in the trash and include tracks above tracks", () => {
    const db = openTestDb();
    const outer = container(db, "track", "outer");
    const inner = container(db, "track", "inner", outer.id);
    const dead = container(db, "track", "dead");
    const course = container(db, "course", "course", inner.id);
    placeNode(db, { container_id: dead.id, child_id: course.id });
    destroyNode(db, dead.id);
    expect(parentTracks(db, course.id).map((t) => t.title)).toEqual(["inner", "outer"]);
    expect(parentTracks(db, outer.id)).toEqual([]);
    expect(codeOf(() => parentTracks(db, "ghost"))).toBe("not_found");
  });
});

describe("reach and courses", () => {
  it("reach skips trashed nodes and what is only reachable through them, and a trashed root reaches nothing", () => {
    const db = openTestDb();
    const t = container(db, "track", "t");
    const f = container(db, "folder", "f", t.id);
    const deep = createNode(db, { kind: "file", title: "deep", file: { type: "markdown" }, place_in: { container_id: f.id } }).node;
    const direct = createNode(db, { kind: "file", title: "direct", file: { type: "markdown" }, place_in: { container_id: t.id } }).node;
    expect(reach(db, t.id).sort()).toEqual([f.id, deep.id, direct.id].sort());
    expect(reach(db, f.id)).toEqual([deep.id]);
    destroyNode(db, f.id);
    expect(reach(db, t.id)).toEqual([direct.id]);
    destroyNode(db, t.id);
    expect(reach(db, t.id)).toEqual([]);
    expect(codeOf(() => reach(db, "ghost"))).toBe("not_found");
  });

  it("a node reachable twice is listed once", () => {
    const db = openTestDb();
    const t = container(db, "track", "t");
    const f = container(db, "folder", "f", t.id);
    const n = createNode(db, { kind: "file", title: "n", file: { type: "markdown" }, place_in: { container_id: f.id } }).node;
    placeNode(db, { container_id: t.id, child_id: n.id });
    expect(reach(db, t.id).filter((id) => id === n.id)).toHaveLength(1);
  });

  it("coursesIn lists a course once by its shortest route, sorted, and none in the trash", () => {
    const db = openTestDb();
    const t = container(db, "track", "t");
    const y1 = container(db, "folder", "Year 1", t.id);
    const y2 = container(db, "folder", "Year 2", t.id);
    const calc = container(db, "course", "calc", y1.id);
    placeNode(db, { container_id: t.id, child_id: calc.id, name: "Calculus" });
    container(db, "course", "algebra", y2.id);
    const gone = container(db, "course", "gone", y1.id);
    destroyNode(db, gone.id);
    expect(coursesIn(db, t.id).map((r) => r.path)).toEqual([["Calculus"], ["Year 2", "algebra"]]);
    destroyNode(db, t.id);
    expect(coursesIn(db, t.id)).toEqual([]);
    expect(codeOf(() => coursesIn(db, "ghost"))).toBe("not_found");
  });
});

describe("roots", () => {
  it("unplaced means no placement in a live container: a file only in a trashed folder is unplaced", () => {
    const db = openTestDb();
    const f = container(db, "folder", "f");
    const n = createNode(db, { kind: "file", title: "n", file: { type: "markdown" }, place_in: { container_id: f.id } }).node;
    const sub = container(db, "folder", "sub", f.id);
    expect(listRoots(db).unplaced.map((r) => r.id)).toEqual([f.id]);
    destroyNode(db, f.id);
    expect(listRoots(db).unplaced.map((r) => r.id).sort()).toEqual([n.id, sub.id].sort());
    restoreNode(db, f.id);
    expect(listRoots(db).unplaced.map((r) => r.id)).toEqual([f.id]);
  });

  it("tracks and courses are roots whether or not they are placed; trashed nodes are in none of the lists", () => {
    const db = openTestDb();
    const t = container(db, "track", "t");
    const c = container(db, "course", "c", t.id);
    const gone = container(db, "course", "gone");
    destroyNode(db, gone.id);
    const roots = listRoots(db);
    expect([roots.tracks.map((r) => r.id), roots.courses.map((r) => r.id), roots.unplaced]).toEqual([[t.id], [c.id], []]);
  });
});

describe("search in depth", () => {
  it("matches the node title, the body and the local name, case-insensitively, one row per placement", () => {
    const db = openTestDb();
    const c = container(db, "course", "c");
    const n = createNode(db, { kind: "file", title: "Notes", file: { type: "markdown", body: "Price ELASTICITY of demand" }, place_in: { container_id: c.id, name: "Week 1" } }).node;
    for (const q of ["notes", "NOTES", "week", "elasticity", "of demand"]) {
      expect(searchWorkspace(db, { q, scope: c.id }).map((r) => r.node.id)).toEqual([n.id]);
    }
    expect(searchWorkspace(db, { q: "supply", scope: c.id })).toEqual([]);
    expect(searchWorkspace(db, { q: "week", scope: c.id })[0]).toMatchObject({ name: "Week 1", container_id: c.id, placement_id: expect.any(String) });
  });

  it("without a scope: every live placement, plus each unplaced node once as a root row", () => {
    const db = openTestDb();
    const t = container(db, "track", "alpha track");
    const c = container(db, "course", "alpha course", t.id);
    const loose = createNode(db, { kind: "file", title: "alpha loose", file: { type: "markdown" } }).node;
    const placed = createNode(db, { kind: "file", title: "alpha placed", file: { type: "markdown" }, place_in: { container_id: c.id } }).node;
    const rows = searchWorkspace(db, { q: "alpha" });
    expect(rows.map((r) => r.name)).toEqual(["alpha course", "alpha loose", "alpha placed", "alpha track"]);
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(byName.get("alpha track")).toMatchObject({ placement_id: null, container_id: null });
    expect(byName.get("alpha loose")).toMatchObject({ placement_id: null, container_id: null, node: { id: loose.id } });
    expect(byName.get("alpha placed")).toMatchObject({ container_id: c.id, node: { id: placed.id } });
    expect(byName.get("alpha course")).toMatchObject({ container_id: t.id });
  });

  it("hides trashed nodes and placements inside trashed containers; a file whose only container is trashed is an unplaced row", () => {
    const db = openTestDb();
    const f = container(db, "folder", "f");
    const n = createNode(db, { kind: "file", title: "needle", file: { type: "markdown" }, place_in: { container_id: f.id } }).node;
    expect(searchWorkspace(db, { q: "needle" }).map((r) => r.container_id)).toEqual([f.id]);
    destroyNode(db, f.id);
    expect(searchWorkspace(db, { q: "needle" })).toEqual([expect.objectContaining({ placement_id: null, container_id: null, node: expect.objectContaining({ id: n.id }) })]);
    destroyNode(db, n.id);
    expect(searchWorkspace(db, { q: "needle" })).toEqual([]);
    expect(searchWorkspace(db, { q: "needle", scope: f.id })).toEqual([]);
  });

  it("filters by kind tag, with or without a query, and refuses an unknown tag", () => {
    const db = openTestDb();
    const c = container(db, "course", "c");
    const hw = createNode(db, { kind: "file", title: "set 1", kind_tag: "homework", file: { type: "markdown" }, place_in: { container_id: c.id } }).node;
    createNode(db, { kind: "file", title: "set 2", file: { type: "markdown" }, place_in: { container_id: c.id } });
    expect(searchWorkspace(db, { scope: c.id, kind_tag: "homework" }).map((r) => r.node.id)).toEqual([hw.id]);
    expect(searchWorkspace(db, { q: "set", kind_tag: "homework" }).map((r) => r.node.id)).toEqual([hw.id]);
    setKindTag(db, hw.id, null);
    expect(searchWorkspace(db, { scope: c.id, kind_tag: "homework" })).toEqual([]);
    expect(codeOf(() => searchWorkspace(db, { kind_tag: "nonsense" as never }))).toBe("invalid_input");
  });

  it("uses a type's searchText, and a type without one is found by name only", () => {
    const db = openTestDb();
    registerFileType({ type: "ws-reads-item", storage: "json", appendable: false, kinds: () => ["text"], searchText: (b) => (b ? (JSON.parse(b) as { prompt: string }).prompt : "") });
    registerFileType({ type: "ws-reads-opaque", storage: "text", appendable: false, kinds: () => [] });
    createNode(db, { kind: "file", title: "q1", file: { type: "ws-reads-item", body: JSON.stringify({ prompt: "compute the gradient" }) } });
    createNode(db, { kind: "file", title: "o1", file: { type: "ws-reads-opaque", body: "gradient inside" } });
    expect(searchWorkspace(db, { q: "gradient" }).map((r) => r.name)).toEqual(["q1"]);
  });

  it("a blank query lists everything; an unknown scope is not_found and a trashed one has nothing", () => {
    const db = openTestDb();
    const c = container(db, "course", "c");
    createNode(db, { kind: "file", title: "a", file: { type: "markdown" }, place_in: { container_id: c.id } });
    expect(searchWorkspace(db, { q: "  ", scope: c.id })).toHaveLength(1);
    expect(codeOf(() => searchWorkspace(db, { scope: "ghost" }))).toBe("not_found");
    destroyNode(db, c.id);
    expect(searchWorkspace(db, { scope: c.id })).toEqual([]);
  });

  it("finds an upload before anything has listed the roots", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content) VALUES ('a1', 'Ebbing ch3', 'text', 'x')").run();
    expect(searchWorkspace(db, { q: "ebbing" }).map((r) => r.node.id)).toEqual(["asset:a1"]);
  });
});

describe("trash list", () => {
  it("lists trashed nodes, most recent first, and restore takes them out", () => {
    const db = openTestDb();
    const a = container(db, "folder", "a");
    const b = container(db, "folder", "b");
    const n = createNode(db, { kind: "file", title: "n", file: { type: "markdown" } }).node;
    destroyNode(db, a.id);
    destroyNode(db, b.id);
    destroyNode(db, n.id);
    db.prepare("UPDATE ws_node SET trashed_at = '2026-10-01 00:00:00' WHERE id = ?").run(a.id);
    db.prepare("UPDATE ws_node SET trashed_at = '2026-10-02 00:00:00' WHERE id = ?").run(b.id);
    db.prepare("UPDATE ws_node SET trashed_at = '2026-10-03 00:00:00' WHERE id = ?").run(n.id);
    expect(listTrash(db).map((r) => r.title)).toEqual(["n", "b", "a"]);
    expect(listTrash(db)[0]).toMatchObject({ type: "markdown", trashed_at: "2026-10-03 00:00:00" });
    restoreNode(db, b.id);
    expect(listTrash(db).map((r) => r.title)).toEqual(["n", "a"]);
  });
});

describe("one bad body does not break a listing", () => {
  // The registry is module-global, so this type name is unique to this block.
  // A special type's kinds() and searchText() read the body; a body that does
  // not parse (JSON.parse's SyntaxError, not a DomainError) must cost its own
  // row a class or a search hit and nothing else.
  registerFileType({
    type: "ws-reads-throwing",
    storage: "json",
    appendable: false,
    kinds: (b) => (JSON.parse(b ?? "{}") as { kinds: string[] }).kinds ?? [],
    searchText: (b) => (JSON.parse(b ?? "{}") as { q: string }).q ?? "",
  });
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => undefined); });
  afterEach(() => { warn.mockRestore(); });
  const throwing = (db: ReturnType<typeof openTestDb>, title: string, body: string, container_id?: string) =>
    createNode(db, { kind: "file", title, file: { type: "ws-reads-throwing", body }, place_in: container_id ? { container_id } : undefined }).node;

  it("roots, children and trash list the row with a null class; the good rows keep theirs", () => {
    const db = openTestDb();
    const c = createNode(db, { kind: "course", title: "micro" }).node;
    throwing(db, "broken", "{not json", c.id);
    throwing(db, "fine", JSON.stringify({ kinds: ["text"] }), c.id);
    file(db, "plain", c.id);
    const loose = throwing(db, "loose broken", "{not json");
    const classes = Object.fromEntries(listChildren(db, c.id).map((r) => [r.name, r.node.class]));
    expect(classes).toEqual({ broken: null, fine: "document", plain: "document" });
    expect(listRoots(db).unplaced.find((n) => n.id === loose.id)).toMatchObject({ type: "ws-reads-throwing", class: null });
    expect(listRoots(db).courses.map((n) => n.title)).toEqual(["micro"]);
    destroyNode(db, loose.id);
    expect(listTrash(db).find((n) => n.id === loose.id)).toMatchObject({ class: null });
  });

  it("search returns the other rows, and the row whose body will not parse is not matched by its text", () => {
    const db = openTestDb();
    const c = createNode(db, { kind: "course", title: "micro" }).node;
    throwing(db, "broken", "{not json supply", c.id);
    throwing(db, "good", JSON.stringify({ kinds: [], q: "supply curve" }), c.id);
    file(db, "notes", c.id, "the supply side");
    expect(searchWorkspace(db, { q: "supply", scope: c.id }).map((r) => r.name).sort()).toEqual(["good", "notes"]);
    // Without a scope the unplaced pass runs too, and a title still finds the broken row.
    expect(searchWorkspace(db, { q: "supply" }).map((r) => r.name).sort()).toEqual(["good", "notes"]);
    expect(searchWorkspace(db, { q: "broken", scope: c.id }).map((r) => r.name)).toEqual(["broken"]);
  });

  it("a file whose type is no longer registered lists with a null class and search skips its text, with a warning", () => {
    const db = openTestDb();
    const c = createNode(db, { kind: "course", title: "micro" }).node;
    const gone = file(db, "orphaned", c.id, "supply");
    db.prepare("UPDATE ws_file SET type = 'ws-reads-removed' WHERE node_id = ?").run(gone.id);
    expect(listChildren(db, c.id)[0].node).toMatchObject({ type: "ws-reads-removed", class: null });
    expect(searchWorkspace(db, { q: "supply", scope: c.id })).toEqual([]);
    expect(warn.mock.calls.map((x) => x.join(" ")).join(" | ")).toContain("ws-reads-removed");
  });

  it("warns about a bad row, naming the node and its type", () => {
    const db = openTestDb();
    const bad = throwing(db, "broken", "{not json");
    listRoots(db);
    const text = warn.mock.calls.map((c) => c.join(" ")).join(" | ");
    expect(text).toContain(bad.id);
    expect(text).toContain("ws-reads-throwing");
  });
});

describe("the domain index", () => {
  it("re-exports the graph, reads, content, asset files, file types, names and types", async () => {
    const ws = await import("../src/domain/workspace/index.js");
    for (const name of [
      "createNode", "placeNode", "destroyNode", "listRoots", "listChildren", "searchWorkspace", "readContent", "saveContent",
      "appendContent", "syncAssetFiles", "getFileType", "registerFileType", "normalizeName", "MAY_HOLD", "NODE_KINDS",
    ]) {
      expect(typeof (ws as Record<string, unknown>)[name], name).not.toBe("undefined");
    }
  });
});
