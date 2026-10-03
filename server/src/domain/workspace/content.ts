import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "../errors.js";
import { getFileType } from "./fileTypes.js";
import type { FileTypeSpec } from "./fileTypes.js";
import { getNode } from "./graph.js";
import { inSavepoint } from "./savepoint.js";
import { AUTHORS } from "./types.js";
import type { Author, FileRow, NodeRow } from "./types.js";

// File content: read it, save it against the revision you opened, append to
// it. Every save is a new revision row that says who wrote it, so Ben's edits,
// the tutor's notes and the planner's plan never overwrite each other
// silently: a save names the revision it started from and is refused if the
// file has moved on; an append (the tutor adding to USERNOTES) needs no base
// because it adds to whatever is there.

function loadFile(db: DatabaseSync, nodeId: string): { node: NodeRow; file: FileRow } {
  const node = getNode(db, nodeId);
  if (node.kind !== "file") throw new DomainError("invalid_input", `A ${node.kind} holds no file content.`);
  const file = db.prepare("SELECT * FROM ws_file WHERE node_id = ?").get(node.id) as FileRow | undefined;
  if (!file) throw new DomainError("not_found", `No content for ${node.id}.`);
  return { node, file };
}

function assertAuthor(author: Author): void {
  if (!AUTHORS.includes(author)) throw new DomainError("invalid_input", `Unknown author "${String(author)}".`);
}

function assertNotTrashed(node: NodeRow): void {
  if (node.trashed_at) throw new DomainError("trashed", `"${node.title}" is in the trash; restore it before changing it.`);
}

// Writes `body` as the next revision. The caller has already checked the
// revision it started from, the type and the author.
function writeRevision(db: DatabaseSync, node: NodeRow, spec: FileTypeSpec, body: string | null, author: Author): { revision: number; saved_at: string } {
  const problem = spec.validate?.(body);
  if (problem) throw new DomainError("invalid_content", problem);
  db.prepare("UPDATE ws_file SET body = ?, revision = revision + 1, saved_at = datetime('now'), saved_by = ? WHERE node_id = ?").run(body, author, node.id);
  db.prepare(
    `INSERT INTO ws_file_revision (node_id, revision, type, body, asset_id, saved_at, saved_by)
     SELECT node_id, revision, type, body, asset_id, saved_at, saved_by FROM ws_file WHERE node_id = ?`
  ).run(node.id);
  db.prepare("UPDATE ws_node SET updated_at = datetime('now') WHERE id = ?").run(node.id);
  return db.prepare("SELECT revision, saved_at FROM ws_file WHERE node_id = ?").get(node.id) as { revision: number; saved_at: string };
}

export function readContent(
  db: DatabaseSync,
  nodeId: string
): { type: string; body: string | null; asset_id: string | null; revision: number; saved_at: string; saved_by: Author } {
  const { file } = loadFile(db, nodeId);
  return { type: file.type, body: file.body, asset_id: file.asset_id, revision: file.revision, saved_at: file.saved_at, saved_by: file.saved_by };
}

export function saveContent(
  db: DatabaseSync,
  nodeId: string,
  input: { body: string | null; base_revision: number; author: Author }
): { revision: number; saved_at: string } {
  return inSavepoint(db, "ws_save_content", () => {
    const { node, file } = loadFile(db, nodeId);
    assertNotTrashed(node);
    assertAuthor(input.author);
    if (input.body !== null && typeof input.body !== "string") throw new DomainError("invalid_input", "A file body is text.");
    if (!Number.isInteger(input.base_revision)) throw new DomainError("invalid_input", "base_revision is the revision number the edit started from.");
    const spec = getFileType(file.type);
    if (spec.storage === "asset") throw new DomainError("invalid_input", `A "${spec.type}" file holds an uploaded asset; its content can't be edited here.`);
    if (input.base_revision !== file.revision) {
      throw new DomainError(
        "stale_revision",
        `"${node.title}" changed since you opened it; current revision is ${file.revision}.`,
        { current_revision: file.revision }
      );
    }
    return writeRevision(db, node, spec, input.body, input.author);
  });
}

// Adds text after what is there, separated by a blank line. Only types that
// declare `appendable` take it.
export function appendContent(db: DatabaseSync, nodeId: string, input: { text: string; author: Author }): { revision: number } {
  return inSavepoint(db, "ws_append_content", () => {
    const { node, file } = loadFile(db, nodeId);
    assertNotTrashed(node);
    assertAuthor(input.author);
    const spec = getFileType(file.type);
    if (!spec.appendable) throw new DomainError("not_appendable", `A "${spec.type}" file can't be appended to (not_appendable).`);
    if (typeof input.text !== "string" || input.text.trim() === "") throw new DomainError("invalid_input", "There is nothing to append.");
    const body = file.body ? `${file.body}\n\n${input.text}` : input.text;
    return { revision: writeRevision(db, node, spec, body, input.author).revision };
  });
}

export function listRevisions(db: DatabaseSync, nodeId: string): { revision: number; saved_at: string; saved_by: Author }[] {
  const { node } = loadFile(db, nodeId);
  return db
    .prepare("SELECT revision, saved_at, saved_by FROM ws_file_revision WHERE node_id = ? ORDER BY revision")
    .all(node.id) as unknown as { revision: number; saved_at: string; saved_by: Author }[];
}
