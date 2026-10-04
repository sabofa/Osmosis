import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "../errors.js";
import { appendBody, checkContent, searchSourceFor } from "./formats.js";
import { getNode } from "./graph.js";
import { inSavepoint } from "./savepoint.js";
import { AUTHORS } from "./types.js";
import type { Author, ContentRow, NodeRow } from "./types.js";

// ----------------------------------------------------------------------------
// File content (Learn spec/osmosis/workspace/02-data-layer.md §5.7, §7, §9).
//
// A file's content is a stack of versions in ws_content, and the latest is the
// current content. A save names the version it started from and is refused with
// `stale_version` if the file has moved on, so Ben's edits, the tutor's notes
// and the planner's plan never overwrite each other silently. An append (the
// tutor adding to USERNOTES) needs no base, because it adds to whatever is
// there. Every version records who wrote it.
//
// The layer never interprets a body. What a format makes of one (its search
// text, whether it accepts the content, how an append joins) is the format's
// hooks (formats.ts), and they run only here, on writes.
// ----------------------------------------------------------------------------

function loadFile(db: DatabaseSync, nodeId: string): { node: NodeRow; latest: ContentRow } {
  const node = getNode(db, nodeId);
  if (node.kind !== "file") throw new DomainError("invalid_input", `A ${node.kind} holds no file content.`);
  const latest = db.prepare("SELECT * FROM ws_content WHERE node_id = ? ORDER BY version DESC LIMIT 1").get(node.id) as ContentRow | undefined;
  if (!latest) throw new DomainError("not_found", `No content for ${node.id}.`);
  return { node, latest };
}

function assertAuthor(author: Author): void {
  if (!AUTHORS.includes(author)) throw new DomainError("invalid_input", `Unknown author "${String(author)}".`);
}

// An archived file can be read but not written: the archive is a frozen copy
// until restore settles it, the same rule rename and move follow.
function assertWritable(node: NodeRow): void {
  if (node.archived_at) throw new DomainError("archived", `"${node.title}" is archived; restore it before changing it.`);
}

// Appends version n+1 with the same format and asset as the latest, after the
// format's hooks have accepted the body and supplied its search_text. The
// caller has already checked the author, the base and the body's kind.
function writeVersion(db: DatabaseSync, node: NodeRow, latest: ContentRow, body: string | null, author: Author): { version: number; saved_at: string } {
  const { search_text } = checkContent(latest.format, body, searchSourceFor(db, latest.format, body, latest.asset_id));
  const version = latest.version + 1;
  db.prepare("INSERT INTO ws_content (node_id, version, format, body, asset_id, search_text, author) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    node.id,
    version,
    latest.format,
    body,
    latest.asset_id,
    search_text,
    author
  );
  db.prepare("UPDATE ws_node SET updated_at = datetime('now') WHERE id = ?").run(node.id);
  const saved = db.prepare("SELECT saved_at FROM ws_content WHERE node_id = ? AND version = ?").get(node.id, version) as { saved_at: string };
  return { version, saved_at: saved.saved_at };
}

// The latest version. Archived files can be read, so the Archive view can show
// what is about to be restored.
export function readContent(db: DatabaseSync, nodeId: string): ContentRow {
  return loadFile(db, nodeId).latest;
}

export function saveContent(
  db: DatabaseSync,
  nodeId: string,
  input: { body: string | null; base_version: number; author: Author }
): { version: number; saved_at: string } {
  return inSavepoint(db, "ws_save_content", () => {
    const { node, latest } = loadFile(db, nodeId);
    assertAuthor(input.author);
    assertWritable(node);
    if (input.body !== null && typeof input.body !== "string") throw new DomainError("invalid_input", "A file body is text.");
    if (!Number.isInteger(input.base_version)) {
      throw new DomainError("invalid_input", "base_version is the version number the edit started from.");
    }
    // An upload holds an asset, not text (the same rule as createNode), so the
    // only thing a save can do for one is write the next version, which reads the
    // asset's text again.
    if (latest.format === "upload" && input.body !== null) {
      throw new DomainError("invalid_input", 'An "upload" file holds an uploaded asset, not text.');
    }
    // The base is checked before any hook runs: a caller whose file has moved on
    // needs to hear that first, not a verdict on content it can't save anyway.
    if (input.base_version !== latest.version) {
      throw new DomainError(
        "stale_version",
        `"${node.title}" changed since you opened it; current version is ${latest.version}.`,
        { current_version: latest.version }
      );
    }
    return writeVersion(db, node, latest, input.body, input.author);
  });
}

// Adds text after what is there. How is the format's call (markdown puts a blank
// line between), and a format with no append hook is not appendable. The result
// goes through the same hooks as a save.
export function appendContent(db: DatabaseSync, nodeId: string, input: { text: string; author: Author }): { version: number } {
  return inSavepoint(db, "ws_append_content", () => {
    const { node, latest } = loadFile(db, nodeId);
    assertAuthor(input.author);
    assertWritable(node);
    if (typeof input.text !== "string" || input.text.trim() === "") throw new DomainError("invalid_input", "There is nothing to append.");
    const body = appendBody(latest.format, latest.body, input.text);
    return { version: writeVersion(db, node, latest, body, input.author).version };
  });
}

export function listVersions(db: DatabaseSync, nodeId: string): { version: number; author: Author; saved_at: string }[] {
  const { node } = loadFile(db, nodeId);
  return db.prepare("SELECT version, author, saved_at FROM ws_content WHERE node_id = ? ORDER BY version").all(node.id) as unknown as {
    version: number;
    author: Author;
    saved_at: string;
  }[];
}
