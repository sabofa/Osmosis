import { describe, it, expect, afterAll } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DomainError } from "../src/domain/errors.js";
import { createAsset, deleteAsset } from "../src/domain/assets.js";
import { registerFormat, searchSourceFor } from "../src/domain/workspace/formats.js";
import { createNode, deleteNode, getNode, place, purge, restore } from "../src/domain/workspace/graph.js";
import { appendContent, listVersions, readContent, saveContent } from "../src/domain/workspace/content.js";
import { syncUploads } from "../src/domain/workspace/uploads.js";
import { unplaced } from "../src/domain/workspace/reads.js";
import type { Author } from "../src/domain/workspace/types.js";
import { openTestDb } from "./helpers.js";

// ---------------------------------------------------------------------------
// File content and uploads, against the approved spec
// (Learn spec/osmosis/workspace/02-data-layer.md §5.7, §7, §8, §9). Every
// refusal asserts its exact snake_case error code, never a message pattern.
// ---------------------------------------------------------------------------

type Db = DatabaseSync;

const uploadsDir = mkdtempSync(join(tmpdir(), "osmosis-ws-content-"));
afterAll(() => rmSync(uploadsDir, { recursive: true, force: true }));

function errorOf(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error("expected the call to throw a DomainError");
}

const codeOf = (fn: () => unknown): string => errorOf(fn).code;

// Formats used by the tests below. The registry is process-wide and refuses a
// duplicate, so each has its own name.
registerFormat({ format: "t-shout", searchText: (b) => (b ?? "").toUpperCase() });
registerFormat({ format: "t-bare" });
registerFormat({ format: "t-picky", validate: (b) => (b?.includes("bad") ? "no bad words here" : null) });
registerFormat({
  format: "t-throws-search",
  searchText: (b) => {
    if (b?.includes("boom")) throw new Error("search exploded");
    return b ?? "";
  },
});
const appendCalls: { body: string | null; text: string }[] = [];
registerFormat({
  format: "t-spy-append",
  searchText: (b) => `seen: ${b ?? ""}`,
  append: (body, text) => {
    appendCalls.push({ body, text });
    return `${body ?? ""}+${text}`;
  },
});
registerFormat({
  format: "t-append-throws",
  append: () => {
    throw new Error("append exploded");
  },
});
registerFormat({ format: "t-append-wrong-type", append: () => 42 as unknown as string });
registerFormat({
  format: "t-append-picky",
  validate: (b) => (b?.includes("bad") ? "no bad words here" : null),
  append: (body, text) => `${body ?? ""} ${text}`,
});

function file(db: Db, title: string, format = "markdown", body: string | null = "one", author?: Author) {
  return createNode(db, { kind: "file", title, format, body, author }).node;
}

interface VersionDump {
  node_id: string;
  version: number;
  format: string;
  body: string | null;
  asset_id: string | null;
  search_text: string | null;
  author: string;
  saved_at: string;
}
const versionRows = (db: Db, id: string) => db.prepare("SELECT * FROM ws_content WHERE node_id = ? ORDER BY version").all(id) as unknown as VersionDump[];
const updatedAt = (db: Db, id: string) => (db.prepare("SELECT updated_at FROM ws_node WHERE id = ?").get(id) as { updated_at: string }).updated_at;
const backdate = (db: Db) => db.exec("UPDATE ws_node SET updated_at = '2000-01-01 00:00:00'");
const contentDump = (db: Db) => db.prepare("SELECT * FROM ws_content ORDER BY node_id, version").all();

// ---------------------------------------------------------------------------
// readContent
// ---------------------------------------------------------------------------

describe("readContent", () => {
  it("returns the latest version as a whole row", () => {
    const db = openTestDb();
    const f = file(db, "notes", "markdown", "one", "tutor");
    saveContent(db, f.id, { body: "two", base_version: 1, author: "planner" });
    expect(readContent(db, f.id)).toEqual({
      node_id: f.id,
      version: 2,
      format: "markdown",
      body: "two",
      asset_id: null,
      search_text: "two",
      author: "planner",
      saved_at: expect.any(String),
    });
  });

  it("is not_found for an unknown node, and invalid_input for a node that holds no content", () => {
    const db = openTestDb();
    const folder = createNode(db, { kind: "folder", title: "f" }).node;
    expect(codeOf(() => readContent(db, "nope"))).toBe("not_found");
    expect(codeOf(() => readContent(db, folder.id))).toBe("invalid_input");
  });

  it("reads an archived file: the archive can be looked at", () => {
    const db = openTestDb();
    const f = file(db, "notes");
    deleteNode(db, f.id);
    expect(readContent(db, f.id)).toMatchObject({ version: 1, body: "one" });
  });
});

// ---------------------------------------------------------------------------
// saveContent
// ---------------------------------------------------------------------------

describe("saveContent", () => {
  it("is optimistic: a stale base gives stale_version with the current version in detail", () => {
    const db = openTestDb();
    const f = file(db, "notes");
    saveContent(db, f.id, { body: "two", base_version: 1, author: "ben" });
    const err = errorOf(() => saveContent(db, f.id, { body: "three", base_version: 1, author: "ben" }));
    expect(err.code).toBe("stale_version");
    expect(err.detail).toEqual({ current_version: 2 });
    expect(err.message).toContain("2");
    // Refused means untouched: still two versions, latest still "two".
    expect(versionRows(db, f.id).map((r) => r.body)).toEqual(["one", "two"]);
    expect(readContent(db, f.id).body).toBe("two");
  });

  it("refuses a base from the future as well as one from the past", () => {
    const db = openTestDb();
    const f = file(db, "notes");
    expect(errorOf(() => saveContent(db, f.id, { body: "x", base_version: 5, author: "ben" })).detail).toEqual({ current_version: 1 });
    expect(codeOf(() => saveContent(db, f.id, { body: "x", base_version: 0, author: "ben" }))).toBe("stale_version");
  });

  it("increments the version by one per save and returns the new version and its time", () => {
    const db = openTestDb();
    const f = file(db, "notes");
    const first = saveContent(db, f.id, { body: "two", base_version: 1, author: "ben" });
    const second = saveContent(db, f.id, { body: "three", base_version: 2, author: "ben" });
    expect(first).toEqual({ version: 2, saved_at: expect.any(String) });
    expect(second.version).toBe(3);
    expect(versionRows(db, f.id).map((r) => r.version)).toEqual([1, 2, 3]);
    expect(first.saved_at).toBe(versionRows(db, f.id)[1].saved_at);
  });

  it("keeps every earlier version exactly as it was, and carries the format forward", () => {
    const db = openTestDb();
    const f = file(db, "notes", "t-shout", "one");
    const v1 = versionRows(db, f.id)[0];
    saveContent(db, f.id, { body: "two", base_version: 1, author: "tutor" });
    saveContent(db, f.id, { body: "three", base_version: 2, author: "planner" });
    const rows = versionRows(db, f.id);
    expect(rows[0]).toEqual(v1);
    expect(rows.map((r) => r.format)).toEqual(["t-shout", "t-shout", "t-shout"]);
  });

  it("takes search_text from the format's hook", () => {
    const db = openTestDb();
    const shout = file(db, "shout", "t-shout", "quiet");
    saveContent(db, shout.id, { body: "hello there", base_version: 1, author: "ben" });
    expect(readContent(db, shout.id).search_text).toBe("HELLO THERE");
    // Markdown's text is its body; a format with no hook has none to store.
    const md = file(db, "md");
    saveContent(db, md.id, { body: "# Moles", base_version: 1, author: "ben" });
    expect(readContent(db, md.id).search_text).toBe("# Moles");
    const bare = file(db, "bare", "t-bare", "raw");
    saveContent(db, bare.id, { body: "still raw", base_version: 1, author: "ben" });
    expect(readContent(db, bare.id)).toMatchObject({ body: "still raw", search_text: null });
  });

  it("records the author of every version, never conflating them", () => {
    const db = openTestDb();
    const f = file(db, "notes", "markdown", "one", "tutor");
    saveContent(db, f.id, { body: "two", base_version: 1, author: "planner" });
    saveContent(db, f.id, { body: "three", base_version: 2, author: "ben" });
    expect(versionRows(db, f.id).map((r) => r.author)).toEqual(["tutor", "planner", "ben"]);
    expect(readContent(db, f.id).author).toBe("ben");
  });

  it("accepts a null body, and stamps the node's updated_at", () => {
    const db = openTestDb();
    const f = file(db, "notes");
    backdate(db);
    saveContent(db, f.id, { body: null, base_version: 1, author: "ben" });
    expect(readContent(db, f.id)).toMatchObject({ body: null, search_text: "" });
    expect(updatedAt(db, f.id)).not.toBe("2000-01-01 00:00:00");
  });

  it("refuses bad input before changing anything", () => {
    const db = openTestDb();
    const f = file(db, "notes");
    const before = contentDump(db);
    for (const base of [1.5, "1", Number.NaN, null, undefined]) {
      expect(codeOf(() => saveContent(db, f.id, { body: "x", base_version: base as number, author: "ben" })), String(base)).toBe("invalid_input");
    }
    expect(codeOf(() => saveContent(db, f.id, { body: 42 as unknown as string, base_version: 1, author: "ben" }))).toBe("invalid_input");
    expect(codeOf(() => saveContent(db, f.id, { body: "x", base_version: 1, author: "robot" as Author }))).toBe("invalid_input");
    expect(codeOf(() => saveContent(db, f.id, { body: "x", base_version: 1, author: undefined as unknown as Author }))).toBe("invalid_input");
    expect(contentDump(db)).toEqual(before);
  });

  it("is not_found for an unknown node and invalid_input for a node that holds no content", () => {
    const db = openTestDb();
    const course = createNode(db, { kind: "course", title: "c" }).node;
    expect(codeOf(() => saveContent(db, "nope", { body: "x", base_version: 1, author: "ben" }))).toBe("not_found");
    expect(codeOf(() => saveContent(db, course.id, { body: "x", base_version: 1, author: "ben" }))).toBe("invalid_input");
  });

  it("refuses an archived file: the archive is frozen until restore", () => {
    const db = openTestDb();
    const f = file(db, "notes");
    deleteNode(db, f.id);
    expect(codeOf(() => saveContent(db, f.id, { body: "x", base_version: 1, author: "ben" }))).toBe("archived");
    expect(versionRows(db, f.id)).toHaveLength(1);
    restore(db, f.id, []);
    expect(saveContent(db, f.id, { body: "x", base_version: 1, author: "ben" }).version).toBe(2);
  });

  it("fails with invalid_content, and writes nothing, when a hook refuses or throws", () => {
    const db = openTestDb();
    const picky = file(db, "picky", "t-picky", "fine");
    const fragile = file(db, "fragile", "t-throws-search", "fine");
    const before = contentDump(db);
    expect(codeOf(() => saveContent(db, picky.id, { body: "so bad", base_version: 1, author: "ben" }))).toBe("invalid_content");
    expect(codeOf(() => saveContent(db, fragile.id, { body: "boom", base_version: 1, author: "ben" }))).toBe("invalid_content");
    expect(contentDump(db)).toEqual(before);
    // A good body still saves, so the refusals were about the content.
    expect(saveContent(db, picky.id, { body: "fine too", base_version: 1, author: "ben" }).version).toBe(2);
  });

  it("checks the base before running any hook", () => {
    const db = openTestDb();
    const f = file(db, "picky", "t-picky", "fine");
    saveContent(db, f.id, { body: "fine too", base_version: 1, author: "ben" });
    // Stale and bad: the caller needs to know the file moved on first.
    expect(codeOf(() => saveContent(db, f.id, { body: "so bad", base_version: 1, author: "ben" }))).toBe("stale_version");
  });
});

// ---------------------------------------------------------------------------
// appendContent
// ---------------------------------------------------------------------------

describe("appendContent", () => {
  it("joins markdown with a blank line, and starts a body that is empty with the text alone", () => {
    const db = openTestDb();
    const notes = file(db, "USERNOTES", "markdown", "");
    appendContent(db, notes.id, { text: "- confuses moles with mass", author: "tutor" });
    expect(readContent(db, notes.id).body).toBe("- confuses moles with mass");
    appendContent(db, notes.id, { text: "- second note", author: "tutor" });
    expect(readContent(db, notes.id).body).toBe("- confuses moles with mass\n\n- second note");
    const nullBody = file(db, "null body", "markdown", null);
    appendContent(db, nullBody.id, { text: "first", author: "planner" });
    expect(readContent(db, nullBody.id).body).toBe("first");
  });

  it("is refused with not_appendable for a format that has no append hook, and writes nothing", () => {
    const db = openTestDb();
    const graph = file(db, "g", "graph", "y = x");
    const bare = file(db, "b", "t-bare", "raw");
    const before = contentDump(db);
    expect(codeOf(() => appendContent(db, graph.id, { text: "y = 2x", author: "planner" }))).toBe("not_appendable");
    expect(codeOf(() => appendContent(db, bare.id, { text: "more", author: "tutor" }))).toBe("not_appendable");
    expect(contentDump(db)).toEqual(before);
  });

  it("needs no base version, and adds to whatever is there, a save in between included", () => {
    const db = openTestDb();
    const notes = file(db, "USERNOTES", "markdown", "ben's line");
    appendContent(db, notes.id, { text: "tutor one", author: "tutor" });
    // Ben saves against the version he opened; the tutor's append never made him stale
    // for the version he is on, only for the one he opened.
    expect(codeOf(() => saveContent(db, notes.id, { body: "ben, stale", base_version: 1, author: "ben" }))).toBe("stale_version");
    saveContent(db, notes.id, { body: "ben's line\n\ntutor one\n\nben again", base_version: 2, author: "ben" });
    appendContent(db, notes.id, { text: "tutor two", author: "tutor" });
    expect(readContent(db, notes.id).body).toBe("ben's line\n\ntutor one\n\nben again\n\ntutor two");
  });

  it("returns the new version, records the author, and refreshes search_text", () => {
    const db = openTestDb();
    const notes = file(db, "USERNOTES", "markdown", "a");
    expect(appendContent(db, notes.id, { text: "b", author: "tutor" })).toEqual({ version: 2 });
    expect(appendContent(db, notes.id, { text: "c", author: "planner" })).toEqual({ version: 3 });
    expect(versionRows(db, notes.id).map((r) => [r.version, r.author, r.search_text])).toEqual([
      [1, "ben", "a"],
      [2, "tutor", "a\n\nb"],
      [3, "planner", "a\n\nb\n\nc"],
    ]);
  });

  it("hands the hook the latest body and the text, and validates the result like any write", () => {
    const db = openTestDb();
    const spy = file(db, "spy", "t-spy-append", "base");
    appendContent(db, spy.id, { text: "added", author: "tutor" });
    expect(appendCalls.at(-1)).toEqual({ body: "base", text: "added" });
    expect(readContent(db, spy.id)).toMatchObject({ body: "base+added", search_text: "seen: base+added" });
    const picky = file(db, "picky", "t-append-picky", "fine");
    const before = versionRows(db, picky.id);
    expect(codeOf(() => appendContent(db, picky.id, { text: "so bad", author: "tutor" }))).toBe("invalid_content");
    expect(versionRows(db, picky.id)).toEqual(before);
    expect(appendContent(db, picky.id, { text: "good", author: "tutor" }).version).toBe(2);
  });

  it("fails with invalid_content when the append hook throws or returns something that is not text", () => {
    const db = openTestDb();
    const throws = file(db, "t", "t-append-throws", "x");
    const wrong = file(db, "w", "t-append-wrong-type", "x");
    expect(codeOf(() => appendContent(db, throws.id, { text: "y", author: "tutor" }))).toBe("invalid_content");
    expect(codeOf(() => appendContent(db, wrong.id, { text: "y", author: "tutor" }))).toBe("invalid_content");
    expect(versionRows(db, throws.id)).toHaveLength(1);
    expect(versionRows(db, wrong.id)).toHaveLength(1);
  });

  it("refuses empty text and bad authors, and an archived file", () => {
    const db = openTestDb();
    const notes = file(db, "USERNOTES");
    for (const text of ["", "   \n", undefined, 7]) {
      expect(codeOf(() => appendContent(db, notes.id, { text: text as string, author: "tutor" })), String(text)).toBe("invalid_input");
    }
    expect(codeOf(() => appendContent(db, notes.id, { text: "x", author: "robot" as Author }))).toBe("invalid_input");
    expect(versionRows(db, notes.id)).toHaveLength(1);
    deleteNode(db, notes.id);
    expect(codeOf(() => appendContent(db, notes.id, { text: "x", author: "tutor" }))).toBe("archived");
  });

  it("is not_found for an unknown node and invalid_input for a node that holds no content", () => {
    const db = openTestDb();
    const folder = createNode(db, { kind: "folder", title: "f" }).node;
    expect(codeOf(() => appendContent(db, "nope", { text: "x", author: "tutor" }))).toBe("not_found");
    expect(codeOf(() => appendContent(db, folder.id, { text: "x", author: "tutor" }))).toBe("invalid_input");
  });

  it("is refused on an upload: it has no append hook", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content, extracted_text) VALUES ('a1', 'Paper', 'text', 'x', 'words')").run();
    syncUploads(db);
    expect(codeOf(() => appendContent(db, "asset:a1", { text: "more", author: "tutor" }))).toBe("not_appendable");
  });
});

// ---------------------------------------------------------------------------
// listVersions
// ---------------------------------------------------------------------------

describe("listVersions", () => {
  it("returns {version, author, saved_at} for each version, oldest first", () => {
    const db = openTestDb();
    const f = file(db, "notes", "markdown", "one", "ben");
    saveContent(db, f.id, { body: "two", base_version: 1, author: "planner" });
    appendContent(db, f.id, { text: "three", author: "tutor" });
    const versions = listVersions(db, f.id);
    expect(versions).toEqual([
      { version: 1, author: "ben", saved_at: expect.any(String) },
      { version: 2, author: "planner", saved_at: expect.any(String) },
      { version: 3, author: "tutor", saved_at: expect.any(String) },
    ]);
    expect(Object.keys(versions[0]).sort()).toEqual(["author", "saved_at", "version"]);
    expect(versions[2].saved_at).toBe(versionRows(db, f.id)[2].saved_at);
  });

  it("is not_found for an unknown node and invalid_input for a node that holds no content", () => {
    const db = openTestDb();
    const track = createNode(db, { kind: "track", title: "t" }).node;
    expect(codeOf(() => listVersions(db, "nope"))).toBe("not_found");
    expect(codeOf(() => listVersions(db, track.id))).toBe("invalid_input");
  });

  it("lists the history of an archived file too", () => {
    const db = openTestDb();
    const f = file(db, "notes");
    saveContent(db, f.id, { body: "two", base_version: 1, author: "ben" });
    deleteNode(db, f.id);
    expect(listVersions(db, f.id).map((v) => v.version)).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// The text a format's searchText hook is given
// ---------------------------------------------------------------------------

describe("searchSourceFor", () => {
  it("is the body for every format but upload", () => {
    const db = openTestDb();
    expect(searchSourceFor(db, "markdown", "# Moles", null)).toBe("# Moles");
    expect(searchSourceFor(db, "graph", null, null)).toBeNull();
    expect(searchSourceFor(db, "t-bare", "raw", null)).toBe("raw");
  });

  it("is the asset's extracted text for an upload, and null when there is no such asset", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content, extracted_text) VALUES ('a1', 'Paper', 'text', 'raw', 'extracted words')").run();
    db.prepare("INSERT INTO asset (id, title, type, content) VALUES ('a2', 'Link', 'url', 'https://x.test')").run();
    expect(searchSourceFor(db, "upload", null, "a1")).toBe("extracted words");
    expect(searchSourceFor(db, "upload", null, "a2")).toBeNull();
    expect(searchSourceFor(db, "upload", null, null)).toBeNull();
    expect(searchSourceFor(db, "upload", null, "no-such-asset")).toBeNull();
  });

  it("gives an upload the same search_text whichever write made it: create, save and sync", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content, extracted_text) VALUES ('a1', 'Paper', 'text', 'raw', 'extracted words')").run();
    syncUploads(db);
    expect(readContent(db, "asset:a1").search_text).toBe("extracted words");
    // A second file over the same asset, made by createNode.
    const viaCreate = createNode(db, { kind: "file", title: "again", format: "upload", asset_id: "a1" }).node;
    expect(readContent(db, viaCreate.id).search_text).toBe("extracted words");
    // And a save of the wrapper, which re-reads the asset.
    db.prepare("UPDATE ws_content SET search_text = 'stale' WHERE node_id = 'asset:a1'").run();
    expect(saveContent(db, "asset:a1", { body: null, base_version: 1, author: "ben" }).version).toBe(2);
    expect(readContent(db, "asset:a1")).toMatchObject({ search_text: "extracted words", asset_id: "a1", body: null });
  });

  it("an upload's text is never given to another format's hook, and a body never to an upload's", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content, extracted_text) VALUES ('a1', 'Paper', 'text', 'raw', 'extracted words')").run();
    syncUploads(db);
    expect(codeOf(() => saveContent(db, "asset:a1", { body: "typed text", base_version: 1, author: "ben" }))).toBe("invalid_input");
    expect(versionRows(db, "asset:a1")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Uploads (spec §8)
// ---------------------------------------------------------------------------

describe("uploads", () => {
  const nodeOf = (db: Db, id: string) => db.prepare("SELECT * FROM ws_node WHERE id = ?").get(id) as unknown as
    | { id: string; kind: string; title: string; kind_tag: string | null; archived_at: string | null; archive_batch: string | null }
    | undefined;
  const placementsOf = (db: Db, id: string) =>
    db.prepare("SELECT id, container_id, name, archived_at FROM ws_placement WHERE child_id = ?").all(id) as unknown as {
      id: string;
      container_id: string;
      name: string;
      archived_at: string | null;
    }[];

  it("creating an asset creates asset:<id> unplaced, as a file of format upload tagged source, written by ben", async () => {
    const db = openTestDb();
    const asset = await createAsset(db, uploadsDir, { title: "Ebbing ch3", type: "text", content: "moles and mass" }, "human");
    const wrapper = nodeOf(db, `asset:${asset.id}`);
    expect(wrapper).toMatchObject({ kind: "file", title: "Ebbing ch3", kind_tag: "source", archived_at: null });
    expect(versionRows(db, `asset:${asset.id}`)).toEqual([
      expect.objectContaining({ version: 1, format: "upload", body: null, asset_id: asset.id, search_text: "moles and mass", author: "ben" }),
    ]);
    expect(placementsOf(db, `asset:${asset.id}`)).toEqual([]);
    expect(unplaced(db).map((n) => n.id)).toEqual([`asset:${asset.id}`]);
  });

  it("is idempotent: syncing again changes nothing and makes no duplicate", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content, extracted_text) VALUES ('a1', 'Paper', 'text', 'x', 'words')").run();
    syncUploads(db);
    const once = { nodes: db.prepare("SELECT * FROM ws_node").all(), content: contentDump(db) };
    syncUploads(db);
    syncUploads(db);
    expect({ nodes: db.prepare("SELECT * FROM ws_node").all(), content: contentDump(db) }).toEqual(once);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ws_node").get()).toEqual({ n: 1 });
  });

  it("gives an asset with no extracted text an empty search_text, and keeps a title that is already a valid name", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content) VALUES ('a1', 'Paper on elasticity', 'url', 'https://example.test/paper')").run();
    syncUploads(db);
    expect(nodeOf(db, "asset:a1")?.title).toBe("Paper on elasticity");
    expect(readContent(db, "asset:a1").search_text).toBe("");
  });

  it("turns a title that is not a valid name into one: no slash, no control characters, capped, never empty", () => {
    const db = openTestDb();
    const insert = db.prepare("INSERT INTO asset (id, title, type, content) VALUES (?, ?, 'text', 'x')");
    insert.run("t1", "a/b\nc");
    insert.run("t2", "x".repeat(300));
    insert.run("t3", "   ");
    insert.run("t4", "Résumé");
    syncUploads(db);
    expect(nodeOf(db, "asset:t1")?.title).toBe("a-b c");
    expect([...(nodeOf(db, "asset:t2")?.title ?? "")]).toHaveLength(200);
    expect(nodeOf(db, "asset:t3")?.title).toBe("Untitled upload");
    expect(nodeOf(db, "asset:t4")?.title).toBe("Résumé");
  });

  it("deleting the asset archives the wrapper and marks its placements, as delete does", async () => {
    const db = openTestDb();
    const folder = createNode(db, { kind: "folder", title: "sources" }).node;
    const asset = await createAsset(db, uploadsDir, { title: "Paper", type: "text", content: "words" }, "human");
    const wrapperId = `asset:${asset.id}`;
    const placed = place(db, { container_id: folder.id, child_id: wrapperId });
    backdate(db);
    deleteAsset(db, uploadsDir, asset.id);
    const wrapper = nodeOf(db, wrapperId);
    expect(wrapper?.archived_at).not.toBeNull();
    expect(wrapper?.archive_batch).not.toBeNull();
    expect(placementsOf(db, wrapperId)).toEqual([expect.objectContaining({ id: placed.id, archived_at: expect.any(String) })]);
    expect(readContent(db, wrapperId).asset_id).toBeNull();
    // The folder it sat in lost a child, so it is stamped.
    expect(updatedAt(db, folder.id)).not.toBe("2000-01-01 00:00:00");
    // A later sync finds nothing left to do: the archived wrapper is left as it is,
    // not archived a second time.
    const archivedRow = nodeOf(db, wrapperId);
    syncUploads(db);
    expect(nodeOf(db, wrapperId)).toEqual(archivedRow);
  });

  it("archives only the wrappers whose asset is gone, and leaves the live ones alone", async () => {
    const db = openTestDb();
    const keep = await createAsset(db, uploadsDir, { title: "keep", type: "text", content: "k" }, "human");
    const drop = await createAsset(db, uploadsDir, { title: "drop", type: "text", content: "d" }, "human");
    deleteAsset(db, uploadsDir, drop.id);
    expect(nodeOf(db, `asset:${keep.id}`)?.archived_at).toBeNull();
    expect(nodeOf(db, `asset:${drop.id}`)?.archived_at).not.toBeNull();
  });

  it("re-links a wrapper whose asset_id was nulled while its asset still exists, and does not archive it", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content, extracted_text) VALUES ('a1', 'Paper', 'text', 'x', 'words')").run();
    syncUploads(db);
    db.prepare("UPDATE ws_content SET asset_id = NULL WHERE node_id = 'asset:a1'").run();
    syncUploads(db);
    expect(readContent(db, "asset:a1").asset_id).toBe("a1");
    expect(nodeOf(db, "asset:a1")?.archived_at).toBeNull();
    expect(nodeOf(db, "asset:a1")?.archive_batch).toBeNull();
  });

  it("survives a rebuilt asset table: ON DELETE SET NULL fires, the same assets come back, nothing is archived", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content, extracted_text) VALUES ('a1', 'Paper', 'text', 'x', 'words')").run();
    syncUploads(db);
    db.prepare("DELETE FROM asset WHERE id = 'a1'").run();
    expect(readContent(db, "asset:a1").asset_id).toBeNull();
    db.prepare("INSERT INTO asset (id, title, type, content, extracted_text) VALUES ('a1', 'Paper', 'text', 'x', 'words')").run();
    syncUploads(db);
    expect(readContent(db, "asset:a1").asset_id).toBe("a1");
    expect(nodeOf(db, "asset:a1")?.archived_at).toBeNull();
  });

  it("re-links every version of the wrapper, not just the latest", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content, extracted_text) VALUES ('a1', 'Paper', 'text', 'x', 'words')").run();
    syncUploads(db);
    saveContent(db, "asset:a1", { body: null, base_version: 1, author: "ben" });
    db.prepare("UPDATE ws_content SET asset_id = NULL WHERE node_id = 'asset:a1'").run();
    syncUploads(db);
    expect(versionRows(db, "asset:a1").map((r) => r.asset_id)).toEqual(["a1", "a1"]);
  });

  it("archives a file that merely points at an asset when the asset goes, and never re-links it", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content, extracted_text) VALUES ('a1', 'Paper', 'text', 'x', 'words')").run();
    const pointer = createNode(db, { kind: "file", title: "mine", format: "upload", asset_id: "a1" }).node;
    db.prepare("DELETE FROM asset WHERE id = 'a1'").run();
    db.prepare("INSERT INTO asset (id, title, type, content, extracted_text) VALUES ('a1', 'Paper', 'text', 'x', 'words')").run();
    syncUploads(db);
    expect(nodeOf(db, pointer.id)?.archived_at).not.toBeNull();
    expect(readContent(db, pointer.id).asset_id).toBeNull();
  });

  it("re-links by the wrapper's id alone: a file whose id merely ends in an asset's id is left as it is", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content) VALUES ('a1', 'Paper', 'text', 'x')").run();
    db.prepare("INSERT INTO ws_node (id, kind, title) VALUES ('xxxxxxa1', 'file', 'lookalike')").run();
    db.prepare("INSERT INTO ws_content (node_id, version, format, body, asset_id, author) VALUES ('xxxxxxa1', 1, 'upload', NULL, NULL, 'ben')").run();
    syncUploads(db);
    expect(readContent(db, "xxxxxxa1").asset_id).toBeNull();
    expect(nodeOf(db, "xxxxxxa1")?.archived_at).not.toBeNull();
  });

  it("does not bring back a wrapper Ben archived himself, and does not archive it again", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content, extracted_text) VALUES ('a1', 'Paper', 'text', 'x', 'words')").run();
    syncUploads(db);
    deleteNode(db, "asset:a1");
    const archived = nodeOf(db, "asset:a1");
    syncUploads(db);
    expect(nodeOf(db, "asset:a1")).toEqual(archived);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ws_node").get()).toEqual({ n: 1 });
  });

  it("refuses to purge the wrapper of a live asset (asset_in_use), and the wrapper stays", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content, extracted_text) VALUES ('a1', 'Paper', 'text', 'x', 'words')").run();
    syncUploads(db);
    deleteNode(db, "asset:a1");
    expect(codeOf(() => purge(db, "asset:a1"))).toBe("asset_in_use");
    expect(getNode(db, "asset:a1").archived_at).not.toBeNull();
  });

  it("purges once the asset is deleted, and the wrapper does not come back", async () => {
    const db = openTestDb();
    const asset = await createAsset(db, uploadsDir, { title: "Paper", type: "text", content: "words" }, "human");
    const wrapperId = `asset:${asset.id}`;
    deleteAsset(db, uploadsDir, asset.id);
    expect(purge(db, wrapperId)).toEqual({ purged: wrapperId });
    syncUploads(db);
    syncUploads(db);
    expect(nodeOf(db, wrapperId)).toBeUndefined();
    expect(versionRows(db, wrapperId)).toEqual([]);
  });

  it("is all-or-nothing inside a caller's transaction", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO asset (id, title, type, content) VALUES ('a1', 'Paper', 'text', 'x')").run();
    db.exec("BEGIN");
    syncUploads(db);
    expect(nodeOf(db, "asset:a1")).toBeDefined();
    db.exec("ROLLBACK");
    expect(nodeOf(db, "asset:a1")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The domain index
// ---------------------------------------------------------------------------

describe("the domain index", () => {
  it("re-exports the writes, the reads, content, uploads, formats, names and types", async () => {
    const ws = (await import("../src/domain/workspace/index.js")) as Record<string, unknown>;
    for (const name of [
      "createNode", "place", "move", "trash", "deleteNode", "restore", "purge", "rename", "retitle", "setKindTag",
      "getNodeDetail", "children", "appearsIn", "unplaced", "roots", "subtree", "byKindTag", "search", "archived", "context",
      "readContent", "saveContent", "appendContent", "listVersions", "syncUploads",
      "registerFormat", "formatHooks", "listFormats", "searchSourceFor", "normalizeName", "normalizeKindTag", "MAY_HOLD", "NODE_KINDS",
    ]) {
      expect(typeof ws[name], name).not.toBe("undefined");
    }
    expect(ws.syncAssetFiles).toBeUndefined();
  });
});
