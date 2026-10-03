import { describe, it, expect } from "vitest";
import { openTestDb } from "./helpers.js";
import { DomainError } from "../src/domain/errors.js";
import { registerFileType } from "../src/domain/workspace/fileTypes.js";
import { createNode, destroyNode, placeNode, purgeNode, restoreNode } from "../src/domain/workspace/graph.js";
import { readContent, saveContent, appendContent, listRevisions } from "../src/domain/workspace/content.js";
import { syncAssetFiles } from "../src/domain/workspace/assetFiles.js";
import { listRoots, listTrash, getNodeDetail } from "../src/domain/workspace/reads.js";

describe("workspace content", () => {
  it("saves optimistically: a stale base revision is refused with the current one", () => {
    const db = openTestDb();
    const n = createNode(db, { kind: "file", title: "f", file: { type: "markdown", body: "one" } }).node;
    expect(saveContent(db, n.id, { body: "two", base_revision: 1, author: "ben" }).revision).toBe(2);
    expect(() => saveContent(db, n.id, { body: "three", base_revision: 1, author: "ben" })).toThrow(/stale_revision|current revision is 2/);
    expect(readContent(db, n.id)).toMatchObject({ body: "two", revision: 2, saved_by: "ben" });
  });

  it("appends without a base revision, records who wrote each revision, and refuses non-appendable types", () => {
    const db = openTestDb();
    const notes = createNode(db, { kind: "file", title: "USERNOTES", file: { type: "markdown", body: "" } }).node;
    appendContent(db, notes.id, { text: "- confuses moles with mass (2026-10-03, Q on 3.2 g of C)", author: "tutor" });
    appendContent(db, notes.id, { text: "- second note", author: "tutor" });
    expect(readContent(db, notes.id).body).toBe("- confuses moles with mass (2026-10-03, Q on 3.2 g of C)\n\n- second note");
    expect(listRevisions(db, notes.id).map((r) => r.saved_by)).toEqual(["ben", "tutor", "tutor"]);
    const g = createNode(db, { kind: "file", title: "g", file: { type: "graph", body: "y = x" } }).node;
    expect(() => appendContent(db, g.id, { text: "y = 2x", author: "planner" })).toThrow(/not_appendable/);
  });

  it("gives every upload one unplaced asset file, idempotently", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content) VALUES ('a1', 'Ebbing ch3', 'text', 'x')").run();
    syncAssetFiles(db); syncAssetFiles(db);
    const unplaced = listRoots(db).unplaced;
    expect(unplaced.map((n) => n.id)).toEqual(["asset:a1"]);
    expect(unplaced[0]).toMatchObject({ type: "asset", kind_tag: "source", class: "document" });
  });
});

// ---------------------------------------------------------------------------
// The brief's tests are above. Below: what its rules imply.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof openTestDb>;
function failure(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error("expected a DomainError, nothing was thrown");
}
const md = (db: Db, body: string | null = "one", title = "f") => createNode(db, { kind: "file", title, file: { type: "markdown", body } }).node;
const nodeRow = (db: Db, id: string) => db.prepare("SELECT * FROM ws_node WHERE id = ?").get(id) as { updated_at: string; trashed_at: string | null };
const OLD = "2000-01-01 00:00:00";

describe("save in depth", () => {
  it("a stale save changes nothing and carries the current revision as a code, in the message and in the detail", () => {
    const db = openTestDb();
    const n = md(db);
    saveContent(db, n.id, { body: "two", base_revision: 1, author: "ben" });
    saveContent(db, n.id, { body: "three", base_revision: 2, author: "tutor" });
    const err = failure(() => saveContent(db, n.id, { body: "stale", base_revision: 1, author: "ben" }));
    expect(err.code).toBe("stale_revision");
    expect(err.message).toContain("current revision is 3");
    expect(err.detail).toEqual({ current_revision: 3 });
    expect(failure(() => saveContent(db, n.id, { body: "ahead", base_revision: 4, author: "ben" })).code).toBe("stale_revision");
    expect(readContent(db, n.id)).toMatchObject({ body: "three", revision: 3, saved_by: "tutor" });
    expect(listRevisions(db, n.id)).toHaveLength(3);
  });

  it("each save writes a revision row with its body and author, bumps the file, and stamps the node", () => {
    const db = openTestDb();
    const n = md(db);
    db.prepare("UPDATE ws_node SET updated_at = ? WHERE id = ?").run(OLD, n.id);
    const saved = saveContent(db, n.id, { body: "two", base_revision: 1, author: "planner" });
    expect(saved).toEqual({ revision: 2, saved_at: expect.any(String) });
    expect(nodeRow(db, n.id).updated_at).not.toBe(OLD);
    const rows = db.prepare("SELECT revision, body, type, saved_by FROM ws_file_revision WHERE node_id = ? ORDER BY revision").all(n.id);
    expect(rows).toEqual([
      { revision: 1, body: "one", type: "markdown", saved_by: "ben" },
      { revision: 2, body: "two", type: "markdown", saved_by: "planner" },
    ]);
    expect(listRevisions(db, n.id)[1]).toEqual({ revision: 2, saved_at: saved.saved_at, saved_by: "planner" });
  });

  it("a body may be cleared to null, and an empty file saves like any other", () => {
    const db = openTestDb();
    const n = md(db, null);
    expect(readContent(db, n.id)).toMatchObject({ body: null, revision: 1 });
    saveContent(db, n.id, { body: "x", base_revision: 1, author: "ben" });
    saveContent(db, n.id, { body: null, base_revision: 2, author: "ben" });
    expect(readContent(db, n.id).body).toBeNull();
  });

  it("runs the type's validate, and a rejected save leaves the file and its history alone", () => {
    const db = openTestDb();
    registerFileType({ type: "ws-content-strict", storage: "text", appendable: true, kinds: () => [], validate: (b) => (b === null || !b.includes("BAD") ? null : "no BAD allowed") });
    const n = createNode(db, { kind: "file", title: "s", file: { type: "ws-content-strict", body: "fine" } }).node;
    const err = failure(() => saveContent(db, n.id, { body: "BAD", base_revision: 1, author: "ben" }));
    expect([err.code, err.message]).toEqual(["invalid_content", "no BAD allowed"]);
    expect(failure(() => appendContent(db, n.id, { text: "BAD", author: "tutor" })).code).toBe("invalid_content");
    expect(readContent(db, n.id)).toMatchObject({ body: "fine", revision: 1 });
    expect(listRevisions(db, n.id)).toHaveLength(1);
    expect(saveContent(db, n.id, { body: "fine too", base_revision: 1, author: "ben" }).revision).toBe(2);
  });

  it("refuses an unknown author, a non-text body, a non-integer base revision and an uploaded asset's content", () => {
    const db = openTestDb();
    const n = md(db);
    expect(failure(() => saveContent(db, n.id, { body: "x", base_revision: 1, author: "robot" as never })).code).toBe("invalid_input");
    expect(failure(() => saveContent(db, n.id, { body: 5 as never, base_revision: 1, author: "ben" })).code).toBe("invalid_input");
    expect(failure(() => saveContent(db, n.id, { body: "x", base_revision: "1" as never, author: "ben" })).code).toBe("invalid_input");
    expect(failure(() => saveContent(db, n.id, { body: "x", base_revision: undefined as never, author: "ben" })).code).toBe("invalid_input");
    db.prepare("INSERT INTO asset (id, title, type) VALUES ('a1', 'scan', 'file')").run();
    syncAssetFiles(db);
    expect(failure(() => saveContent(db, "asset:a1", { body: "x", base_revision: 1, author: "ben" })).code).toBe("invalid_input");
    expect(readContent(db, n.id).revision).toBe(1);
  });

  it("only a file has content; an unknown node is not_found; a trashed file can't be changed but can be read", () => {
    const db = openTestDb();
    const folder = createNode(db, { kind: "folder", title: "f" }).node;
    for (const call of [
      () => readContent(db, folder.id),
      () => saveContent(db, folder.id, { body: "x", base_revision: 1, author: "ben" }),
      () => appendContent(db, folder.id, { text: "x", author: "ben" }),
      () => listRevisions(db, folder.id),
    ]) {
      expect(failure(call).code).toBe("invalid_input");
    }
    expect(failure(() => readContent(db, "ghost")).code).toBe("not_found");
    expect(failure(() => saveContent(db, "ghost", { body: "x", base_revision: 1, author: "ben" })).code).toBe("not_found");
    const n = md(db);
    destroyNode(db, n.id);
    expect(failure(() => saveContent(db, n.id, { body: "x", base_revision: 1, author: "ben" })).code).toBe("trashed");
    expect(failure(() => appendContent(db, n.id, { text: "x", author: "tutor" })).code).toBe("trashed");
    expect(readContent(db, n.id)).toMatchObject({ body: "one", revision: 1 });
  });

  it("reads the asset id of an asset file and no body", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content) VALUES ('a1', 'paper', 'text', 'x')").run();
    syncAssetFiles(db);
    expect(readContent(db, "asset:a1")).toMatchObject({ type: "asset", body: null, asset_id: "a1", revision: 1, saved_by: "ben" });
    expect(getNodeDetail(db, "asset:a1").file).toMatchObject({ type: "asset", asset_id: "a1" });
  });
});

describe("append in depth", () => {
  it("starts an empty or null body with the text alone, keeps the text exactly, and refuses nothing-to-add", () => {
    const db = openTestDb();
    const empty = md(db, "");
    const none = md(db, null, "g");
    appendContent(db, empty.id, { text: "  - first\n", author: "tutor" });
    appendContent(db, none.id, { text: "only", author: "tutor" });
    expect(readContent(db, empty.id).body).toBe("  - first\n");
    expect(readContent(db, none.id).body).toBe("only");
    expect(failure(() => appendContent(db, none.id, { text: "   ", author: "tutor" })).code).toBe("invalid_input");
    expect(failure(() => appendContent(db, none.id, { text: undefined as never, author: "tutor" })).code).toBe("invalid_input");
    expect(failure(() => appendContent(db, none.id, { text: "x", author: "robot" as never })).code).toBe("invalid_input");
    expect(readContent(db, none.id).revision).toBe(2);
  });

  it("is not blocked by Ben's edits: it appends to whatever is there now", () => {
    const db = openTestDb();
    const notes = md(db, "ben wrote this", "USERNOTES");
    saveContent(db, notes.id, { body: "ben rewrote it", base_revision: 1, author: "ben" });
    const appended = appendContent(db, notes.id, { text: "tutor note", author: "tutor" });
    expect(appended.revision).toBe(3);
    expect(readContent(db, notes.id)).toMatchObject({ body: "ben rewrote it\n\ntutor note", saved_by: "tutor" });
  });

  it("names the code when a type refuses appending, and an asset file refuses it too", () => {
    const db = openTestDb();
    const g = createNode(db, { kind: "file", title: "g", file: { type: "graph", body: "y = x" } }).node;
    const err = failure(() => appendContent(db, g.id, { text: "y = 2x", author: "planner" }));
    expect(err.code).toBe("not_appendable");
    expect(err.message).toContain("not_appendable");
    expect(readContent(db, g.id).revision).toBe(1);
    db.prepare("INSERT INTO asset (id, title, type) VALUES ('a1', 'scan', 'file')").run();
    syncAssetFiles(db);
    expect(failure(() => appendContent(db, "asset:a1", { text: "x", author: "ben" })).code).toBe("not_appendable");
  });
});

describe("asset files in depth", () => {
  const addAsset = (db: Db, id: string, title: string, type = "text") => db.prepare("INSERT INTO asset (id, title, type) VALUES (?, ?, ?)").run(id, title, type);
  const count = (db: Db, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  it("makes the wrapper a real file: revision 1 with its revision row, by ben, tagged source", () => {
    const db = openTestDb();
    addAsset(db, "a1", "Ebbing ch3");
    syncAssetFiles(db);
    expect(db.prepare("SELECT kind, title, kind_tag, trashed_at FROM ws_node WHERE id = 'asset:a1'").get()).toEqual({ kind: "file", title: "Ebbing ch3", kind_tag: "source", trashed_at: null });
    expect(db.prepare("SELECT type, body, asset_id, revision, saved_by FROM ws_file WHERE node_id = 'asset:a1'").get()).toEqual({ type: "asset", body: null, asset_id: "a1", revision: 1, saved_by: "ben" });
    expect(listRevisions(db, "asset:a1")).toEqual([{ revision: 1, saved_at: expect.any(String), saved_by: "ben" }]);
    expect(count(db, "ws_placement")).toBe(0);
  });

  it("is idempotent, adds only what is new, and leaves a placed or trashed wrapper where it is", () => {
    const db = openTestDb();
    addAsset(db, "a1", "one");
    addAsset(db, "a2", "two");
    syncAssetFiles(db);
    const folder = createNode(db, { kind: "folder", title: "inbox" }).node;
    placeNode(db, { container_id: folder.id, child_id: "asset:a1" });
    destroyNode(db, "asset:a2");
    addAsset(db, "a3", "three");
    syncAssetFiles(db);
    syncAssetFiles(db);
    expect(count(db, "ws_node")).toBe(4); // folder + three wrappers
    expect(count(db, "ws_file")).toBe(3);
    expect(count(db, "ws_file_revision")).toBe(3);
    expect(count(db, "ws_placement")).toBe(1);
    expect(listTrash(db).map((n) => n.id)).toEqual(["asset:a2"]);
    expect(listRoots(db).unplaced.map((n) => n.id).sort()).toEqual([folder.id, "asset:a3"].sort());
  });

  it("trashes a wrapper whose asset was deleted, once, and keeps its placements", () => {
    const db = openTestDb();
    addAsset(db, "a1", "one");
    addAsset(db, "a2", "two");
    syncAssetFiles(db);
    const folder = createNode(db, { kind: "folder", title: "inbox" }).node;
    placeNode(db, { container_id: folder.id, child_id: "asset:a1" });
    db.prepare("DELETE FROM asset WHERE id = 'a1'").run();
    expect(db.prepare("SELECT asset_id FROM ws_file WHERE node_id = 'asset:a1'").get()).toEqual({ asset_id: null });
    syncAssetFiles(db);
    const trashedAt = nodeRow(db, "asset:a1").trashed_at;
    expect(trashedAt).not.toBeNull();
    expect(nodeRow(db, "asset:a2").trashed_at).toBeNull();
    db.prepare("UPDATE ws_node SET trashed_at = '2026-01-01 00:00:00' WHERE id = 'asset:a1'").run();
    syncAssetFiles(db);
    expect(nodeRow(db, "asset:a1").trashed_at).toBe("2026-01-01 00:00:00"); // trashed once, not re-stamped
    expect(count(db, "ws_placement")).toBe(1);
    expect(listRoots(db).unplaced.map((n) => n.id).sort()).toEqual([folder.id, "asset:a2"].sort());
  });

  it("keeps a title that is a valid name, and makes a valid one out of one that is not", () => {
    const db = openTestDb();
    addAsset(db, "ok", "Ebbing ch3 — Café");
    addAsset(db, "url", "https://example.com/paper.pdf");
    addAsset(db, "ctl", "tab\there\u0007bell");
    addAsset(db, "blank", "   ");
    addAsset(db, "long", "x".repeat(300));
    syncAssetFiles(db);
    const titles = Object.fromEntries(listRoots(db).unplaced.map((n) => [n.id, n.title]));
    expect(titles["asset:ok"]).toBe("Ebbing ch3 — Café");
    expect(titles["asset:url"]).toBe("https:--example.com-paper.pdf");
    expect(titles["asset:ctl"]).toBe("tab here bell");
    expect(titles["asset:blank"]).toBe("Untitled upload");
    expect([...titles["asset:long"]]).toHaveLength(200);
    // each title works as the default placement name
    const folder = createNode(db, { kind: "folder", title: "inbox" }).node;
    for (const id of Object.keys(titles)) placeNode(db, { container_id: folder.id, child_id: id });
  });

  it("refuses to purge the wrapper of an upload that still exists, and the upload stays listed", () => {
    const db = openTestDb();
    addAsset(db, "a1", "Ebbing ch3");
    syncAssetFiles(db);
    destroyNode(db, "asset:a1");
    const err = failure(() => purgeNode(db, "asset:a1"));
    expect(err.code).toBe("asset_in_use");
    expect(err.message).toMatch(/delete the upload/i);
    expect(count(db, "ws_node")).toBe(1);
    expect(count(db, "ws_file")).toBe(1);
    expect(listTrash(db).map((n) => n.id)).toEqual(["asset:a1"]);
    expect(restoreNode(db, "asset:a1").restored).toBe("asset:a1");
    expect(listRoots(db).unplaced.map((n) => n.id)).toEqual(["asset:a1"]);
  });

  it("purges an upload's wrapper once the upload is deleted, and a later sync does not bring it back", () => {
    const db = openTestDb();
    addAsset(db, "a1", "one");
    addAsset(db, "a2", "two");
    syncAssetFiles(db);
    db.prepare("DELETE FROM asset WHERE id = 'a1'").run();
    syncAssetFiles(db);
    expect(nodeRow(db, "asset:a1").trashed_at).not.toBeNull();
    expect(purgeNode(db, "asset:a1")).toEqual({ purged: "asset:a1" });
    expect(db.prepare("SELECT 1 FROM ws_node WHERE id = 'asset:a1'").get()).toBeUndefined();
    expect(listRoots(db).unplaced.map((n) => n.id)).toEqual(["asset:a2"]);
    syncAssetFiles(db);
    expect(count(db, "ws_node")).toBe(1);
    expect(listTrash(db)).toEqual([]);
  });

  it("only the canonical wrapper is protected: a file that merely points at a live asset can be purged", () => {
    const db = openTestDb();
    addAsset(db, "a1", "one");
    const n = createNode(db, { kind: "file", title: "scan", file: { type: "asset", asset_id: "a1" } }).node;
    destroyNode(db, n.id);
    expect(purgeNode(db, n.id)).toEqual({ purged: n.id });
    expect(db.prepare("SELECT 1 FROM asset WHERE id = 'a1'").get()).toBeDefined();
  });

  it("runs inside a caller's transaction and rolls back with it", () => {
    const db = openTestDb();
    addAsset(db, "a1", "one");
    db.exec("BEGIN");
    syncAssetFiles(db);
    expect(count(db, "ws_node")).toBe(1);
    db.exec("ROLLBACK");
    expect(count(db, "ws_node")).toBe(0);
    syncAssetFiles(db);
    expect(count(db, "ws_node")).toBe(1);
  });
});
